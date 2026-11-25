#!/usr/bin/env node
// Rebuilds everything made from the saved puzzles in data/spelling-bee:
//   spelling-bee-today.json     newest puzzle, for the solver's Today's puzzle button
//   spelling-bee-learned.json   words the Times accepted or turned down, for the solver's guesses
//   spelling-bee-answers/       the today page, the yesterday page, one page per date, and the archive
//   sitemap.xml                 only the lines between the spelling-bee markers
// The header and footer are copied from spelling-bee-solver/index.html on every run.
// A puzzle only gets pages once its date's 3 a.m. Eastern rollover has passed at build time, so a
// saved puzzle for a later date stays hidden until a build after its rollover.
// SPELLING_BEE_NOW (any Date string) stands in for the build time in tests.
// Dated pages more than INDEX_DAYS older than the newest puzzle get noindex and leave the sitemap,
// so the daily pages don't swamp what Google indexes. They stay on the site and in the archive.
// data/spelling-bee/last-changed.json keeps when the today page and the archive last changed, for
// their sitemap lastmod. See changeTracker in lib/site.mjs, which holds the helpers shared with Connections.
import fs from 'node:fs';
import path from 'node:path';
import {
    DATA_DIR, allPuzzles, currentWordsFile, fits, isPangram, learnRulings, letterMask,
    maxScore, puzzleMasks, rankTable, savedPuzzles, wordScore,
} from './lib/bee.mjs';
import {
    DAY_MS, ROOT, SITE, article, articleSchema, breadcrumbSchema, buildTime, changeTracker, eastern, faqHtml,
    faqSchema, isMain, listJoin, longDate, monthLabel, pageRenderer, parseDate, plural, puzzleDateAt, removeOrphans,
    sitemapEntry, spliceSitemap, stamp, weekday, writeIfChanged,
} from './lib/site.mjs';

const ANSWERS = 'spelling-bee-answers';
const RECENT_DAYS = 7;
const INDEX_DAYS = 30;
const SITEMAP_START = '<!-- spelling-bee:start -->';
const SITEMAP_END = '<!-- spelling-bee:end -->';
const CHANGES_FILE = path.join(DATA_DIR, 'last-changed.json');

const ROLLOVER_HOUR = 3;

// The date of the puzzle that is live at `now`: the New York date, or the day before it until 3 a.m.
export function currentPuzzleDate(now) {
    return puzzleDateAt(now, ROLLOVER_HOUR);
}

export function isPublished(date, now) {
    return date <= currentPuzzleDate(now);
}

export function buildPages(now = buildTime('SPELLING_BEE_NOW')) {
    const puzzles = savedPuzzles().filter((p) => isPublished(p.date, now));
    if (!puzzles.length) {
        console.log('No published puzzles in data/spelling-bee yet. Run tools/spelling-bee-daily.mjs first.');
        return [];
    }
    const words = currentWordsFile();
    const likely = new Set(words.likely);
    const everyWord = words.likely.concat(words.other);
    const indexed = everyWord.map((word) => ({ word, mask: letterMask(word) }));
    const days = puzzles.map((p) => analyze(p, indexed, likely));
    const today = days[days.length - 1];
    const past = days.slice(0, -1);
    const newest = parseDate(today.date);
    for (const day of days) day.indexed = (newest - parseDate(day.date)) / DAY_MS < INDEX_DAYS;
    const render = pageRenderer();
    const tracker = changeTracker(CHANGES_FILE, now);
    const changed = [];
    const write = (rel, contents) => {
        if (writeIfChanged(path.join(ROOT, rel), contents)) changed.push(rel);
    };

    const learnedFrom = allPuzzles().filter((p) => isPublished(p.date, now));
    write('spelling-bee-learned.json', learnedJson(learnRulings(learnedFrom, everyWord), likely, learnedFrom));
    write('spelling-bee-today.json', todayJson(puzzles[puzzles.length - 1]));
    days.forEach((day, i) => {
        write(`${ANSWERS}/${day.date}/index.html`, render(dayPage(day, days[i - 1], days[i + 1])));
    });
    const hub = todayPage(today, past);
    const hubChanged = tracker.changed(`/${ANSWERS}`, hub);
    write(`${ANSWERS}/index.html`, render(hub));
    if (past.length) write(`${ANSWERS}/yesterday/index.html`, render(yesterdayPage(past[past.length - 1], today)));
    const archiveChanged = tracker.changed(`/${ANSWERS}/archive`, archivePage(days));
    write(`${ANSWERS}/archive/index.html`, render(archivePage(days, eastern(archiveChanged).iso)));
    write(path.relative(ROOT, CHANGES_FILE), tracker.json());
    write('sitemap.xml', sitemap(today, past, { hub: hubChanged, archive: archiveChanged }));
    removeOrphans(ANSWERS, new Set(days.map((day) => day.date)), changed);
    return changed;
}

