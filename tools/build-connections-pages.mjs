#!/usr/bin/env node
// Rebuilds everything made from the saved puzzles in data/connections:
//   connections-answers/   the today page, the yesterday page, one page per date, and the archive
//   sitemap.xml            only the lines between the connections markers
// The header and footer are copied from spelling-bee-solver/index.html on every run.
//
// Two clocks decide what is live at build time:
//   - A puzzle gets its dated page once its date has started somewhere in the world (UTC+14), which
//     is 5 or 6 a.m. Eastern the day before. The game unlocks at midnight in each time zone, so by
//     then someone is playing it.
//   - The today page shows the puzzle for the New York date, so it switches at midnight Eastern.
// A saved puzzle for a later date stays hidden until a build after it unlocks.
// CONNECTIONS_NOW (any Date string) stands in for the build time in tests.
//
// Dated pages more than INDEX_DAYS older than the newest puzzle get noindex and leave the sitemap,
// the same rule as the Spelling Bee pages. They stay on the site and in the archive.
// data/connections/last-changed.json keeps when the today page, the yesterday page, and the archive
// last changed, for their sitemap lastmod. See changeTracker in lib/site.mjs.
import fs from 'node:fs';
import path from 'node:path';
import { COLORS, DATA_DIR, currentPuzzleDate, isReleased, puzzleNumber, savedPuzzles } from './lib/connections.mjs';
import {
    DAY_MS, ROOT, SITE, article, articleSchema, breadcrumbSchema, buildTime, changeTracker, eastern, escapeHtml, faqHtml,
    faqSchema, isMain, listJoin, longDate, monthLabel, pageRenderer, parseDate, plural, removeOrphans, sitemapEntry,
    spliceSitemap, stamp, weekday, writeIfChanged,
} from './lib/site.mjs';

const ANSWERS = 'connections-answers';
const RECENT_DAYS = 7;
const INDEX_DAYS = 30;
const SITEMAP_START = '<!-- connections:start -->';
const SITEMAP_END = '<!-- connections:end -->';
const CHANGES_FILE = path.join(DATA_DIR, 'last-changed.json');

// Returns the files written (`changed`) and the site paths whose title or body changed (`urls`).
// A new header or footer rewrites every file but changes no url.
export function buildPages(now = buildTime('CONNECTIONS_NOW')) {
    const days = savedPuzzles().filter((p) => isReleased(p.date, now)).map(analyze);
    if (!days.length) {
        console.log('No released puzzles in data/connections yet. Run tools/connections-daily.mjs first.');
        return { changed: [], urls: [] };
    }
    // The today page shows the New York date's puzzle, or the newest one before it if that was never saved.
    const todayDate = currentPuzzleDate(now);
    const today = days.filter((day) => day.date <= todayDate).pop() || days[0];
    const past = days.filter((day) => day.date < today.date);
    const yesterday = past[past.length - 1];
    // Unlocked somewhere already, so its dated page is up before the today page reaches it.
    const next = days.find((day) => day.date > today.date);
    const newest = parseDate(days[days.length - 1].date);
    for (const day of days) day.indexed = (newest - parseDate(day.date)) / DAY_MS < INDEX_DAYS;

    const render = pageRenderer();
    const tracker = changeTracker(CHANGES_FILE, now);
    const changed = [];
    const urls = [];
    const writePage = (loc, page) => {
        const rel = `${loc.slice(1)}/index.html`;
        const file = path.join(ROOT, rel);
        const html = render(page);
        const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
        if (before === null || contentOf(before) !== contentOf(html)) urls.push(loc);
        if (writeIfChanged(file, html)) changed.push(rel);
    };

    days.forEach((day, i) => writePage(dayUrl(day.date), dayPage(day, days[i - 1], days[i + 1])));
    // Each of these pages is built twice: once without its own time, to see whether its content
    // changed, and once with the time that content last changed.
    const hubChanged = tracker.changed(`/${ANSWERS}`, todayPage(today, past, next));
    writePage(`/${ANSWERS}`, todayPage(today, past, next, hubChanged));
    let switched;
    if (yesterday) {
        switched = tracker.changed(`/${ANSWERS}/yesterday`, yesterdayPage(yesterday));
        writePage(`/${ANSWERS}/yesterday`, yesterdayPage(yesterday, switched));
    }
    const archiveChanged = tracker.changed(`/${ANSWERS}/archive`, archivePage(days));
    writePage(`/${ANSWERS}/archive`, archivePage(days, archiveChanged));

    if (writeIfChanged(CHANGES_FILE, tracker.json())) changed.push(path.relative(ROOT, CHANGES_FILE));
    const xml = fs.readFileSync(path.join(ROOT, 'sitemap.xml'), 'utf8');
    const sitemap = spliceSitemap(xml, SITEMAP_START, SITEMAP_END, [
        sitemapEntry(`/${ANSWERS}`, eastern(hubChanged).iso),
        ...(yesterday ? [sitemapEntry(`/${ANSWERS}/yesterday`, eastern(switched).iso)] : []),
        sitemapEntry(`/${ANSWERS}/archive`, eastern(archiveChanged).iso),
        ...days.slice().reverse().filter((day) => day.indexed).map((day) => sitemapEntry(dayUrl(day.date), stamp(day.updated, day.date))),
    ]);
    if (writeIfChanged(path.join(ROOT, 'sitemap.xml'), sitemap)) changed.push('sitemap.xml');
    removeOrphans(ANSWERS, new Set(days.map((day) => day.date)), changed);
    return { changed, urls };
}

