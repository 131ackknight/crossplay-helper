#!/usr/bin/env node
// Saves NYT Connections puzzles to data/connections/DATE.json, then rebuilds the answer pages.
// Each file records, in UTC, when this site first saved the puzzle (published) and when its
// groups last changed (updated). The pages show those times.
//
// With no dates named it fetches the puzzle for the New York date, the next date once that one has
// unlocked somewhere in the world (its page goes up early), and yesterday's again if it is already
// saved, to pick up a correction.
//
//   node tools/connections-daily.mjs                    fetch from the Times
//   node tools/connections-daily.mjs --date 2026-11-25  fetch that date instead (repeat --date for more)
//   node tools/connections-daily.mjs --file F           read a saved copy of one feed response
//   --wait         started within 20 minutes before midnight Eastern, sleep until just after it, so
//                  the today page switches on time however early the job was started
//   --urls-file F  write the site paths whose pages changed to F, one per line, for tools/indexnow.mjs
//
// The Times posts puzzles weeks ahead. A date that has not unlocked anywhere yet is refused, so
// nothing is saved or published early. Exits with an error, and writes nothing, if a puzzle looks wrong.
import fs from 'node:fs';
import { buildPages } from './build-connections-pages.mjs';
import {
    FEED, addDays, currentPuzzleDate, newestReleasedDate, normalizePuzzle, puzzleFile, puzzleNumber, validateFeed,
} from './lib/connections.mjs';
import { buildTime, isMain, writeIfChanged } from './lib/site.mjs';

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const WAIT_WINDOW_MS = 20 * 60 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchFeed(date) {
    const url = `${FEED}/${date}.json`;
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const res = await fetch(url, {
                headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', 'Accept-Language': 'en-US,en;q=0.9' },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (err) {
            lastError = err;
            console.log(`Fetch attempt ${attempt} for ${date} failed: ${err.message}`);
            if (attempt < 3) await sleep(attempt * 15000);
        }
    }
    throw new Error(`Could not fetch ${url}: ${lastError.message}`);
}

// Milliseconds from `now` to the next midnight in New York. Midnight there is 04:00 or 05:00 UTC.
export function msUntilEasternMidnight(now) {
    const next = addDays(currentPuzzleDate(now), 1);
    for (const hour of [4, 5]) {
        const midnight = new Date(`${next}T0${hour}:00:00Z`);
        if (currentPuzzleDate(midnight) === next) return midnight - now;
    }
    throw new Error(`No midnight found for ${next}`);
}

// The dates a normal run fetches, oldest first.
export function datesToFetch(now, isSaved = (date) => fs.existsSync(puzzleFile(date))) {
    const today = currentPuzzleDate(now);
    const yesterday = addDays(today, -1);
    return [...new Set([...(isSaved(yesterday) ? [yesterday] : []), today, newestReleasedDate(now)])].sort();
}

function describeChange(before, after) {
    const changed = after.groups.filter((group, i) => JSON.stringify(group) !== JSON.stringify(before.groups[i])).map((group) => group.title);
    return changed.length ? `groups changed: ${changed.join('; ')}` : 'details changed';
}

function option(args, name) {
    const values = [];
    args.forEach((arg, i) => { if (arg === name) values.push(args[i + 1]); });
    return values;
}

export async function main(args = process.argv.slice(2)) {
    if (args.includes('--wait')) {
        const ms = msUntilEasternMidnight(new Date());
        if (ms <= WAIT_WINDOW_MS) {
            console.log(`Waiting ${Math.ceil(ms / 1000)} seconds for midnight Eastern.`);
            await sleep(ms + 2000);
        }
    }

    // One clock, to the second, for the saved times and the build, so a page's sitemap lastmod equals
    // the time it changed when this run is what changed it. CONNECTIONS_NOW stands in for it in tests.
    const runAt = new Date(Math.floor(buildTime('CONNECTIONS_NOW').getTime() / 1000) * 1000);
    const now = runAt.toISOString().replace(/\.\d+Z$/, 'Z');
    const newest = newestReleasedDate(runAt);

    const [file] = option(args, '--file');
    const asked = option(args, '--date');
    const feeds = [];
    if (file) {
        feeds.push({ raw: JSON.parse(fs.readFileSync(file, 'utf8')) });
    } else {
        for (const date of asked.length ? asked : datesToFetch(runAt)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) throw new Error(`Not a date: ${date}`);
            if (date > newest) throw new Error(`${date} has not unlocked anywhere yet. The newest date is ${newest}.`);
            feeds.push({ date, raw: await fetchFeed(date) });
        }
    }

    const puzzles = feeds.map(({ date, raw }) => {
        const problems = validateFeed(raw, date);
        if (problems.length) throw new Error(`Puzzle ${date || raw?.print_date || '(no date)'} failed checks: ${problems.join('; ')}`);
        const puzzle = normalizePuzzle(raw);
        if (puzzle.date > newest) throw new Error(`${puzzle.date} has not unlocked anywhere yet. The newest date is ${newest}.`);
        return puzzle;
    });

    for (const puzzle of puzzles) {
        const target = puzzleFile(puzzle.date);
        const before = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : null;
        if (before && JSON.stringify(normalizePuzzle(before)) === JSON.stringify(puzzle)) {
            console.log(`${puzzle.date}: already saved`);
            continue;
        }
        const { date, ...rest } = puzzle;
        const saved = { date, published: before?.published || now, updated: now, number: puzzleNumber(date), ...rest };
        writeIfChanged(target, JSON.stringify(saved, null, 1) + '\n');
        console.log(before ? `${date}: updated (${describeChange(before, puzzle)})` : `${date}: saved, #${saved.number}`);
    }

    const { changed, urls } = buildPages(runAt);
    console.log(changed.length ? `Updated ${changed.length} file${changed.length === 1 ? '' : 's'}.` : 'Pages are up to date.');
    const [urlsFile] = option(args, '--urls-file');
    if (urlsFile) fs.writeFileSync(urlsFile, urls.map((url) => `${url}\n`).join(''));
}

if (isMain(import.meta.url)) {
    main().catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}