function analyze(p, indexed, likely) {
    const masks = puzzleMasks(p);
    const answers = [...p.answers].sort();
    const official = new Set(answers);
    const leftOut = indexed.filter(({ word, mask }) => !official.has(word) && fits(mask, masks)).map(({ word }) => word);
    const points = maxScore(answers);
    return {
        date: p.date,
        published: p.published,
        updated: p.updated,
        center: p.center,
        outer: [...p.outer].sort(),
        answers,
        pangrams: answers.filter(isPangram),
        points,
        ranks: rankTable(points),
        leftCommon: leftOut.filter((word) => likely.has(word)),
        leftRare: leftOut.filter((word) => !likely.has(word)),
    };
}

function learnedJson(rulings, likely, puzzles) {
    const accepted = [];
    const rejected = [];
    for (const [word, ok] of rulings) {
        if (ok && !likely.has(word)) accepted.push(word);
        if (!ok && likely.has(word)) rejected.push(word);
    }
    return JSON.stringify({
        updated: puzzles[puzzles.length - 1].date,
        puzzles: puzzles.length,
        accepted: accepted.sort(),
        rejected: rejected.sort(),
    }, null, 1) + '\n';
}

function todayJson(p) {
    return JSON.stringify({
        date: p.date,
        center: p.center,
        outer: [...p.outer].sort(),
        pangrams: p.pangrams,
        answers: p.answers,
        url: `/${ANSWERS}`,
    }) + '\n';
}

const up = (word) => word.toUpperCase();
const dayUrl = (date) => `/${ANSWERS}/${date}`;
const geniusPoints = (day) => day.ranks.find((rank) => rank.name === 'Genius').points;

function hiveHtml(day) {
    const tiles = [`<li class="bee-tile bee-tile--center"><span class="visually-hidden">Center letter </span>${up(day.center)}</li>`]
        .concat(day.outer.map((letter) => `<li class="bee-tile">${up(letter)}</li>`));
    return `<ul class="bee-hive" aria-label="Puzzle letters, center letter first">${tiles.join('')}</ul>`;
}

function summaryText(day) {
    const pangrams = day.pangrams.length === 1 ? '1 of them is a pangram' : `${day.pangrams.length} of them are pangrams`;
    return `The center letter is ${up(day.center)}. The other six are ${listJoin(day.outer.map(up))}. `
        + `The Times accepts ${plural(day.answers.length, 'word')} worth ${day.points} points, and ${pangrams}. `
        + `Genius takes ${geniusPoints(day)} points. Queen Bee takes all ${day.points}.`;
}

