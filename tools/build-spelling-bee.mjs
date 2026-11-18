#!/usr/bin/env node
// Builds spelling-bee-words.YYYYMMDD.js, the word file the Spelling Bee solver loads.
//
//   node tools/build-spelling-bee.mjs              rebuild from tools/data
//   node tools/build-spelling-bee.mjs --scowl DIR  first refresh tools/data/scowl-levels.txt
//                                                  from the final/ folder of a SCOWL download
//
// BEE_LIKELY: dictionary words that fit Bee rules and are in SCOWL at size LIKELY_LEVEL or below.
// BEE_OTHER: the rest. Crossplay cuts and the blocklist are left out of both.
// The daily job does not run this. It corrects the tiers with spelling-bee-learned.json instead.
import fs from 'node:fs';
import path from 'node:path';
import {
    ROOT, TOOLS_DATA, LIKELY_LEVEL, allPuzzles, beeShaped, blocklist, crossplayCuts,
    fits, letterMask, puzzleMasks, scowlLevels, solverDictionary,
} from './lib/bee.mjs';

const SCOWL_SIZES = [10, 20, 35, 40, 50, 55, 60, 70];
const REFERENCES = ['spelling-bee-solver.js', 'vercel.json'];

const args = process.argv.slice(2);
const scowlAt = args.indexOf('--scowl');
if (scowlAt !== -1) refreshScowl(args[scowlAt + 1]);
build();

function refreshScowl(dir) {
    if (!dir || !fs.existsSync(dir)) throw new Error('Pass the final/ folder of a SCOWL download after --scowl');
    const versionFile = path.join(dir, '..', 'VERSION');
    const version = fs.existsSync(versionFile) ? fs.readFileSync(versionFile, 'utf8').trim() : 'unknown version';
    const levels = new Map();
    for (const size of SCOWL_SIZES) {
        for (const variant of ['english', 'american']) {
            const file = path.join(dir, `${variant}-words.${size}`);
            if (!fs.existsSync(file)) continue;
            for (const word of fs.readFileSync(file, 'latin1').split('\n')) {
                if (beeShaped(word) && !levels.has(word)) levels.set(word, size);
            }
        }
    }
    if (!levels.size) throw new Error(`No SCOWL word lists in ${dir}`);
    const lines = [
        `# Words from SCOWL ${version} (english and american lists, sizes 10 to 70) that fit Spelling Bee rules,`,
        '# each with the smallest size it appears in. Made by tools/build-spelling-bee.mjs --scowl.',
        '# SCOWL is Copyright 2000-2018 by Kevin Atkinson. Permission notice: licenses/scowl.txt',
        ...[...levels].sort(([a], [b]) => a.localeCompare(b)).map(([word, size]) => `${word} ${size}`),
    ];
    fs.writeFileSync(path.join(TOOLS_DATA, 'scowl-levels.txt'), lines.join('\n') + '\n');
    console.log(`tools/data/scowl-levels.txt: ${levels.size.toLocaleString('en-US')} words from SCOWL ${version}`);
}

function build() {
    const dictionary = solverDictionary();
    const cuts = crossplayCuts();
    const blocked = blocklist();
    const levels = scowlLevels();
    const likely = [];
    const other = [];
    let shaped = 0;
    let dropped = 0;
    for (const word of [...new Set(dictionary.words)].sort()) {
        if (!beeShaped(word)) continue;
        shaped++;
        if (cuts.has(word) || blocked.has(word)) {
            dropped++;
            continue;
        }
        if ((levels.get(word) ?? Infinity) <= LIKELY_LEVEL) likely.push(word);
        else other.push(word);
    }

    const n = (value) => value.toLocaleString('en-US');
    const body = [
        `// Spelling Bee word list for wordgamehelp.com/spelling-bee-solver. Made by tools/build-spelling-bee.mjs.`,
        `// ${n(shaped)} words in ${dictionary.name} fit Bee rules (4+ letters, no S, at most 7 different letters).`,
        `// ${n(dropped)} Crossplay cuts and blocked words are left out.`,
        `// BEE_LIKELY: ${n(likely.length)} words that are also in SCOWL at size ${LIKELY_LEVEL} or below. BEE_OTHER: ${n(other.length)} rarer words.`,
        '//',
        '// SCOWL size data: Copyright 2000-2018 by Kevin Atkinson',
        '// Permission to use, copy, modify, distribute and sell these word lists, the associated scripts,',
        '// the output created from the scripts, and its documentation for any purpose is hereby granted',
        '// without fee, provided that the above copyright notice appears in all copies and that both that',
        '// copyright notice and this permission notice appear in supporting documentation. Kevin Atkinson',
        '// makes no representations about the suitability of this array for any purpose. It is provided',
        '// "as is" without express or implied warranty.',
        '// Full SCOWL notice: https://wordgamehelp.com/licenses/scowl.txt',
        `window.BEE_LIKELY = \`${likely.join('\n')}\`;`,
        `window.BEE_OTHER = \`${other.join('\n')}\`;`,
        '',
    ].join('\n');

    const existing = fs.readdirSync(ROOT).filter((f) => /^spelling-bee-words\.\d{8}\.js$/.test(f)).sort();
    const latest = existing[existing.length - 1];
    let name = latest;
    if (latest && fs.readFileSync(path.join(ROOT, latest), 'utf8') === body) {
        console.log(`${latest} is unchanged`);
    } else {
        const now = new Date();
        const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
        name = `spelling-bee-words.${stamp}.js`;
        fs.writeFileSync(path.join(ROOT, name), body);
        for (const old of existing) if (old !== name) fs.unlinkSync(path.join(ROOT, old));
        console.log(`Wrote ${name}: ${n(likely.length)} likely, ${n(other.length)} other, ${(body.length / 1024).toFixed(0)} KB`);
    }
    for (const ref of REFERENCES) {
        const file = path.join(ROOT, ref);
        if (!fs.existsSync(file)) continue;
        const src = fs.readFileSync(file, 'utf8');
        const next = src.replace(/spelling-bee-words\.\d{8}\.js/g, name);
        if (next !== src) {
            fs.writeFileSync(file, next);
            console.log(`Updated the word file name in ${ref}`);
        }
    }
    calibrate(likely);
}

function calibrate(likely) {
    const puzzles = allPuzzles();
    if (!puzzles.length) return;
    const indexed = likely.map((word) => ({ word, mask: letterMask(word) }));
    let answers = 0;
    let found = 0;
    let guessed = 0;
    for (const p of puzzles) {
        const masks = puzzleMasks(p);
        const official = new Set(p.answers);
        const guess = indexed.filter(({ mask }) => fits(mask, masks));
        answers += official.size;
        guessed += guess.length;
        found += guess.filter(({ word }) => official.has(word)).length;
    }
    const pct = (a, b) => `${((100 * a) / b).toFixed(1)}%`;
    console.log(`Likely tier on ${puzzles.length} official puzzles: finds ${pct(found, answers)} of answers; ${pct(found, guessed)} of its words were accepted.`);
}
