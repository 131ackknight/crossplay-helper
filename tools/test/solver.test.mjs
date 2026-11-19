// node --test 'tools/test/*.test.mjs'
// UPDATE_SOLVER_GOLDEN=1 node --test tools/test/solver.test.mjs rewrites the golden file.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { describe, test } from 'node:test';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GOLDEN = path.join(ROOT, 'tools/test/fixtures/solver-golden.json');
const SOLVER_SCRIPTS = ['crossplay-cuts.js', 'dictionary.20261109.js'];
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

function run(ctx, file) {
    vm.runInContext(read(file), ctx, { filename: file });
}

const rules = vm.createContext({});
run(rules, 'game-rules.js');
const R = vm.runInContext('({ LETTER_POINTS_BY_GAME, BINGO_BONUS_BY_GAME, CENTER_DOUBLE_WORD, SHOW_CENTER_STAR, GAME_PRESETS, EXAMPLE_BOARD, exampleBoardState })', rules);

// The same squares app.js paints for each game.
function specialSquares(game) {
    const preset = R.GAME_PRESETS[game];
    const squares = {};
    for (const kind of ['tw', 'dw', 'tl', 'dl']) preset[kind].forEach(([r, c]) => { squares[`${r},${c}`] = kind; });
    if (R.SHOW_CENTER_STAR[game]) squares['7,7'] = 'center';
    return squares;
}

// The settings app.js posts to the worker in solverState().
function solverState(game, board, bonus) {
    return {
        boardState: board,
        LETTER_POINTS: R.LETTER_POINTS_BY_GAME[game],
        BINGO_BONUS: R.BINGO_BONUS_BY_GAME[game],
        centerScoresDoubleWord: R.CENTER_DOUBLE_WORD[game],
        bonusScoringEnabled: bonus,
        lexiconGame: game
    };
}

const emptyBoard = () => Array.from({ length: 15 }, () => Array(15).fill(null));
const clone = (value) => JSON.parse(JSON.stringify(value));

const CASES = [
    { name: 'empty board, QUICKLY', game: 'crossplay', board: emptyBoard(), rack: 'QUICKLY' },
    { name: 'empty board, BIRO is a Crossplay cut', game: 'crossplay', board: emptyBoard(), rack: 'BIROS' },
    { name: 'empty board, BIRO in Scrabble', game: 'scrabble', board: emptyBoard(), rack: 'BIROS' },
    { name: 'example board', game: 'crossplay', board: R.exampleBoardState(), rack: R.EXAMPLE_BOARD.rack },
    { name: 'example board, bonus squares off', game: 'crossplay', board: R.exampleBoardState(), rack: R.EXAMPLE_BOARD.rack, bonus: false },
    { name: 'example board, Scrabble', game: 'scrabble', board: R.exampleBoardState(), rack: 'AEINRST' },
    { name: 'example board, Words with Friends', game: 'wwf', board: R.exampleBoardState(), rack: 'HAWKISE' },
    { name: 'example board, one blank', game: 'crossplay', board: R.exampleBoardState(), rack: 'ZAX?' }
];

// The old path: the word list scripts run on the page, next to app.js globals.
function pageContext() {
    const ctx = { console };
    ctx.window = ctx;
    vm.createContext(ctx);
    SOLVER_SCRIPTS.forEach((file) => run(ctx, file));
    vm.runInContext('var SPECIAL_SQUARES = {};', ctx);
    return ctx;
}

function solveInPage(ctx, { game, board, rack, bonus = true }) {
    Object.assign(ctx, clone(solverState(game, board, bonus)));
    const squares = ctx.SPECIAL_SQUARES;
    for (const key in squares) delete squares[key];
    Object.assign(squares, specialSquares(game));
    return clone(ctx.findAllMoves(rack));
}

// The new path: solver-worker.js with importScripts and postMessage stubbed.
function workerContext() {
    const posted = [];
    const ctx = { console, postMessage: (msg) => posted.push(clone(msg)) };
    ctx.self = ctx;
    ctx.importScripts = (...urls) => urls.forEach((url) => run(ctx, new URL(url).pathname.slice(1)));
    vm.createContext(ctx);
    run(ctx, 'solver-worker.js');
    ctx.onmessage({ data: { type: 'load', scripts: SOLVER_SCRIPTS.map((file) => `https://wordgamehelp.com/${file}`) } });
    assert.deepEqual(posted.shift(), { type: 'ready' });
    return { ctx, posted };
}

let nextId = 1;
function solveInWorker({ ctx, posted }, { game, board, rack, bonus = true }) {
    const id = nextId++;
    ctx.onmessage({ data: clone({ type: 'solve', id, tiles: rack, state: solverState(game, board, bonus), specialSquares: specialSquares(game) }) });
    const reply = posted.shift();
    assert.equal(reply.type, 'moves');
    assert.equal(reply.id, id);
    return reply.moves;
}

const summary = (moves) => ({
    count: moves.length,
    top: moves.slice(0, 20).map((m) => `${m.word} ${m.direction} ${m.row + 1},${m.col + 1} = ${m.score}` + (m.blankPositions.length ? ` blanks ${m.blankPositions.join(',')}` : ''))
});

const page = pageContext();
const worker = workerContext();
const golden = process.env.UPDATE_SOLVER_GOLDEN ? {} : JSON.parse(fs.readFileSync(GOLDEN, 'utf8'));

describe('board solver', () => {
    for (const c of CASES) {
        test(c.name, () => {
            const inPage = solveInPage(page, c);
            const inWorker = solveInWorker(worker, c);
            assert.deepEqual(inWorker, inPage, 'the worker returns the same moves, in the same order, as the page');
            if (process.env.UPDATE_SOLVER_GOLDEN) golden[c.name] = summary(inPage);
            else assert.deepEqual(summary(inPage), golden[c.name]);
        });
    }

    test('QUICKLY opens for 128, as the FAQ says', () => {
        const [best] = solveInWorker(worker, CASES[0]);
        assert.equal(best.word, 'QUICKLY');
        assert.equal(best.score, 128);
    });

    test('Crossplay skips BIRO, Scrabble plays it', () => {
        const words = (c) => new Set(solveInWorker(worker, c).map((m) => m.word));
        assert.equal(words(CASES[1]).has('BIRO'), false);
        assert.equal(words(CASES[2]).has('BIRO'), true);
    });

    test('every word on the example board is in the word list', () => {
        for (const { word } of R.EXAMPLE_BOARD.words) {
            assert.ok(page.lexiconHas(word), word);
        }
    });

    test('the example rack finds MAESTRO for 86', () => {
        const [best] = solveInWorker(worker, CASES[3]);
        assert.equal(`${best.word} ${best.score}`, 'MAESTRO 86');
    });
});

process.on('exit', () => {
    if (process.env.UPDATE_SOLVER_GOLDEN) {
        fs.mkdirSync(path.dirname(GOLDEN), { recursive: true });
        fs.writeFileSync(GOLDEN, JSON.stringify(golden, null, 2) + '\n');
    }
});
