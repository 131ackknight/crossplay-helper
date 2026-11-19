// node --test 'tools/test/*.test.mjs'
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, describe, test } from 'node:test';
import { currentPuzzleDate, isPublished } from '../build-spelling-bee-pages.mjs';
import { ROOT } from '../lib/bee.mjs';

describe('currentPuzzleDate', () => {
    const cases = [
        ['2026-11-19T07:59:59Z', '2026-11-18', 'one second before 3 a.m. EST'],
        ['2026-11-19T08:00:00Z', '2026-11-19', '3 a.m. EST'],
        ['2026-11-19T08:26:42Z', '2026-11-19', 'the daily job on Nov 19'],
        ['2026-11-19T05:00:00Z', '2026-11-18', 'midnight EST on Nov 19, before rollover'],
        ['2026-11-20T02:00:00Z', '2026-11-19', '9 p.m. EST on Nov 19, already Nov 20 in UTC'],
        ['2026-11-20T04:59:59Z', '2026-11-19', '11:59 p.m. EST on Nov 19'],
        ['2026-07-01T06:59:59Z', '2026-06-30', 'one second before 3 a.m. EDT'],
        ['2026-07-01T07:00:00Z', '2026-07-01', '3 a.m. EDT'],
        ['2026-03-08T06:59:59Z', '2026-03-07', 'spring forward day, 1:59 a.m. EST'],
        ['2026-03-08T07:00:00Z', '2026-03-08', 'spring forward day, 3 a.m. EDT'],
        ['2026-11-01T07:59:59Z', '2026-10-31', 'fall back day, 2:59 a.m. EST'],
        ['2026-11-01T08:00:00Z', '2026-11-01', 'fall back day, 3 a.m. EST'],
        ['2027-01-01T07:59:59Z', '2026-12-31', 'new year, before rollover'],
        ['2027-01-01T08:00:00Z', '2027-01-01', 'new year, after rollover'],
    ];
    for (const [now, expected, label] of cases) {
        test(`${now} is ${expected}`, () => assert.equal(currentPuzzleDate(new Date(now)), expected, label));
    }
});

describe('isPublished', () => {
    test('past dates stay published', () => {
        const now = new Date('2026-11-19T07:59:59Z');
        for (const date of ['2025-01-01', '2026-11-17', '2026-11-18']) assert.ok(isPublished(date, now), date);
    });
    test('the new date is hidden just before 3 a.m. ET and published at 3 a.m. ET', () => {
        assert.equal(isPublished('2026-11-19', new Date('2026-11-19T07:59:59Z')), false);
        assert.equal(isPublished('2026-11-19', new Date('2026-11-19T08:00:00Z')), true);
    });
    test('a UTC date change alone does not publish the next date', () => {
        assert.equal(isPublished('2026-11-20', new Date('2026-11-20T03:00:00Z')), false);
    });
    test('future dates are hidden', () => {
        assert.equal(isPublished('2026-11-21', new Date('2026-11-20T12:00:00Z')), false);
    });
});