// The parts of a page a reader or a search engine would call its content.
function contentOf(html) {
    return (html.match(/<title>[\s\S]*?<\/title>/) || [''])[0] + (html.match(/<main>[\s\S]*?<\/main>/) || [''])[0];
}

function analyze(p) {
    return {
        ...p,
        number: puzzleNumber(p.date),
        groups: p.groups.map((group, i) => ({ ...group, color: COLORS[i], slug: COLORS[i].toLowerCase() })),
    };
}

const e = escapeHtml;
const dayUrl = (date) => `/${ANSWERS}/${date}`;

// A card whose longest word would not fit a phone-width tile gets a class that sets it smaller.
function cardHtml(card) {
    const longest = Math.max(...card.split(/[\s-]+/).map((word) => word.length));
    const size = longest >= 12 ? ' class="conn-card--xlong"' : longest >= 9 ? ' class="conn-card--long"' : '';
    return `<li${size}>${e(card)}</li>`;
}

function boardHtml(day) {
    return `<ul class="conn-board" aria-label="The 16 words, in the order the game deals them">${day.board.map(cardHtml).join('')}</ul>`;
}

function revealHtml(group, label, body) {
    return `<details class="conn-reveal conn-reveal--${group.slug}"><summary>${label}</summary>${body}</details>`;
}

// One block per set of reveals, so nothing the ad script places can land between two colors.
function revealsHtml(items) {
    return `<div class="conn-reveals">${items.join('')}</div>`;
}

function groupHtml(group) {
    return `<div class="conn-group conn-group--${group.slug}"><span class="conn-group-color">${group.color}</span> <b>${e(group.title)}</b> <span class="conn-group-cards">${group.cards.map(e).join(', ')}</span></div>`;
}

function puzzleSections(day) {
    return [
        '<h2>The 16 words</h2>',
        '<p>In the order the game deals them, left to right and top to bottom.</p>',
        boardHtml(day),
        '<h2>Hints</h2>',
        '<p>The Times ranks the four groups by color. Yellow is the most straightforward, then green, then blue, and purple is the trickiest. Each kind of hint gives away more than the one before it.</p>',
        '<h3>One word from each group</h3>',
        revealsHtml(day.groups.map((group) => revealHtml(group, `${group.color}: one of its words`, `<p>${e(group.cards[0])}</p>`))),
        '<h3>Category names</h3>',
        revealsHtml(day.groups.map((group) => revealHtml(group, `${group.color}: the category`, `<p>${e(group.title)}</p>`))),
        '<h2>Answers</h2>',
        '<p>Open a color to see its category and all four words.</p>',
        revealsHtml([
            ...day.groups.map((group) => revealHtml(group, `${group.color}: all four words`, groupHtml(group))),
            `<details class="conn-reveal"><summary>All four groups</summary>${day.groups.map(groupHtml).join('')}</details>`,
        ]),
    ];
}

