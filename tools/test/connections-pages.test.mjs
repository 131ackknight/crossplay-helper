// node --test 'tools/test/*.test.mjs'
// Uses the saved feed responses in fixtures/connections, not the live data in data/connections.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { datesToFetch, msUntilEasternMidnight } from '../connections-daily.mjs';
import { payload } from '../indexnow.mjs';
import {
    currentPuzzleDate, isReleased, newestReleasedDate, normalizePuzzle, puzzleNumber, validateFeed,
} from '../lib/connections.mjs';
import { ROOT } from '../lib/site.mjs';

const FIXTURES = path.join(ROOT, 'tools', 'test', 'fixtures', 'connections');
const feed = (date) => JSON.parse(fs.readFileSync(path.join(FIXTURES, `${date}.json`), 'utf8'));
const MINUTE = 60 * 1000;

describe('currentPuzzleDate, the today page', () => {
    const cases = [
        ['2026-11-26T04:59:59Z', '2026-11-25', 'one second before midnight EST'],
        ['2026-11-26T05:00:00Z', '2026-11-26', 'midnight EST'],
        ['2026-11-26T02:00:00Z', '2026-11-25', '9 p.m. EST on Nov 25, already Nov 26 in UTC'],
        ['2026-07-01T03:59:59Z', '2026-06-30', 'one second before midnight EDT'],
        ['2026-07-01T04:00:00Z', '2026-07-01', 'midnight EDT'],
        ['2026-03-08T04:59:59Z', '2026-03-07', 'spring forward day, midnight is still EST'],
        ['2026-03-08T05:00:00Z', '2026-03-08', 'spring forward day, midnight EST'],
        ['2026-11-01T03:59:59Z', '2026-10-31', 'fall back day, midnight is still EDT'],
        ['2026-11-01T04:00:00Z', '2026-11-01', 'fall back day, midnight EDT'],
        ['2027-01-01T04:59:59Z', '2026-12-31', 'new year, before midnight'],
        ['2027-01-01T05:00:00Z', '2027-01-01', 'new year, midnight'],
    ];
    for (const [now, expected, label] of cases) {
        test(`${now} is ${expected}`, () => assert.equal(currentPuzzleDate(new Date(now)), expected, label));
    }
});

describe('newestReleasedDate, the dated pages', () => {
    test('a date is released when it starts at UTC+14, 10:00 UTC the day before', () => {
        assert.equal(newestReleasedDate(new Date('2026-11-25T09:59:59Z')), '2026-11-25');
        assert.equal(newestReleasedDate(new Date('2026-11-25T10:00:00Z')), '2026-11-26');
        assert.equal(newestReleasedDate(new Date('2026-07-01T10:00:00Z')), '2026-07-02', 'no daylight time at UTC+14');
    });
    test('isReleased', () => {
        assert.equal(isReleased('2026-11-26', new Date('2026-11-25T09:59:59Z')), false);
        assert.equal(isReleased('2026-11-26', new Date('2026-11-25T10:00:00Z')), true);
        assert.equal(isReleased('2026-11-27', new Date('2026-11-26T04:00:00Z')), false, 'two days ahead is never out');
        assert.equal(isReleased('2025-01-01', new Date('2026-11-25T10:00:00Z')), true);
    });
});

describe('puzzleNumber', () => {
    const cases = [['2023-06-12', 1], ['2024-10-23', 500], ['2026-09-30', 1207], ['2026-11-25', 1263], ['2026-11-26', 1264]];
    for (const [date, number] of cases) test(`${date} is #${number}`, () => assert.equal(puzzleNumber(date), number));
});

describe('msUntilEasternMidnight', () => {
    const cases = [
        ['2026-11-26T04:45:00Z', 15, 'EST'],
        ['2026-07-01T03:45:00Z', 15, 'EDT'],
        ['2026-03-08T04:00:00Z', 60, 'spring forward day: midnight is 05:00 UTC'],
        ['2026-11-01T03:30:00Z', 30, 'fall back day: midnight is 04:00 UTC'],
        ['2026-11-26T05:00:00Z', 24 * 60, 'at midnight, the next one is a day away'],
    ];
    for (const [now, minutes, label] of cases) {
        test(`${now} is ${minutes} minutes before`, () => assert.equal(msUntilEasternMidnight(new Date(now)), minutes * MINUTE, label));
    }
});

