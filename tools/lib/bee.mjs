// Shared helpers for the Spelling Bee tools. Node 18 or newer, no packages.
// The helpers every daily answers section uses live in site.mjs and are passed through here.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './site.mjs';

export {
    ROOT, SITE, escapeHtml, longDate, monthLabel, parseDate, shortDate, weekday, writeIfChanged,
} from './site.mjs';
export const DATA_DIR = path.join(ROOT, 'data', 'spelling-bee');
export const TOOLS_DATA = path.join(ROOT, 'tools', 'data');

// SCOWL size cutoff for the likely tier. Size 60 was the best trade on 26 official
// puzzles: 85% of answers found, 93% of likely words accepted (see README).
export const LIKELY_LEVEL = 60;

export const RANKS = [
    ['Beginner', 0],
    ['Good Start', 2],
    ['Moving Up', 5],
    ['Good', 8],
    ['Solid', 15],
    ['Nice', 25],
    ['Great', 40],
    ['Amazing', 50],
    ['Genius', 70],
    ['Queen Bee', 100],
];

export function listLines(text) {
    return text.split('\n').map((line) => line.trim()).filter((line) => line && !line.startsWith('#'));
}

export function solverDictionary() {
    const name = fs.readdirSync(ROOT).filter((f) => /^dictionary\.\d{8}\.js$/.test(f)).sort().pop();
    if (!name) throw new Error('No dictionary.YYYYMMDD.js in the site root');
    const match = fs.readFileSync(path.join(ROOT, name), 'utf8').match(/const WORD_DATA = `([\s\S]*?)`;/);
    if (!match) throw new Error(`No WORD_DATA block in ${name}`);
    return { name, words: listLines(match[1].toLowerCase()) };
}

export function crossplayCuts() {
    const match = fs.readFileSync(path.join(ROOT, 'crossplay-cuts.js'), 'utf8').match(/`([\s\S]*?)`/);
    if (!match) throw new Error('No word block in crossplay-cuts.js');
    return new Set(listLines(match[1].toLowerCase()));
}

export function blocklist() {
    return new Set(listLines(fs.readFileSync(path.join(TOOLS_DATA, 'spelling-bee-blocklist.txt'), 'utf8').toLowerCase()));
}

export function scowlLevels() {
    const levels = new Map();
    for (const line of listLines(fs.readFileSync(path.join(TOOLS_DATA, 'scowl-levels.txt'), 'utf8'))) {
        const [word, level] = line.split(/\s+/);
        levels.set(word, Number(level));
    }
    return levels;
}

export function letterMask(word) {
    let mask = 0;
    for (let i = 0; i < word.length; i++) mask |= 1 << (word.charCodeAt(i) - 97);
    return mask;
}

export function maskSize(mask) {
    let n = 0;
    while (mask) {
        mask &= mask - 1;
        n++;
    }
    return n;
}

// Four or more letters, no S, at most seven different letters.
export function beeShaped(word) {
    return word.length >= 4 && /^[a-rt-z]+$/.test(word) && maskSize(letterMask(word)) <= 7;
}

export function puzzleMasks(puzzle) {
    const hive = letterMask(puzzle.center + puzzle.outer.join(''));
    return { hive, center: letterMask(puzzle.center) };
}

export function fits(mask, masks) {
    return (mask & masks.center) !== 0 && (mask & ~masks.hive) === 0;
}

export function isPangram(word) {
    return maskSize(letterMask(word)) === 7;
}

export function wordScore(word) {
    return (word.length === 4 ? 1 : word.length) + (isPangram(word) ? 7 : 0);
}

export function maxScore(words) {
    return words.reduce((sum, word) => sum + wordScore(word), 0);
}

export function rankTable(max) {
    return RANKS.map(([name, pct]) => ({ name, pct, points: Math.round((max * pct) / 100) }));
}

// The word file is rebuilt rarely; the daily job only reads it.
export function currentWordsFile() {
    const name = fs.readdirSync(ROOT).filter((f) => /^spelling-bee-words\.\d{8}\.js$/.test(f)).sort().pop();
    if (!name) throw new Error('No spelling-bee-words.YYYYMMDD.js; run tools/build-spelling-bee.mjs first');
    const src = fs.readFileSync(path.join(ROOT, name), 'utf8');
    const read = (key) => {
        const match = src.match(new RegExp(`window\\.${key} = \`([\\s\\S]*?)\`;`));
        if (!match) throw new Error(`No ${key} in ${name}`);
        return listLines(match[1]);
    };
    return { name, likely: read('BEE_LIKELY'), other: read('BEE_OTHER') };
}

export function validatePuzzle(p) {
    const problems = [];
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) problems.push(`bad date ${p.date}`);
    if (!/^[a-z]$/.test(p.center || '')) problems.push(`bad center letter ${p.center}`);
    if (!Array.isArray(p.outer) || p.outer.length !== 6 || !p.outer.every((l) => /^[a-z]$/.test(l))) {
        problems.push(`bad outer letters ${JSON.stringify(p.outer)}`);
    } else if (new Set([p.center, ...p.outer]).size !== 7) {
        problems.push('letters repeat');
    }
    if (!Array.isArray(p.answers) || p.answers.length < 10) problems.push('fewer than 10 answers');
    if (!Array.isArray(p.pangrams) || p.pangrams.length < 1) problems.push('no pangram');
    if (problems.length) return problems;
    const masks = puzzleMasks(p);
    const answers = new Set(p.answers);
    for (const word of p.answers) {
        if (!/^[a-z]{4,}$/.test(word)) problems.push(`odd answer ${word}`);
        else if (!fits(letterMask(word), masks)) problems.push(`${word} does not fit the letters`);
    }
    for (const word of p.pangrams) {
        if (!answers.has(word)) problems.push(`pangram ${word} is not an answer`);
        else if (!isPangram(word)) problems.push(`pangram ${word} does not use all seven letters`);
    }
    return problems;
}

export function normalizePuzzle(raw) {
    const lower = (list) => (list || []).map((w) => String(w).toLowerCase());
    return {
        date: raw.printDate || raw.date,
        center: String(raw.centerLetter || raw.center || '').toLowerCase(),
        outer: lower(raw.outerLetters || raw.outer).sort(),
        pangrams: lower(raw.pangrams).sort(),
        answers: lower(raw.answers).sort(),
    };
}

function readPuzzleFile(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function savedPuzzles() {
    if (!fs.existsSync(DATA_DIR)) return [];
    return fs.readdirSync(DATA_DIR)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort()
        .map((f) => readPuzzleFile(path.join(DATA_DIR, f)));
}

// Older official lists used only to learn which words the Times takes. No pages are made from them.
export function seedPuzzles() {
    const file = path.join(TOOLS_DATA, 'spelling-bee-seed.json');
    return fs.existsSync(file) ? readPuzzleFile(file) : [];
}

export function allPuzzles() {
    const byDate = new Map();
    for (const p of seedPuzzles()) byDate.set(p.date, p);
    for (const p of savedPuzzles()) byDate.set(p.date, p);
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// The latest ruling wins, so a word the Times adds later moves back to accepted.
export function learnRulings(puzzles, words) {
    const ruling = new Map();
    const indexed = words.map((word) => ({ word, mask: letterMask(word) }));
    for (const p of puzzles) {
        const masks = puzzleMasks(p);
        const answers = new Set(p.answers);
        for (const { word, mask } of indexed) {
            if (!answers.has(word) && fits(mask, masks)) ruling.set(word, false);
        }
        for (const word of answers) ruling.set(word, true);
    }
    return ruling;
}