function summaryText(day) {
    return `Connections #${day.number} is the Times' puzzle for ${weekday(day.date)}, ${longDate(day.date)}: 16 words to sort into four groups of four. `
        + 'Hints come first. The category names and the answers stay hidden until you open them.';
}

function dayNavHtml(prev, next) {
    const prevLink = prev ? `<a href="${dayUrl(prev.date)}" rel="prev">← ${longDate(prev.date)}</a>` : '<span></span>';
    const nextLink = next ? `<a href="${dayUrl(next.date)}" rel="next">${longDate(next.date)} →</a>` : `<a href="/${ANSWERS}">Today's puzzle →</a>`;
    return `<nav class="conn-daynav" aria-label="Other days">${prevLink}<a href="/${ANSWERS}/archive">All days</a>${nextLink}</nav>`;
}

function faqItems(day) {
    const date = longDate(day.date);
    const purple = day.groups[3];
    const following = new Date(parseDate(day.date).getTime() + DAY_MS).toISOString().slice(0, 10);
    return [
        {
            q: `What are the categories in Connections #${day.number}?`,
            a: `${day.groups.map((group) => `${group.color}: ${group.title}.`).join(' ')} Connections #${day.number} is the puzzle for ${date}.`,
        },
        {
            q: `What is the purple group in Connections #${day.number}?`,
            a: `${purple.title}: ${listJoin(purple.cards)}. Purple is the trickiest of the four groups.`,
        },
        {
            q: `When does the Connections after #${day.number} come out?`,
            a: `Connections #${day.number + 1} is the puzzle for ${weekday(following)}, ${longDate(following)}. The Times unlocks each puzzle at midnight in the player's own time zone.`,
        },
    ];
}

function dayPage(day, prev, next) {
    const date = longDate(day.date);
    const title = `NYT Connections #${day.number} Hints and Answers for ${date}`;
    const url = `${SITE}${dayUrl(day.date)}`;
    const description = `Hints and answers for NYT Connections #${day.number}, ${weekday(day.date)}, ${date}. One word from each group, the category names, then the answers, all hidden until you open them.`;
    const faq = faqItems(day);
    const main = article('conn-day', [
        `<p class="guide-kicker"><a href="/${ANSWERS}">Connections answers</a> · ${weekday(day.date)}</p>`,
        `<h1>${title}</h1>`,
        `<p>${summaryText(day)}</p>`,
        ...puzzleSections(day),
        dayNavHtml(prev, next),
    ]) + '\n' + faqHtml(faq);
    return {
        title,
        description,
        url,
        noindex: !day.indexed,
        main,
        schema: [
            articleSchema(title, description, url, stamp(day.published, day.date), stamp(day.updated, day.date)),
            breadcrumbSchema([['Word Game Helper', `${SITE}/`], ['Connections answers', `${SITE}/${ANSWERS}`], [date, url]]),
            faqSchema(faq),
        ],
    };
}

function recentHtml(days) {
    const items = days.map((day) => `<li><a href="${dayUrl(day.date)}">${weekday(day.date)}, ${longDate(day.date)}</a> <span class="conn-days-number">#${day.number}</span></li>`);
    return `<ul class="conn-days">${items.join('')}</ul>`;
}

// The rules of the game, for a reader who is new to it. On the today page only: the same text on
// every dated page would be filler.
const HOW_TO_PLAY = [
    '<h2 id="how-to-play">How to play Connections</h2>',
    '<p>Connections deals 16 words in a four-by-four grid. The goal is to sort them into four groups of four words that share something. Pick four words and press Submit. If they belong together, the group locks in and shows its category. If they don\'t, you lose one of your four mistakes, and the game says so when you were one word away. You win by finding all four groups before the mistakes run out.</p>',
    '<p>The grid is built to mislead. Several words usually fit more than one category, but each word belongs to exactly one group, so there is only one way to sort all 16. When you spot a category, look for a fifth word that fits it before you submit, then work out which of the five belongs somewhere else. Shuffle rearranges the grid, which helps when two words sitting side by side keep pulling your eye. The Times has published one puzzle a day since June 12, 2023.</p>',
];

