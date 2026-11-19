#!/usr/bin/env node
// Saves today's and yesterday's NYT Spelling Bee to data/spelling-bee/DATE.json, then rebuilds
// the answer pages. The GitHub workflow runs this a little after the 3 a.m. Eastern reset.
// Each file records, in UTC, when this site first saved the puzzle (published) and when its
// answer list last changed (updated). The pages show those times.
//
//   node tools/spelling-bee-daily.mjs              fetch the Times page
//   node tools/spelling-bee-daily.mjs --file F     read a saved copy of the page, or a JSON file with
//                                                  { today, yesterday } or a single puzzle
//
// Exits with an error, and writes nothing, if the puzzle data looks wrong.
import fs from 'node:fs';
import path from 'node:path';
import { buildPages } from './build-spelling-bee-pages.mjs';
import {
    DATA_DIR, allPuzzles, currentWordsFile, fits, learnRulings, letterMask, normalizePuzzle,
    puzzleMasks, validatePuzzle, writeIfChanged,
} from './lib/bee.mjs';

const PAGE_URL = 'https://www.nytimes.com/puzzles/spelling-bee';
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

async function fetchPage() {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(PAGE_URL, {
                headers: { 'User-Agent': USER_AGENT, Accept: 'text/html', 'Accept-Language': 'en-US,en;q=0.9' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.text();
        } catch (err) {
            lastError = err;
            console.log(`Fetch attempt ${attempt} failed: ${err.message}`);
            if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 15000));
        }
    }
    throw new Error(`Could not fetch ${PAGE_URL}: ${lastError.message}`);
}

function gameData(text) {
    const match = text.match(/window\.gameData\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
    if (match) return JSON.parse(match[1]);
    if (!text.trim().startsWith('{')) throw new Error('No window.gameData on the page. The Times may have changed it.');
    const json = JSON.parse(text);
    return json.today ? json : { today: json };
}

function describeChange(before, after) {
    const old = new Set(before.answers);
    const now = new Set(after.answers);
    const added = after.answers.filter((w) => !old.has(w));
    const removed = before.answers.filter((w) => !now.has(w));
    return [added.length && `added ${added.join(', ')}`, removed.length && `removed ${removed.join(', ')}`].filter(Boolean).join('; ') || 'letters changed';
}

// How the solver's guess, before this puzzle's list existed, compares with the official list.
function calibration(puzzle) {
    const words = currentWordsFile();
    const earlier = allPuzzles().filter((p) => p.date < puzzle.date);
    const rulings = learnRulings(earlier, words.likely.concat(words.other));
    const likely = new Set(words.likely.filter((w) => rulings.get(w) !== false));
    for (const [word, ok] of rulings) if (ok) likely.add(word);
    const masks = puzzleMasks(puzzle);
    const guess = [...likely].filter((w) => fits(letterMask(w), masks));
    const official = new Set(puzzle.answers);
    const hits = guess.filter((w) => official.has(w)).length;
    const missed = puzzle.answers.filter((w) => !likely.has(w));
    console.log(`${puzzle.date}: the solver's guess had ${hits} of ${official.size} answers and ${guess.length - hits} extra words.`);
    if (missed.length) console.log(`  Missed: ${missed.join(' ')}`);
}

async function main() {
    const args = process.argv.slice(2);
    const fileAt = args.indexOf('--file');
    const text = fileAt === -1 ? await fetchPage() : fs.readFileSync(args[fileAt + 1], 'utf8');
    const data = gameData(text);
    const puzzles = [data.yesterday, data.today].filter(Boolean).map(normalizePuzzle);
    if (!puzzles.length) throw new Error('No puzzles found in the page data');

    for (const puzzle of puzzles) {
        const problems = validatePuzzle(puzzle);
        if (problems.length) throw new Error(`Puzzle ${puzzle.date || '(no date)'} failed checks: ${problems.join('; ')}`);
    }

    for (const puzzle of puzzles) {
        const file = path.join(DATA_DIR, `${puzzle.date}.json`);
        const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
        if (before && JSON.stringify(normalizePuzzle(before)) === JSON.stringify(puzzle)) {
            console.log(`${puzzle.date}: already saved`);
            continue;
        }
        const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
        const { date, ...rest } = puzzle;
        writeIfChanged(file, JSON.stringify({ date, published: before?.published || now, updated: now, ...rest }, null, 1) + '\n');
        console.log(before ? `${puzzle.date}: updated (${describeChange(before, puzzle)})` : `${puzzle.date}: saved, ${puzzle.answers.length} answers`);
        if (!before) calibration(puzzle);
    }

    const changed = buildPages();
    console.log(changed.length ? `Updated ${changed.length} file${changed.length === 1 ? '' : 's'}.` : 'Pages are up to date.');
}

main().catch((err) => {
    console.error(err.message);
    process.exit(1);
});
