#!/usr/bin/env node
// Rebuilds everything made from the saved puzzles in data/spelling-bee:
//   spelling-bee-today.json     newest puzzle, for the solver's Today's puzzle button
//   spelling-bee-learned.json   words the Times accepted or turned down, for the solver's guesses
//   spelling-bee-answers/       the today page, one page per date, and the archive
//   sitemap.xml                 only the lines between the spelling-bee markers
// The header and footer are copied from spelling-bee-solver/index.html on every run.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
    ROOT, SITE, allPuzzles, currentWordsFile, escapeHtml, fits, isPangram, learnRulings, letterMask,
    longDate, maxScore, monthLabel, puzzleMasks, rankTable, savedPuzzles, weekday, wordScore, writeIfChanged,
} from './lib/bee.mjs';

const ANSWERS = 'spelling-bee-answers';
const TEMPLATE = path.join(ROOT, 'tools', 'templates', 'spelling-bee-page.html');
const CHROME_PAGE = path.join(ROOT, 'spelling-bee-solver', 'index.html');
const RECENT_DAYS = 7;
const SITEMAP_START = '<!-- spelling-bee:start -->';
const SITEMAP_END = '<!-- spelling-bee:end -->';

export function buildPages() {
    const puzzles = savedPuzzles();
    if (!puzzles.length) {
        console.log('No puzzles in data/spelling-bee yet. Run tools/spelling-bee-daily.mjs first.');
        return [];
    }
    const words = currentWordsFile();
    const likely = new Set(words.likely);
    const everyWord = words.likely.concat(words.other);
    const indexed = everyWord.map((word) => ({ word, mask: letterMask(word) }));
    const days = puzzles.map((p) => analyze(p, indexed, likely));
    const render = pageRenderer();
    const changed = [];
    const write = (rel, contents) => {
        if (writeIfChanged(path.join(ROOT, rel), contents)) changed.push(rel);
    };

    const learnedFrom = allPuzzles();
    write('spelling-bee-learned.json', learnedJson(learnRulings(learnedFrom, everyWord), likely, learnedFrom));
    write('spelling-bee-today.json', todayJson(puzzles[puzzles.length - 1]));
    days.forEach((day, i) => {
        write(`${ANSWERS}/${day.date}/index.html`, render(dayPage(day, days[i - 1], days[i + 1])));
    });
    write(`${ANSWERS}/index.html`, render(todayPage(days)));
    write(`${ANSWERS}/archive/index.html`, render(archivePage(days)));
    write('sitemap.xml', sitemap(days));
    removeOrphans(new Set(days.map((day) => day.date)), changed);
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
        url: dayUrl(p.date),
    }) + '\n';
}

const up = (word) => word.toUpperCase();
const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const dayUrl = (date) => `/${ANSWERS}/${date}`;
const geniusPoints = (day) => day.ranks.find((rank) => rank.name === 'Genius').points;

function listJoin(items) {
    if (items.length < 3) return items.join(' and ');
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

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
    const nextLink = next ? `<a href="${dayUrl(next.date)}" rel="next">${longDate(next.date)} →</a>` : '<span></span>';
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

function faqHtml(items) {
    const rows = items.map(({ q, a }) => `                    <details><summary>${escapeHtml(q)}<span class="faq-plus">+</span></summary><p>${escapeHtml(a)}</p></details>`);
    return [
        '        <section class="faq-band">',
        '            <div class="faq-inner">',
        '                <h2>Questions about this puzzle</h2>',
        '                <div class="faq-list">',
        ...rows,
        '                </div>',
        '            </div>',
        '        </section>',
    ].join('\n');
}

function faqSchema(items) {
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    };
}

function breadcrumbSchema(trail) {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: trail.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })),
    };
}

function webPageSchema(title, description, url, date) {
    return {
        '@context': 'https://schema.org',
        '@type': 'WebPage',
        name: title,
        description,
        url,
        datePublished: date,
        dateModified: date,
        isPartOf: { '@type': 'WebSite', name: 'Word Game Helper', url: `${SITE}/` },
    };
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

function article(className, lines) {
    return [`        <article class="prose wrap guide ${className}">`, ...lines.map((line) => `            ${line}`), '        </article>'].join('\n');
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
        main,
        schema: [
            webPageSchema(title, description, url, day.date),
            breadcrumbSchema([['Word Game Helper', `${SITE}/`], ['Spelling Bee answers', `${SITE}/${ANSWERS}`], [date, url]]),
            faqSchema(faq),
        ],
    };
}

function recentHtml(days) {
    const items = days.map((day) => `<li><a href="${dayUrl(day.date)}">${weekday(day.date)}, ${longDate(day.date)}</a> <span class="bee-days-letters"><b>${up(day.center)}</b> ${day.outer.map(up).join('')}</span> <span class="bee-days-count">${plural(day.answers.length, 'word')}</span></li>`);
    return `<ul class="bee-days">${items.join('')}</ul>`;
}