// Runs the real builder on a copy of the site with a saved puzzle for Nov 20 that is not out yet.
describe('built pages', () => {
    let site;
    const answers = () => path.join(site, 'spelling-bee-answers');
    const read = (rel) => fs.readFileSync(path.join(site, rel), 'utf8');
    const datedDirs = () => fs.readdirSync(answers()).filter((name) => /^\d{4}-\d{2}-\d{2}$/.test(name)).sort();
    const sitemapDates = () => [...read('sitemap.xml').matchAll(/spelling-bee-answers\/(\d{4}-\d{2}-\d{2})</g)].map((m) => m[1]).sort();
    const linkedDates = (rel) => [...new Set([...read(rel).matchAll(/href="\/spelling-bee-answers\/(\d{4}-\d{2}-\d{2})"/g)].map((m) => m[1]))].sort();
    const build = (now) => execFileSync(process.execPath, [path.join(site, 'tools', 'build-spelling-bee-pages.mjs')], {
        env: { ...process.env, SPELLING_BEE_NOW: now },
    });

    before(() => {
        site = fs.mkdtempSync(path.join(os.tmpdir(), 'bee-pages-'));
        const copy = (rel) => fs.cpSync(path.join(ROOT, rel), path.join(site, rel), { recursive: true });
        ['tools', 'data', 'spelling-bee-answers', 'spelling-bee-solver', 'sitemap.xml'].forEach(copy);
        fs.readdirSync(ROOT).filter((f) => /^spelling-bee-words\.\d{8}\.js$/.test(f)).forEach(copy);
        const dataDir = path.join(site, 'data', 'spelling-bee');
        for (const f of fs.readdirSync(dataDir)) if (f > '2026-11-19.json') fs.rmSync(path.join(dataDir, f));
        const nov19 = JSON.parse(fs.readFileSync(path.join(dataDir, '2026-11-19.json'), 'utf8'));
        const nov20 = { ...nov19, date: '2026-11-20', published: '2026-11-20T08:20:00Z', updated: '2026-11-20T08:20:00Z' };
        fs.writeFileSync(path.join(dataDir, '2026-11-20.json'), JSON.stringify(nov20, null, 1) + '\n');
    });
    after(() => fs.rmSync(site, { recursive: true, force: true }));

    test('before the Nov 19 rollover, past dates are live and Nov 19 is hidden', () => {
        build('2026-11-19T07:59:59Z');
        assert.deepEqual(datedDirs(), ['2026-11-17', '2026-11-18']);
        assert.deepEqual(sitemapDates(), ['2026-11-17', '2026-11-18']);
        assert.match(read('spelling-bee-answers/index.html'), /Answers Today: November 18, 2026/);
        assert.deepEqual(linkedDates('spelling-bee-answers/archive/index.html'), ['2026-11-17', '2026-11-18']);
    });

    test('after the Nov 19 rollover, today and every past date are live, in the sitemap, and linked', () => {
        build('2026-11-19T08:26:42Z');
        const expected = ['2026-11-17', '2026-11-18', '2026-11-19'];
        assert.deepEqual(datedDirs(), expected);
        assert.deepEqual(sitemapDates(), expected);
        assert.deepEqual(linkedDates('spelling-bee-answers/index.html'), expected);
        assert.deepEqual(linkedDates('spelling-bee-answers/archive/index.html'), expected);
        assert.match(read('spelling-bee-answers/index.html'), /Answers Today: November 19, 2026/);
        assert.match(read('spelling-bee-answers/2026-11-19/index.html'), /NYT Spelling Bee Answers for November 19, 2026/);
        assert.match(read('spelling-bee-answers/yesterday/index.html'), /November 18, 2026/);
        assert.equal(JSON.parse(read('spelling-bee-today.json')).date, '2026-11-19');
    });

    test('in the evening of Nov 19 ET, after UTC has moved to Nov 20, Nov 20 stays hidden', () => {
        build('2026-11-20T04:30:00Z');
        assert.deepEqual(datedDirs(), ['2026-11-17', '2026-11-18', '2026-11-19']);
        assert.ok(!sitemapDates().includes('2026-11-20'));
        assert.equal(JSON.parse(read('spelling-bee-today.json')).date, '2026-11-19');
    });

    test('just before 3 a.m. ET on Nov 20, Nov 20 stays hidden', () => {
        build('2026-11-20T07:59:59Z');
        assert.ok(!datedDirs().includes('2026-11-20'));
        assert.ok(!sitemapDates().includes('2026-11-20'));
        assert.ok(!linkedDates('spelling-bee-answers/archive/index.html').includes('2026-11-20'));
    });

    test('at 3 a.m. ET on Nov 20, Nov 20 goes live and Nov 19 keeps its page', () => {
        build('2026-11-20T08:00:00Z');
        const expected = ['2026-11-17', '2026-11-18', '2026-11-19', '2026-11-20'];
        assert.deepEqual(datedDirs(), expected);
        assert.deepEqual(sitemapDates(), expected);
        assert.deepEqual(linkedDates('spelling-bee-answers/archive/index.html'), expected);
        assert.match(read('spelling-bee-answers/index.html'), /Answers Today: November 20, 2026/);
    });
});