describe('datesToFetch', () => {
    const none = () => false;
    test('early in the New York morning, only today', () => {
        assert.deepEqual(datesToFetch(new Date('2026-11-25T09:00:00Z'), none), ['2026-11-25']);
    });
    test('once the next date has started somewhere, today and the next date', () => {
        assert.deepEqual(datesToFetch(new Date('2026-11-25T15:00:00Z'), none), ['2026-11-25', '2026-11-26']);
    });
    test('yesterday again when it is already saved', () => {
        assert.deepEqual(datesToFetch(new Date('2026-11-25T15:00:00Z'), (date) => date === '2026-11-24'), ['2026-11-24', '2026-11-25', '2026-11-26']);
    });
});

describe('validateFeed and normalizePuzzle', () => {
    const copy = () => feed('2026-11-25');

    test('a real response is sound', () => {
        assert.deepEqual(validateFeed(copy(), '2026-11-25'), []);
    });
    test('normalizePuzzle keeps the groups in color order and the board in dealt order', () => {
        const puzzle = normalizePuzzle(copy());
        assert.equal(puzzle.date, '2026-11-25');
        assert.deepEqual(puzzle.groups.map((group) => group.title), ['PARTS OF A FREEWAY', 'U-SHAPED THINGS', 'RUG SPECIFICATIONS', 'DOGS BREEDS MINUS FIRST LETTER']);
        assert.deepEqual(puzzle.groups[0].cards, ['LANE', 'MEDIAN', 'RAMP', 'SHOULDER']);
        assert.equal(puzzle.board.length, 16);
        assert.deepEqual(puzzle.board.slice(0, 4), ['EAGLE', 'PILE', 'HALF-PIPE', 'DIMENSIONS']);
    });
    test('a saved puzzle normalizes to itself', () => {
        const puzzle = normalizePuzzle(copy());
        assert.deepEqual(normalizePuzzle({ ...puzzle, published: 'x', updated: 'y', number: 1263 }), puzzle);
    });
    test('the wrong date is a problem', () => {
        assert.match(validateFeed(copy(), '2026-11-26').join(), /asked for 2026-11-26, got 2026-11-25/);
    });
    test('an error response is a problem', () => {
        assert.ok(validateFeed({ status: 'ERROR', errors: ['Not Found'], results: [] }, '2026-12-20').length);
    });
    test('three groups is a problem', () => {
        const raw = copy();
        raw.categories.pop();
        assert.match(validateFeed(raw).join(), /3 groups, not 4/);
    });
    test('five cards in a group is a problem', () => {
        const raw = copy();
        raw.categories[1].cards.push({ content: 'EXTRA', position: 16 });
        assert.match(validateFeed(raw).join(), /green group has 5 cards/);
    });
    test('a missing title is a problem', () => {
        const raw = copy();
        raw.categories[2].title = ' ';
        assert.match(validateFeed(raw).join(), /blue group has no title/);
    });
    test('a repeated position is a problem', () => {
        const raw = copy();
        raw.categories[0].cards[0].position = raw.categories[0].cards[1].position;
        assert.match(validateFeed(raw).join(), /positions/);
    });
    test('a repeated card is a problem', () => {
        const raw = copy();
        raw.categories[3].cards[0].content = 'lane';
        assert.match(validateFeed(raw).join(), /a card repeats/);
    });
    test('a picture card uses its alt text', () => {
        const raw = copy();
        const card = raw.categories[0].cards[0];
        delete card.content;
        card.image_url = 'https://example.com/lane.png';
        card.image_alt_text = 'A LANE';
        assert.deepEqual(validateFeed(raw, '2026-11-25'), []);
        assert.equal(normalizePuzzle(raw).groups[0].cards[0], 'A LANE');
    });
    test('a card with neither text nor alt text is a problem', () => {
        const raw = copy();
        delete raw.categories[0].cards[0].content;
        assert.match(validateFeed(raw).join(), /yellow group has a card with no text/);
    });
});

describe('IndexNow payload', () => {
    test('paths become full URLs under the site, with the key file location', () => {
        const key = '0123456789abcdef0123456789abcdef';
        assert.deepEqual(payload(['/connections-answers', '/connections-answers/2026-11-26', '/'], key), {
            host: 'wordgamehelp.com',
            key,
            keyLocation: `https://wordgamehelp.com/${key}.txt`,
            urlList: ['https://wordgamehelp.com/connections-answers', 'https://wordgamehelp.com/connections-answers/2026-11-26', 'https://wordgamehelp.com'],
        });
    });
});

