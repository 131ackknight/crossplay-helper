// Shared helpers for the daily answer pages (Spelling Bee, Connections). Node 18 or newer, no packages.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const SITE = 'https://wordgamehelp.com';
export const DAY_MS = 24 * 60 * 60 * 1000;
export const TEMPLATE = path.join(ROOT, 'tools', 'templates', 'page.html');
// The generated pages copy their header and footer from this hand-written page on every build.
export const CHROME_PAGE = path.join(ROOT, 'spelling-bee-solver', 'index.html');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function parseDate(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d));
}

export function longDate(iso) {
    const date = parseDate(iso);
    return `${MONTHS[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()}`;
}

export function shortDate(iso) {
    const date = parseDate(iso);
    return `${MONTHS[date.getUTCMonth()].slice(0, 3)} ${date.getUTCDate()}`;
}

export function weekday(iso) {
    return WEEKDAYS[parseDate(iso).getUTCDay()];
}

export function monthLabel(iso) {
    const date = parseDate(iso);
    return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function escapeHtml(value) {
    return String(value).replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
}

export function writeIfChanged(file, contents) {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === contents) return false;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, contents);
    return true;
}

// True when the module at `metaUrl` is the script node was started with. The real path is compared,
// so it also holds when the script sits under a symlinked folder, such as the temp folder on macOS.
export function isMain(metaUrl) {
    if (!process.argv[1]) return false;
    try {
        return metaUrl === pathToFileURL(fs.realpathSync(process.argv[1])).href;
    } catch {
        return false;
    }
}

export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function listJoin(items) {
    if (items.length < 3) return items.join(' and ');
    return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

const EASTERN = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23', timeZoneName: 'longOffset',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
});

const parts = (format, time) => Object.fromEntries(format.formatToParts(time).map(({ type, value }) => [type, value]));

// A UTC time as New York time: ISO 8601 with the offset, and a clock time for the page.
export function eastern(utc) {
    const part = parts(EASTERN, new Date(utc));
    const hour = Number(part.hour);
    return {
        iso: `${part.year}-${part.month}-${part.day}T${part.hour}:${part.minute}:${part.second}${part.timeZoneName.replace('GMT', '') || '+00:00'}`,
        clock: `${hour % 12 || 12}:${part.minute} ${hour < 12 ? 'a.m.' : 'p.m.'} ET`,
    };
}

// Files saved before the daily job recorded times only have a date.
export const stamp = (utc, date) => (utc ? eastern(utc).iso : date);

// The New York date at `now`, or the day before it until `rolloverHour` (0 to 23) that morning.
export function puzzleDateAt(now, rolloverHour) {
    const part = parts(EASTERN, now);
    const date = `${part.year}-${part.month}-${part.day}`;
    if (Number(part.hour) >= rolloverHour) return date;
    return new Date(parseDate(date) - DAY_MS).toISOString().slice(0, 10);
}

// The calendar date at `now` in an IANA time zone.
export function zoneDate(now, timeZone) {
    const part = parts(new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }), now);
    return `${part.year}-${part.month}-${part.day}`;
}

// The build time. `envName` names an environment variable (any Date string) that stands in for it in tests.
export function buildTime(envName) {
    const now = process.env[envName] ? new Date(process.env[envName]) : new Date();
    if (Number.isNaN(now.getTime())) throw new Error(`${envName} is not a date: ${process.env[envName]}`);
    return now;
}

export function article(className, lines) {
    return [`        <article class="prose wrap guide ${className}">`, ...lines.map((line) => `            ${line}`), '        </article>'].join('\n');
}

export function faqHtml(items) {
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

export function faqSchema(items) {
    return {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: items.map(({ q, a }) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: a } })),
    };
}

export function breadcrumbSchema(trail) {
    return {
        '@context': 'https://schema.org',
        '@type': 'BreadcrumbList',
        itemListElement: trail.map(([name, url], i) => ({ '@type': 'ListItem', position: i + 1, name, item: url })),
    };
}