// A reader whose own date is a day off from this page's puzzle gets pointed to the right page.
// The note stays hidden when the dates match or the page it would link to is not up.
const LOCAL_NOTE_SCRIPT = `<script>
(function () {
    var note = document.getElementById('conn-local-note');
    if (!note) return;
    var now = new Date();
    var page = note.dataset.date.split('-');
    var ahead = Math.round((Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(+page[0], page[1] - 1, +page[2])) / 86400000);
    var here = now.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    function say(before, href, label) {
        var link = document.createElement('a');
        link.href = href;
        link.textContent = label;
        note.textContent = before + ' ';
        note.appendChild(link);
        note.appendChild(document.createTextNode('.'));
        note.hidden = false;
    }
    if (ahead === -1 && note.dataset.prev) say('It is still ' + here + ' where you are, and this page has moved on to the next puzzle. Yours is on', note.dataset.prev, "yesterday's answers");
    if (ahead === 1 && note.dataset.next) say('It is already ' + here + ' where you are. Your puzzle is on', note.dataset.next, 'the ' + here + ' page');
})();
</script>`.split('\n');

function localNoteHtml(day, yesterday, next) {
    const data = [
        `data-date="${day.date}"`,
        yesterday && `data-prev="/${ANSWERS}/yesterday"`,
        next && `data-next="${dayUrl(next.date)}"`,
    ].filter(Boolean).join(' ');
    return `<p class="note conn-local-note" id="conn-local-note" hidden ${data}></p>`;
}

// No date in the title: Google can show a cached title for days, and a dated one would name the wrong
// puzzle. The date and the number go in the H1. `changedAt` is the UTC time this page's content last
// changed. It is left out when the content is hashed, so the page's own time doesn't count as a change.
function todayPage(day, past, next, changedAt) {
    const date = longDate(day.date);
    const title = 'Today\'s NYT Connections Hints and Answers';
    const heading = `NYT Connections Hints and Answers Today: ${date} (#${day.number})`;
    const url = `${SITE}/${ANSWERS}`;
    const description = `Today's NYT Connections hints and answers: #${day.number}, ${weekday(day.date)}, ${date}. One word from each group, the category names, then the answers, all hidden until you open them.`;
    const yesterday = past[past.length - 1];
    const recent = past.slice(-RECENT_DAYS).reverse();
    const faq = faqItems(day);
    const updated = changedAt && eastern(changedAt);
    const intro = [
        updated && `Updated <time datetime="${updated.iso}">${updated.clock}</time>.`,
        'The Times unlocks a new Connections at midnight in each time zone, and this page switches at midnight Eastern.',
        yesterday && `Still on the one before? See <a href="/${ANSWERS}/yesterday">yesterday's answers</a>.`,
        next && `Already on the next one? See <a href="${dayUrl(next.date)}">${longDate(next.date)}</a>.`,
    ].filter(Boolean).join(' ');
    const lines = [
        `<p class="guide-kicker">Connections answers · ${weekday(day.date)}</p>`,
        `<h1>${heading}</h1>`,
        `<p>${intro}</p>`,
        localNoteHtml(day, yesterday, next),
        ...LOCAL_NOTE_SCRIPT,
        `<p>${summaryText(day)}</p>`,
        ...puzzleSections(day),
        `<p>This puzzle keeps its own page: <a href="${dayUrl(day.date)}">${date}</a>.</p>`,
    ];
    if (past.length) {
        lines.push(
            '<h2>Recent Connections answers</h2>',
            recentHtml(recent),
            `<p><a href="/${ANSWERS}/archive">Every puzzle since ${longDate(past[0].date)}</a></p>`,
        );
    }
    lines.push(...HOW_TO_PLAY, '<p>Also on this site each day: <a href="/spelling-bee-answers">today\'s Spelling Bee answers</a>.</p>');
    return {
        title,
        description,
        url,
        current: `/${ANSWERS}`,
        main: article('conn-day', lines) + '\n' + faqHtml(faq),
        schema: [
            articleSchema(heading, description, url, stamp(day.published, day.date), updated ? updated.iso : undefined),
            breadcrumbSchema([['Word Game Helper', `${SITE}/`], ['Connections answers', url]]),
            faqSchema(faq),
        ],
    };
}