// Runs the real builder and daily script on a copy of the site that has only the fixture puzzles.
describe('built pages', () => {
    let site;
    let beeBefore;
    const read = (rel) => fs.readFileSync(path.join(site, rel), 'utf8');
    const exists = (rel) => fs.existsSync(path.join(site, rel));
    const datedDirs = () => fs.readdirSync(path.join(site, 'connections-answers')).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort();
    const sitemapDates = () => [...read('sitemap.xml').matchAll(/connections-answers\/(\d{4}-\d{2}-\d{2})</g)].map((m) => m[1]).sort();
    const linkedDates = (rel) => [...new Set([...read(rel).matchAll(/href="\/connections-answers\/(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]))].sort();
    const lastmod = (loc) => read('sitemap.xml').match(new RegExp(`<loc>https://wordgamehelp\\.com${loc}</loc>\\s*<lastmod>([^<]+)</lastmod>`))[1];
    const beeBlock = () => read('sitemap.xml').match(/<!-- spelling-bee:start -->[\s\S]*<!-- spelling-bee:end -->/)[0];
    const hub = () => read('connections-answers/index.html');
    const env = (now) => ({ ...process.env, CONNECTIONS_NOW: now });
    const build = (now) => execFileSync(process.execPath, [path.join(site, 'tools', 'build-connections-pages.mjs')], { env: env(now) });
    const daily = (now, ...args) => spawnSync(process.execPath, [path.join(site, 'tools', 'connections-daily.mjs'), ...args], { env: env(now), encoding: 'utf8' });
    // What the daily script writes for a puzzle, without its clock.
    const save = (date, published, change = (puzzle) => puzzle) => {
        const { date: _, ...rest } = change(normalizePuzzle(feed(date)));
        const saved = { date, published, updated: published, number: puzzleNumber(date), ...rest };
        fs.writeFileSync(path.join(site, 'data', 'connections', `${date}.json`), JSON.stringify(saved, null, 1) + '\n');
    };
    const hashDir = (rel) => {
        const hash = crypto.createHash('sha256');
        for (const name of fs.readdirSync(path.join(site, rel), { recursive: true }).sort()) {
            const file = path.join(site, rel, name);
            if (fs.statSync(file).isFile()) hash.update(name).update(fs.readFileSync(file));
        }
        return hash.digest('hex');
    };

    before(() => {
        site = fs.mkdtempSync(path.join(os.tmpdir(), 'connections-pages-'));
        for (const rel of ['tools', 'spelling-bee-solver', 'spelling-bee-answers', 'sitemap.xml']) {
            fs.cpSync(path.join(ROOT, rel), path.join(site, rel), { recursive: true });
        }
        // Start from a sitemap with no Connections lines, whatever the real one has.
        fs.writeFileSync(path.join(site, 'sitemap.xml'), read('sitemap.xml').replace(/\n {2}<!-- connections:start -->[\s\S]*<!-- connections:end -->/, ''));
        fs.mkdirSync(path.join(site, 'data', 'connections'), { recursive: true });
        save('2026-11-23', '2026-11-22T10:05:00Z');
        save('2026-11-24', '2026-11-23T10:05:00Z');
        save('2026-11-25', '2026-11-24T10:05:00Z');
        beeBefore = { pages: hashDir('spelling-bee-answers'), block: beeBlock() };
    });
    after(() => fs.rmSync(site, { recursive: true, force: true }));

    test('the daily script refuses a puzzle that has not unlocked anywhere', () => {
        const run = daily('2026-11-25T09:59:59Z', '--file', path.join(FIXTURES, '2026-11-26.json'));
        assert.equal(run.status, 1);
        assert.match(run.stderr, /2026-11-26 has not unlocked anywhere yet/);
        assert.ok(!exists('data/connections/2026-11-26.json'));
        assert.ok(!exists('connections-answers'), 'nothing was built');
    });

    test('one second before Nov 26 starts anywhere, its saved puzzle has no page', () => {
        save('2026-11-26', '2026-11-25T09:00:00Z');
        build('2026-11-25T09:59:59Z');
        const expected = ['2026-11-23', '2026-11-24', '2026-11-25'];
        assert.deepEqual(datedDirs(), expected);
        assert.deepEqual(sitemapDates(), expected);
        assert.deepEqual(linkedDates('connections-answers/archive/index.html'), expected);
        assert.match(hub(), /Answers Today: November 25, 2026 \(#1263\)/);
        assert.ok(!hub().includes('2026-11-26'), 'the today page does not mention the next puzzle');
        assert.match(read('connections-answers/yesterday/index.html'), /Yesterday's NYT Connections Answers: November 24, 2026 \(#1262\)/);
    });

    test('once Nov 26 has started somewhere, its page is up and the today page stays on Nov 25', () => {
        const urlsFile = path.join(site, 'urls.txt');
        const run = daily('2026-11-25T10:00:00Z', '--file', path.join(FIXTURES, '2026-11-26.json'), '--urls-file', urlsFile);
        assert.equal(run.status, 0, run.stderr);
        assert.match(run.stdout, /2026-11-26: already saved/);
        const expected = ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26'];
        assert.deepEqual(datedDirs(), expected);
        assert.deepEqual(sitemapDates(), expected);
        assert.deepEqual(linkedDates('connections-answers/archive/index.html'), expected);
        assert.match(read('connections-answers/2026-11-26/index.html'), /<title>NYT Connections #1264 Hints and Answers for November 26, 2026<\/title>/);
        assert.match(hub(), /Answers Today: November 25, 2026 \(#1263\)/);
        assert.match(hub(), /Already on the next one\? See <a href="\/connections-answers\/2026-11-26">November 26, 2026<\/a>/);
        assert.match(hub(), /data-next="\/connections-answers\/2026-11-26"/);
        // The pages whose content changed in this run, for IndexNow. Nov 25 gained a link to the next day.
        assert.deepEqual(fs.readFileSync(urlsFile, 'utf8').trim().split('\n').sort(), [
            '/connections-answers', '/connections-answers/2026-11-25', '/connections-answers/2026-11-26', '/connections-answers/archive',
        ]);
        assert.equal(lastmod('/connections-answers'), '2026-11-25T05:00:00-05:00');
        assert.equal(lastmod('/connections-answers/yesterday'), '2026-11-25T04:59:59-05:00', 'the yesterday page did not change');
    });

    test('one second before midnight Eastern the today page is still Nov 25', () => {
        build('2026-11-26T04:59:59Z');
        assert.match(hub(), /Answers Today: November 25, 2026 \(#1263\)/);
        assert.equal(lastmod('/connections-answers'), '2026-11-25T05:00:00-05:00', 'nothing changed');
        assert.deepEqual(datedDirs(), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26']);
    });

    test('at midnight Eastern the today page and the yesterday page move on', () => {
        build('2026-11-26T05:00:00Z');
        assert.match(hub(), /Answers Today: November 26, 2026 \(#1264\)/);
        assert.match(hub(), /Updated <time datetime="2026-11-26T00:00:00-05:00">12:00 a\.m\. ET<\/time>/);
        assert.match(hub(), /"dateModified": "2026-11-26T00:00:00-05:00"/);
        assert.match(hub(), /"datePublished": "2026-11-25T04:00:00-05:00"/, 'when this site first published the puzzle');
        assert.ok(!hub().includes('Already on the next one'), 'Nov 27 has not started anywhere');
        assert.match(hub(), /Still on the one before\? See <a href="\/connections-answers\/yesterday">/);
        assert.match(read('connections-answers/yesterday/index.html'), /Yesterday's NYT Connections Answers: November 25, 2026 \(#1263\)/);
        assert.equal(lastmod('/connections-answers'), '2026-11-26T00:00:00-05:00');
        assert.equal(lastmod('/connections-answers/yesterday'), '2026-11-26T00:00:00-05:00');
        assert.equal(lastmod('/connections-answers/2026-11-26'), '2026-11-25T04:00:00-05:00', 'dated pages keep their update time');
        assert.ok(!datedDirs().includes('2026-11-27'));
    });

    test('the today page title has no date, and its nav link is marked current', () => {
        assert.match(hub(), /<title>Today's NYT Connections Hints and Answers<\/title>/);
        assert.match(hub(), /<link rel="canonical" href="https:\/\/wordgamehelp\.com\/connections-answers">/);
    });

    test('nothing is open until the reader opens it', () => {
        for (const rel of ['connections-answers/index.html', 'connections-answers/2026-11-26/index.html']) {
            const page = read(rel);
            assert.ok(!/<details[^>]*\sopen/.test(page), `${rel} has an open reveal`);
            assert.equal((page.match(/<details class="conn-reveal/g) || []).length, 13, `${rel} has three sets of four reveals and one for all groups`);
            // Outside the reveals, the FAQ and the structured data, the body gives no category away.
            const body = page.match(/<article[\s\S]*<\/article>/)[0].replace(/<details[\s\S]*?<\/details>/g, '');
            assert.ok(!body.includes('SHADES OF PINK'), `${rel} shows a category outside a reveal`);
        }
    });

    test('the yesterday page shows its groups open, and the archive gives nothing away', () => {
        const yesterday = read('connections-answers/yesterday/index.html');
        assert.match(yesterday, /<div class="conn-group conn-group--purple"><span class="conn-group-color">Purple<\/span> <b>DOGS BREEDS MINUS FIRST LETTER<\/b>/);
        assert.ok(!yesterday.match(/<article[\s\S]*<\/article>/)[0].includes('<details'), 'no reveals on the yesterday page');
        const archive = read('connections-answers/archive/index.html');
        assert.match(archive, /<a href="\/connections-answers\/2026-11-26">Thursday, November 26, 2026<\/a> <span class="conn-days-number">#1264<\/span>/);
        assert.ok(!archive.includes('SHADES OF PINK'));
    });

    test('a new build number rewrites the pages but changes no url and no lastmod', () => {
        const solver = path.join(site, 'spelling-bee-solver', 'index.html');
        fs.writeFileSync(solver, fs.readFileSync(solver, 'utf8').replace(/Build: [^<]+/, 'Build: test-build'));
        const urlsFile = path.join(site, 'urls.txt');
        const run = daily('2026-11-26T12:00:00Z', '--file', path.join(FIXTURES, '2026-11-26.json'), '--urls-file', urlsFile);
        assert.equal(run.status, 0, run.stderr);
        assert.match(hub(), /Build: test-build/);
        assert.equal(fs.readFileSync(urlsFile, 'utf8'), '');
        assert.equal(lastmod('/connections-answers'), '2026-11-26T00:00:00-05:00');
        assert.equal(lastmod('/connections-answers/archive'), '2026-11-25T05:00:00-05:00');
    });

    test('titles and cards are escaped', () => {
        save('2026-11-23', '2026-11-22T10:05:00Z', (puzzle) => {
            puzzle.groups[0].title = 'TAROT CARDS, WITH "THE" <B>';
            puzzle.groups[0].cards[0] = 'R&B';
            return puzzle;
        });
        build('2026-11-26T12:00:00Z');
        const page = read('connections-answers/2026-11-23/index.html');
        assert.match(page, /TAROT CARDS, WITH &quot;THE&quot; &lt;B&gt;/);
        assert.match(page, /R&amp;B/);
        assert.ok(!page.includes('<B>'));
        assert.ok(!page.includes('"THE" <'));
    });

    test('a page more than 30 days older than the newest is noindex and out of the sitemap, and stays in the archive', () => {
        const old = { ...JSON.parse(read('data/connections/2026-11-24.json')), date: '2026-10-20', number: puzzleNumber('2026-10-20') };
        fs.writeFileSync(path.join(site, 'data', 'connections', '2026-10-20.json'), JSON.stringify(old, null, 1) + '\n');
        build('2026-11-26T12:00:00Z');
        assert.match(read('connections-answers/2026-10-20/index.html'), /<meta name="robots" content="noindex, follow">/);
        assert.match(read('connections-answers/2026-11-23/index.html'), /<meta name="robots" content="index, follow">/);
        assert.ok(!sitemapDates().includes('2026-10-20'));
        assert.ok(linkedDates('connections-answers/archive/index.html').includes('2026-10-20'));
    });

    test('a removed puzzle loses its page', () => {
        fs.rmSync(path.join(site, 'data', 'connections', '2026-10-20.json'));
        build('2026-11-26T12:00:00Z');
        assert.ok(!datedDirs().includes('2026-10-20'));
    });

    test('Connections builds leave the Spelling Bee pages and sitemap lines alone', () => {
        assert.equal(hashDir('spelling-bee-answers'), beeBefore.pages);
        assert.equal(beeBlock(), beeBefore.block);
        assert.ok(read('sitemap.xml').indexOf('<!-- connections:start -->') > read('sitemap.xml').indexOf('<!-- spelling-bee:end -->'));
        assert.match(read('sitemap.xml'), /<!-- connections:end -->\n<\/urlset>/);
    });
});