export function articleSchema(headline, description, url, published, modified) {
    const site = { '@type': 'Organization', name: 'Word Game Helper', url: `${SITE}/` };
    return {
        '@context': 'https://schema.org',
        '@type': 'Article',
        headline,
        description,
        url,
        mainEntityOfPage: url,
        image: `${SITE}/og-image.png?v=2`,
        datePublished: published,
        dateModified: modified,
        author: site,
        publisher: site,
        isPartOf: { '@type': 'WebSite', name: 'Word Game Helper', url: `${SITE}/` },
    };
}

export function jsonLdHtml(objects) {
    return objects.map((o) => {
        const json = JSON.stringify(o, null, 4).replace(/</g, '\\u003c').replace(/^/gm, '    ');
        return `    <script type="application/ld+json">\n${json}\n    </script>`;
    }).join('\n');
}

// Returns render(page) for a page of { title, description, url, main, schema, noindex?, current? }.
// `current` is the href of the nav link to mark as the current page.
export function pageRenderer({ template = TEMPLATE, chromePage = CHROME_PAGE } = {}) {
    const html = fs.readFileSync(template, 'utf8');
    const source = fs.readFileSync(chromePage, 'utf8');
    const header = source.match(/<header class="site-header">[\s\S]*?<\/header>/);
    const footer = source.match(/<footer class="site-footer">[\s\S]*?<\/footer>/);
    if (!header || !footer) throw new Error(`No header or footer found in ${path.relative(ROOT, chromePage)}`);
    const plainHeader = header[0].replace(/ aria-current="page"/g, '');
    return (page) => {
        const values = {
            TITLE: escapeHtml(page.title),
            DESCRIPTION: escapeHtml(page.description),
            ROBOTS: page.noindex ? 'noindex, follow' : 'index, follow',
            URL: page.url,
            JSON_LD: jsonLdHtml(page.schema),
            HEADER: page.current ? plainHeader.replace(`href="${page.current}"`, `href="${page.current}" aria-current="page"`) : plainHeader,
            MAIN: page.main,
            FOOTER: footer[0],
        };
        return html.replace(/{{(\w+)}}/g, (match, key) => {
            if (!(key in values)) throw new Error(`Unknown template key ${key}`);
            return values[key];
        });
    };
}

// Some pages change for more than their own puzzle: a new day's link, a corrected count on another
// day, new copy, or a puzzle that goes live at a build after its rollover. So their lastmod is the
// build time when their content last changed, kept in `file` with a hash of that content. The head,
// header, and footer are the same on every page and don't count, so a new build number in the footer
// leaves lastmod alone. A missing or edited entry makes the next build record its own time.
export function changeTracker(file, now) {
    const before = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
    const after = {};
    const at = now.toISOString().replace(/\.\d+Z$/, 'Z');
    return {
        // The UTC time this page's content last changed.
        changed(loc, page) {
            const content = [page.title, page.description, page.url, Boolean(page.noindex), jsonLdHtml(page.schema), page.main];
            const hash = crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex').slice(0, 16);
            after[loc] = before[loc]?.hash === hash ? before[loc] : { changed: at, hash };
            return after[loc].changed;
        },
        json: () => JSON.stringify(after, null, 1) + '\n',
    };
}

export const sitemapEntry = (loc, lastmod) => `  <url>\n    <loc>${SITE}${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;

// Replaces the lines between two marker comments in the sitemap, or adds the block before </urlset>
// the first time. Each section of the site owns its own pair of markers.
export function spliceSitemap(xml, startMarker, endMarker, entries) {
    const block = [`  ${startMarker}`, ...entries, `  ${endMarker}`].join('\n');
    const start = xml.indexOf(startMarker);
    const end = xml.indexOf(endMarker);
    if (start !== -1 && end !== -1) {
        return xml.slice(0, xml.lastIndexOf('\n', start) + 1) + block + xml.slice(end + endMarker.length);
    }
    return xml.replace('</urlset>', `${block}\n</urlset>`);
}

// Deletes dated folders (YYYY-MM-DD) under `folder`, a path from the site root, that are not in `dates`.
export function removeOrphans(folder, dates, changed) {
    const dir = path.join(ROOT, folder);
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(name) && !dates.has(name)) {
            fs.rmSync(path.join(dir, name), { recursive: true });
            changed.push(`${folder}/${name} (removed)`);
        }
    }
}