// The four groups shown open, with no hints or FAQ, so it doesn't copy the dated page it links to.
// `switchedAt` is the UTC time this page moved to this puzzle, left out when the content is hashed.
function yesterdayPage(day, switchedAt) {
    const date = longDate(day.date);
    const title = 'Yesterday\'s NYT Connections Answers';
    const heading = `Yesterday's NYT Connections Answers: ${date} (#${day.number})`;
    const url = `${SITE}/${ANSWERS}/yesterday`;
    const description = `All four groups from yesterday's NYT Connections, #${day.number}, ${weekday(day.date)}, ${date}: ${listJoin(day.groups.map((group) => group.title))}.`;
    const switched = switchedAt ? eastern(switchedAt).iso : undefined;
    const lines = [
        `<p class="guide-kicker"><a href="/${ANSWERS}">Connections answers</a> · ${weekday(day.date)}</p>`,
        `<h1>${heading}</h1>`,
        `<p>Connections #${day.number} was the Times' puzzle for ${weekday(day.date)}, ${date}. Its four groups, from yellow to purple:</p>`,
        ...day.groups.map(groupHtml),
        `<p>The 16 words as the game dealt them, and the hints, are on the <a href="${dayUrl(day.date)}">${date} page</a>. This page moves to the next puzzle at midnight Eastern.</p>`,
        `<p>Today's puzzle is on <a href="/${ANSWERS}">today's Connections answers</a> page.</p>`,
    ];
    return {
        title,
        description,
        url,
        main: article('conn-day conn-yesterday', lines),
        schema: [
            articleSchema(heading, description, url, switched, switched),
            breadcrumbSchema([['Word Game Helper', `${SITE}/`], ['Connections answers', `${SITE}/${ANSWERS}`], ['Yesterday', url]]),
        ],
    };
}

// The list shows dates and puzzle numbers only, so it gives nothing away.
// `changedAt` is left out when the content is hashed, so the page's own time doesn't count as a change.
function archivePage(days, changedAt) {
    const title = 'NYT Connections Answers Archive | Word Game Helper';
    const url = `${SITE}/${ANSWERS}/archive`;
    const first = longDate(days[0].date);
    const description = `Hints and answers for every NYT Connections since ${first}, newest first, by date and puzzle number.`;
    const lines = [
        `<p class="guide-kicker"><a href="/${ANSWERS}">Connections answers</a></p>`,
        '<h1>NYT Connections Answers Archive</h1>',
        `<p>Every puzzle since ${first}, newest first. Each page has the 16 words, hints that give away a little at a time, and the four groups. ${plural(days.length, 'puzzle')} so far.</p>`,
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
        main: article('conn-archive', lines),
        schema: [
            {
                '@context': 'https://schema.org',
                '@type': 'CollectionPage',
                name: 'NYT Connections Answers Archive',
                description,
                url,
                dateModified: changedAt ? eastern(changedAt).iso : undefined,
                isPartOf: { '@type': 'WebSite', name: 'Word Game Helper', url: `${SITE}/` },
            },
            breadcrumbSchema([['Word Game Helper', `${SITE}/`], ['Connections answers', `${SITE}/${ANSWERS}`], ['Archive', url]]),
        ],
    };
}

if (isMain(import.meta.url)) {
    const { changed } = buildPages();
    console.log(changed.length ? `Updated ${plural(changed.length, 'file')}:\n  ${changed.join('\n  ')}` : 'Connections pages are up to date.');
}