function todayPage(days) {
    const day = days[days.length - 1];
    const date = longDate(day.date);
    const title = `NYT Spelling Bee Answers Today: ${date}`;
    const url = `${SITE}/${ANSWERS}`;
    const description = `Today's NYT Spelling Bee hints and answers for ${weekday(day.date)}, ${date}. Center letter ${up(day.center)}, outer letters ${day.outer.map(up).join(' ')}. ${plural(day.answers.length, 'word')}, ${day.points} points, ${plural(day.pangrams.length, 'pangram')}.`;
    const recent = days.slice(0, -1).slice(-RECENT_DAYS).reverse();
    const faq = faqItems(day);
    const lines = [
        `<p class="guide-kicker">Spelling Bee answers · ${weekday(day.date)}</p>`,
        `<h1>${title}</h1>`,
        '<p>The Times posts a new Spelling Bee at 3 a.m. Eastern. This page switches to the new puzzle soon after.</p>',
        hiveHtml(day),
        ...puzzleSections(day),
        `<p>This puzzle keeps its own page after today: <a href="${dayUrl(day.date)}">${date}</a>.</p>`,
    ];
    if (recent.length) {
        lines.push('<h2>Recent Spelling Bee answers</h2>', recentHtml(recent));
    }
    lines.push(
        `<p><a href="/${ANSWERS}/archive">Every puzzle since ${longDate(days[0].date)}</a></p>`,
        '<p>Working on a different puzzle? The <a href="/spelling-bee-solver">Spelling Bee solver</a> takes any seven letters and gives the same hints.</p>',
    );
    return {
        title,
        description,
        url,
        current: `/${ANSWERS}`,
        main: article('bee-day', lines) + '\n' + faqHtml(faq),
        schema: [
            webPageSchema(title, description, url, day.date),
            breadcrumbSchema([['Word Game Helper', `${SITE}/`], ['Spelling Bee answers', url]]),
            faqSchema(faq),
        ],
    };
}

function archivePage(days) {
    const title = 'NYT Spelling Bee Answers Archive | Word Game Helper';
    const url = `${SITE}/${ANSWERS}/archive`;
    const first = longDate(days[0].date);
    const description = `Hints and answers for every NYT Spelling Bee since ${first}, newest first. Letters, word counts, pangrams, and the words the Times left out.`;
    const lines = [
        `<p class="guide-kicker"><a href="/${ANSWERS}">Spelling Bee answers</a></p>`,
        '<h1>NYT Spelling Bee Answers Archive</h1>',
        `<p>Every puzzle since ${first}, newest first. Each page has a hint grid, all the answers, and the words the Times left out. The center letter is in bold.</p>`,
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
                dateModified: days[days.length - 1].date,
                isPartOf: { '@type': 'WebSite', name: 'Word Game Helper', url: `${SITE}/` },
            },
            breadcrumbSchema([['Word Game Helper', `${SITE}/`], ['Spelling Bee answers', `${SITE}/${ANSWERS}`], ['Archive', url]]),
        ],
    };
}

function jsonLdHtml(objects) {
    return objects.map((o) => {
        const json = JSON.stringify(o, null, 4).replace(/</g, '\\u003c').replace(/^/gm, '    ');
        return `    <script type="application/ld+json">\n${json}\n    </script>`;
    }).join('\n');
}

function pageRenderer() {
    const template = fs.readFileSync(TEMPLATE, 'utf8');
    const source = fs.readFileSync(CHROME_PAGE, 'utf8');
    const header = source.match(/<header class="site-header">[\s\S]*?<\/header>/);
    const footer = source.match(/<footer class="site-footer">[\s\S]*?<\/footer>/);
    if (!header || !footer) throw new Error('No header or footer found in spelling-bee-solver/index.html');
    const plainHeader = header[0].replace(/ aria-current="page"/g, '');
    return (page) => {
        const values = {
            TITLE: escapeHtml(page.title),
            DESCRIPTION: escapeHtml(page.description),
            URL: page.url,
            JSON_LD: jsonLdHtml(page.schema),
            HEADER: page.current ? plainHeader.replace(`href="${page.current}"`, `href="${page.current}" aria-current="page"`) : plainHeader,
            MAIN: page.main,
            FOOTER: footer[0],
        };
        return template.replace(/{{(\w+)}}/g, (match, key) => {
            if (!(key in values)) throw new Error(`Unknown template key ${key}`);
            return values[key];
        });
    };
}

function sitemap(days) {
    const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    const latest = days[days.length - 1].date;
    const entry = (loc, lastmod) => `  <url>\n    <loc>${SITE}${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
    const block = [
        `  ${SITEMAP_START}`,
        entry(`/${ANSWERS}`, latest),
        entry(`/${ANSWERS}/archive`, latest),
        ...[...days].reverse().map((day) => entry(dayUrl(day.date), day.date)),
        `  ${SITEMAP_END}`,
    ].join('\n');
    const start = xml.indexOf(SITEMAP_START);
    const end = xml.indexOf(SITEMAP_END);
    if (start !== -1 && end !== -1) {
        return xml.slice(0, xml.lastIndexOf('\n', start) + 1) + block + xml.slice(end + SITEMAP_END.length);
    }
    return xml.replace('</urlset>', `${block}\n</urlset>`);
}

function removeOrphans(dates, changed) {
    const dir = path.join(ROOT, ANSWERS);
    for (const name of fs.readdirSync(dir)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(name) && !dates.has(name)) {
            fs.rmSync(path.join(dir, name), { recursive: true });
            changed.push(`${ANSWERS}/${name} (removed)`);
        }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    const changed = buildPages();
    console.log(changed.length ? `Updated ${plural(changed.length, 'file')}:\n  ${changed.join('\n  ')}` : 'Spelling Bee pages are up to date.');
}