function gridHtml(words) {
    const lengths = [...new Set(words.map((w) => w.length))].sort((a, b) => a - b);
    const firsts = [...new Set(words.map((w) => w[0]))].sort();
    const count = (first, length) => words.filter((w) => (!first || w[0] === first) && (!length || w.length === length)).length;
    const head = `<tr><th scope="col"><span class="visually-hidden">First letter</span></th>${lengths.map((l) => `<th scope="col">${l}</th>`).join('')}<th scope="col">Σ</th></tr>`;
    const rows = firsts.map((f) => `<tr><th scope="row">${up(f)}</th>${lengths.map((l) => `<td>${count(f, l) || '-'}</td>`).join('')}<td>${count(f)}</td></tr>`);
    const foot = `<tr><th scope="row">Σ</th>${lengths.map((l) => `<td>${count(null, l)}</td>`).join('')}<td>${words.length}</td></tr>`;
    return `<div class="bee-grid-scroll"><table class="bee-grid"><caption>Rows are first letters. Columns are word lengths. Σ is the total.</caption>`
        + `<thead>${head}</thead><tbody>${rows.join('')}</tbody><tfoot>${foot}</tfoot></table></div>`;
}

function twosHtml(words) {
    const tally = new Map();
    for (const w of words) tally.set(w.slice(0, 2), (tally.get(w.slice(0, 2)) || 0) + 1);
    const items = [...tally].sort(([a], [b]) => a.localeCompare(b)).map(([pair, n]) => `<li>${up(pair)}-${n}</li>`);
    return `<ul class="bee-twos">${items.join('')}</ul>`;
}

function pangramHintsHtml(day) {
    const items = day.pangrams.map((w) => `<li>${w.length} letters, starts with ${up(w[0])}${w.length === 7 ? '. Perfect pangram: each letter once.' : ''}</li>`);
    return `<p>${day.pangrams.length === 1 ? 'One pangram uses all seven letters.' : `${day.pangrams.length} pangrams use all seven letters.`}</p><ul>${items.join('')}</ul>`;
}

function wordList(words, boldPangrams = true) {
    return `<ul class="word-cols">${words.map((w) => (boldPangrams && isPangram(w) ? `<li><b>${up(w)}</b></li>` : `<li>${up(w)}</li>`)).join('')}</ul>`;
}

function answersHtml(day) {
    const byLength = new Map();
    for (const w of day.answers) byLength.set(w.length, (byLength.get(w.length) || []).concat(w));
    const groups = [`<details class="bee-reveal"><summary>${day.pangrams.length === 1 ? 'Pangram' : 'Pangrams'} (${day.pangrams.length})</summary>${wordList(day.pangrams)}</details>`];
    for (const [length, words] of [...byLength].sort(([a], [b]) => a - b)) {
        groups.push(`<details class="bee-reveal"><summary>${length}-letter words (${words.length})</summary>${wordList(words)}</details>`);
    }
    groups.push(`<details class="bee-reveal"><summary>All ${day.answers.length} answers, A to Z</summary>${wordList(day.answers)}</details>`);
    return groups.join('\n            ');
}

function ranksHtml(day) {
    const rows = day.ranks.map((r) => `<tr><td>${r.name}</td><td class="num">${r.pct}%</td><td class="num">${r.points}</td></tr>`);
    return `<table class="score-table"><thead><tr><th scope="col">Rank</th><th scope="col" class="num">Share</th><th scope="col" class="num">Points</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function leftOutHtml(day) {
    if (!day.leftCommon.length && !day.leftRare.length) {
        return '<p>Every word in this site\'s list that fits these letters is an answer.</p>';
    }
    const parts = ['<p>These fit the letters and are in the Scrabble word list this site uses, but the Times did not accept them. Common words come first.</p>'];
    if (day.leftCommon.length) parts.push(`<details class="bee-reveal"><summary>Common words (${day.leftCommon.length})</summary>${wordList(day.leftCommon, false)}</details>`);
    if (day.leftRare.length) parts.push(`<details class="bee-reveal"><summary>Rare Scrabble words (${day.leftRare.length})</summary>${wordList(day.leftRare, false)}</details>`);
    return parts.join('\n            ');
}

function dayNavHtml(prev, next) {
    const prevLink = prev ? `<a href="${dayUrl(prev.date)}" rel="prev">← ${longDate(prev.date)}</a>` : '<span></span>';
    const nextLink = next ? `<a href="${dayUrl(next.date)}" rel="next">${longDate(next.date)} →</a>` : `<a href="/${ANSWERS}">Today's puzzle →</a>`;
    return `<nav class="bee-daynav" aria-label="Other days">${prevLink}<a href="/${ANSWERS}/archive">All days</a>${nextLink}</nav>`;
}

