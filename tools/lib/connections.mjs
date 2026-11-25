// Shared helpers for the Connections tools. Node 18 or newer, no packages.
import fs from 'node:fs';
import path from 'node:path';
import { DAY_MS, ROOT, parseDate, puzzleDateAt, zoneDate } from './site.mjs';

export const DATA_DIR = path.join(ROOT, 'data', 'connections');
// One JSON file per date. The Times posts each puzzle here weeks before it unlocks.
export const FEED = 'https://www.nytimes.com/svc/connections/v2';
// The feed lists the four groups in this order, most straightforward first.
export const COLORS = ['Yellow', 'Green', 'Blue', 'Purple'];

const FIRST_PUZZLE = '2023-06-12';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The number players see. It counts days from the first puzzle. The feed's id is a different number.
export function puzzleNumber(date) {
    return Math.round((parseDate(date) - parseDate(FIRST_PUZZLE)) / DAY_MS) + 1;
}

// The puzzle the today page shows: the one for the New York calendar date.
export function currentPuzzleDate(now) {
    return puzzleDateAt(now, 0);
}

// The newest date whose puzzle is unlocked for someone. The game unlocks at midnight in each time
// zone, and a date starts first at UTC+14, which is 5 or 6 a.m. Eastern the day before.
export function newestReleasedDate(now) {
    return zoneDate(now, 'Pacific/Kiritimati');
}

// A puzzle gets its dated page once its date has started somewhere.
export function isReleased(date, now) {
    return date <= newestReleasedDate(now);
}

export function addDays(date, days) {
    return new Date(parseDate(date).getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

// A picture puzzle has no text on its cards, so the alt text stands in.
const cardText = (card) => String(card?.content ?? card?.image_alt_text ?? '').trim();

// Checks one response from the feed. Returns a list of problems, empty when it is sound.
export function validateFeed(raw, expectedDate) {
    const problems = [];
    if (!raw || typeof raw !== 'object') return ['not a JSON object'];
    if (raw.status !== 'OK') problems.push(`status is ${JSON.stringify(raw.status)}`);
    if (!DATE.test(raw.print_date || '')) problems.push(`bad date ${raw.print_date}`);
    else if (expectedDate && raw.print_date !== expectedDate) problems.push(`asked for ${expectedDate}, got ${raw.print_date}`);
    if (!Array.isArray(raw.categories) || raw.categories.length !== 4) {
        problems.push(`${Array.isArray(raw.categories) ? raw.categories.length : 'no'} groups, not 4`);
        return problems;
    }
    const positions = [];
    const cards = [];
    raw.categories.forEach((category, i) => {
        const name = COLORS[i].toLowerCase();
        if (!String(category?.title || '').trim()) problems.push(`the ${name} group has no title`);
        if (!Array.isArray(category?.cards) || category.cards.length !== 4) {
            problems.push(`the ${name} group has ${Array.isArray(category?.cards) ? category.cards.length : 'no'} cards, not 4`);
            return;
        }
        for (const card of category.cards) {
            if (!cardText(card)) problems.push(`the ${name} group has a card with no text`);
            positions.push(card?.position);
            cards.push(cardText(card).toLowerCase());
        }
    });
    if (problems.length) return problems;
    const expected = Array.from({ length: 16 }, (_, i) => i);
    if (JSON.stringify([...positions].sort((a, b) => a - b)) !== JSON.stringify(expected)) problems.push('card positions are not 0 to 15, once each');
    if (new Set(cards).size !== 16) problems.push('a card repeats');
    return problems;
}

// The parts of a puzzle this site keeps, from a feed response or from a saved file.
export function normalizePuzzle(raw) {
    if (Array.isArray(raw.groups)) {
        return {
            date: raw.date,
            id: raw.id,
            editor: raw.editor,
            groups: raw.groups.map(({ title, cards }) => ({ title, cards: [...cards] })),
            board: [...raw.board],
        };
    }
    const dealt = raw.categories.flatMap((category) => category.cards.map((card) => ({ text: cardText(card), position: card.position })));
    return {
        date: raw.print_date,
        id: raw.id,
        editor: String(raw.editor || '').trim(),
        groups: raw.categories.map((category) => ({ title: String(category.title).trim(), cards: category.cards.map(cardText) })),
        // The 16 cards in the order the game deals them, left to right, top to bottom.
        board: dealt.sort((a, b) => a.position - b.position).map((card) => card.text),
    };
}

export function puzzleFile(date) {
    return path.join(DATA_DIR, `${date}.json`);
}

export function savedPuzzles() {
    if (!fs.existsSync(DATA_DIR)) return [];
    return fs.readdirSync(DATA_DIR)
        .filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f))
        .sort()
        .map((f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')));
}