function faqItems(day) {
    const date = longDate(day.date);
    const lengths = day.answers.map((w) => w.length);
    const pangrams = listJoin(day.pangrams.map((w) => `${up(w)} (${wordScore(w)} points)`));
    return [
        day.pangrams.length === 1
            ? { q: `What is the pangram in the ${date} Spelling Bee?`, a: `${pangrams}. A pangram uses all seven letters and earns 7 bonus points.` }
            : { q: `What are the pangrams in the ${date} Spelling Bee?`, a: `${pangrams}. A pangram uses all seven letters and earns 7 bonus points.` },
        { q: `How many words are in the ${date} Spelling Bee?`, a: `The Times accepts ${plural(day.answers.length, 'word')} worth ${day.points} points. They run from ${Math.min(...lengths)} to ${Math.max(...lengths)} letters.` },
        { q: `How many points do you need for Genius on ${date}?`, a: `${geniusPoints(day)} points, 70% of the ${day.points} total. Queen Bee means finding all ${day.answers.length} words.` },
    ];
}

function puzzleSections(day) {
    return [
        `<p>${summaryText(day)}</p>`,
        '<p>Hints come first. The answers stay hidden until you open them.</p>',
        '<h2>Hints</h2>',
        gridHtml(day.answers),
        '<h3>Two-letter starts</h3>',
        '<p>How many answers begin with each pair of letters.</p>',
        twosHtml(day.answers),
        '<h3>Pangrams</h3>',
        pangramHintsHtml(day),
        '<h2>Answers</h2>',
        '<p>Open a group to see its words. Pangrams are in bold.</p>',
        answersHtml(day),
        '<h2>Ranks</h2>',
        `<p>Ranks are shares of the ${day.points}-point total, rounded.</p>`,
        ranksHtml(day),
        '<h2>Words the Times left out</h2>',
        leftOutHtml(day),
    ];
}

function dayPage(day, prev, next) {
    const date = longDate(day.date);
    const title = `NYT Spelling Bee Answers for ${date}`;
    const url = `${SITE}${dayUrl(day.date)}`;
    const description = `Hints and answers for the NYT Spelling Bee on ${weekday(day.date)}, ${date}. Center letter ${up(day.center)}, outer letters ${day.outer.map(up).join(' ')}. ${plural(day.answers.length, 'word')}, ${day.points} points, ${plural(day.pangrams.length, 'pangram')}.`;
    const faq = faqItems(day);
    const main = article('bee-day', [
        `<p class="guide-kicker"><a href="/${ANSWERS}">Spelling Bee answers</a> · ${weekday(day.date)}</p>`,
        `<h1>${title}</h1>`,
        hiveHtml(day),
        ...puzzleSections(day),
        dayNavHtml(prev, next),
        '<p>Working on a different puzzle? The <a href="/spelling-bee-solver">Spelling Bee solver</a> takes any seven letters and gives the same hints.</p>',
    ]) + '\n' + faqHtml(faq);
    return {
        title,
        description,
        url,
        noindex: !day.indexed,
        main,
        schema: [
            articleSchema(title, description, url, stamp(day.published, day.date), stamp(day.updated, day.date)),
            breadcrumbSchema([['Word Game Helper', `${SITE}/`], ['Spelling Bee answers', `${SITE}/${ANSWERS}`], [date, url]]),
            faqSchema(faq),
        ],
    };
}

function recentHtml(days) {
    const items = days.map((day) => `<li><a href="${dayUrl(day.date)}">${weekday(day.date)}, ${longDate(day.date)}</a> <span class="bee-days-letters"><b>${up(day.center)}</b> ${day.outer.map(up).join('')}</span> <span class="bee-days-count">${plural(day.answers.length, 'word')}</span></li>`);
    return `<ul class="bee-days">${items.join('')}</ul>`;
}

// No date in the title: Google can show a cached title for days, and a dated one would name the wrong
// puzzle. The date goes in the H1.
function todayPage(day, past) {
    const date = longDate(day.date);
    const title = 'Today\'s NYT Spelling Bee Answers, Hints and Pangrams';
    const heading = `NYT Spelling Bee Answers Today: ${date}`;
    const url = `${SITE}/${ANSWERS}`;
    const description = `Today's NYT Spelling Bee hints and answers for ${weekday(day.date)}, ${date}. Center letter ${up(day.center)}, outer letters ${day.outer.map(up).join(' ')}. ${plural(day.answers.length, 'word')}, ${day.points} points, ${plural(day.pangrams.length, 'pangram')}.`;
    const recent = past.slice(-RECENT_DAYS).reverse();
    const faq = faqItems(day);
    const updated = day.updated && eastern(day.updated);
    const intro = [
        updated && `Updated <time datetime="${updated.iso}">${updated.clock}</time>.`,
        'The Times posts a new Spelling Bee at 3 a.m. Eastern, and this page switches to it soon after.',
        past.length && `Still on the one before? See <a href="/${ANSWERS}/yesterday">yesterday's answers</a>.`,
    ].filter(Boolean).join(' ');
    const lines = [
        `<p class="guide-kicker">Spelling Bee answers · ${weekday(day.date)}</p>`,
        `<h1>${heading}</h1>`,
        `<p>${intro}</p>`,
        hiveHtml(day),
        ...puzzleSections(day),
    ];
    lines.push(`<p>This puzzle keeps its own page: <a href="${dayUrl(day.date)}">${date}</a>.</p>`);
    if (past.length) {
        lines.push(
            '<h2>Recent Spelling Bee answers</h2>',
            recentHtml(recent),
            `<p><a href="/${ANSWERS}/archive">Every puzzle since ${longDate(past[0].date)}</a></p>`,
        );
    }
    lines.push('<p>Working on a different puzzle? The <a href="/spelling-bee-solver">Spelling Bee solver</a> takes any seven letters and gives the same hints.</p>');
    return {
        title,
        description,
        url,
        current: `/${ANSWERS}`,
        main: article('bee-day', lines) + '\n' + faqHtml(faq),
        schema: [
            articleSchema(heading, description, url, stamp(day.published, day.date), stamp(day.updated, day.date)),
            breadcrumbSchema([['Word Game Helper', `${SITE}/`], ['Spelling Bee answers', url]]),
            faqSchema(faq),
        ],
    };
}

// Answers first, with no hints, ranks, or FAQ, so it doesn't copy the dated page it links to.
function yesterdayPage(day, today) {
    const date = longDate(day.date);
    const title = 'Yesterday\'s NYT Spelling Bee Answers';
    const heading = `Yesterday's NYT Spelling Bee Answers: ${date}`;
    const url = `${SITE}/${ANSWERS}/yesterday`;
    const pangrams = listJoin(day.pangrams.map(up));
    const pangramLine = day.pangrams.length === 1 ? `The pangram was ${pangrams}.` : `The pangrams were ${pangrams}.`;
    const description = `All ${day.answers.length} answers to yesterday's NYT Spelling Bee, ${weekday(day.date)}, ${date}. Center letter ${up(day.center)}, outer letters ${day.outer.map(up).join(' ')}. ${pangramLine}`;
    const switched = stamp(today.published, today.date);
    const lines = [
        `<p class="guide-kicker"><a href="/${ANSWERS}">Spelling Bee answers</a> · ${weekday(day.date)}</p>`,
        `<h1>${heading}</h1>`,
        hiveHtml(day),
        `<p>The center letter was ${up(day.center)}, and the other six were ${listJoin(day.outer.map(up))}. The Times accepted ${plural(day.answers.length, 'word')} worth ${day.points} points. ${pangramLine}</p>`,
        `<h2>All ${day.answers.length} answers</h2>`,
        '<p>Pangrams are in bold.</p>',
        wordList(day.answers),
        `<p>The hint grid, ranks, and words the Times left out are on the <a href="${dayUrl(day.date)}">${date} page</a>. This page moves to the next puzzle when the Times posts a new one at 3 a.m. Eastern.</p>`,
        `<p>Today's puzzle is on <a href="/${ANSWERS}">today's Spelling Bee answers</a> page.</p>`,
    ];
    return {
        title,
        description,
        url,
        main: article('bee-day bee-yesterday', lines),
        schema: [
            articleSchema(heading, description, url, switched, switched),
            breadcrumbSchema([['Word Game Helper', `${SITE}/`], ['Spelling Bee answers', `${SITE}/${ANSWERS}`], ['Yesterday', url]]),
        ],
    };
}

// `modified` is left out when the content is hashed, so the page's own time doesn't count as a change.
function archivePage(days, modified) {
    const title = 'NYT Spelling Bee Answers Archive | Word Game Helper';
    const url = `${SITE}/${ANSWERS}/archive`;
    const first = longDate(days[0].date);
    const description = `Hints and answers for every NYT Spelling Bee since ${first}, newest first. Letters, word counts, pangrams, and the words the Times left out.`;
    const lines = [
        `<p class="guide-kicker"><a href="/${ANSWERS}">Spelling Bee answers</a></p>`,
        '<h1>NYT Spelling Bee Answers Archive</h1>',
        `<p>Every puzzle since ${first}, newest first. Each page has a hint grid, all the answers, and the words the Times left out. The center letter is in bold.</p>`,
        `<p>Today's puzzle is also on <a href="/${ANSWERS}">today's answers page</a>.</p>`,
    ];
    const months = new Map();
    for (const day of [...days].reverse()) {
        const label = monthLabel(day.date);
        months.set(label, (months.get(label) || []).concat(day));
    }
    for (const [label, list] of months) lines.push(`<h2>${label}</h2>`, recentHtml(list));
    return {
        title,
        description,
        url,
        main: article('bee-archive', lines),
        schema: [
            {
                '@context': 'https://schema.org',
                '@type': 'CollectionPage',
                name: 'NYT Spelling Bee Answers Archive',
                description,
                url,
                dateModified: modified,
                isPartOf: { '@type': 'WebSite', name: 'Word Game Helper', url: `${SITE}/` },
            },
            breadcrumbSchema([['Word Game Helper', `${SITE}/`], ['Spelling Bee answers', `${SITE}/${ANSWERS}`], ['Archive', url]]),
        ],
    };
}

// Dated pages use their answer list's update time and the yesterday page the time today's puzzle was
// saved, the same New York times as their dateModified. The today page and the archive use the time
// their content last changed (see changeTracker in lib/site.mjs). The archive's dateModified is that
// time too. The today page's dateModified stays its answer list's update time, to match the Updated
// line readers see. The daily job saves and builds on one clock, so on a normal day the two are the same.
function sitemap(today, past, changed) {
    const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    const switched = stamp(today.published, today.date);
    return spliceSitemap(xml, SITEMAP_START, SITEMAP_END, [
        sitemapEntry(`/${ANSWERS}`, eastern(changed.hub).iso),
        ...(past.length ? [sitemapEntry(`/${ANSWERS}/yesterday`, switched)] : []),
        sitemapEntry(`/${ANSWERS}/archive`, eastern(changed.archive).iso),
        ...[today, ...past.slice().reverse()].filter((day) => day.indexed).map((day) => sitemapEntry(dayUrl(day.date), stamp(day.updated, day.date))),
    ]);
}

if (isMain(import.meta.url)) {
    const changed = buildPages();
    console.log(changed.length ? `Updated ${plural(changed.length, 'file')}:\n  ${changed.join('\n  ')}` : 'Spelling Bee pages are up to date.');
}
