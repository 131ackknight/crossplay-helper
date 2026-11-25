#!/usr/bin/env node
// Tells IndexNow that pages on the site changed. Bing and the other engines that share IndexNow
// pick the pages up within minutes. Google does not use it.
//
//   node tools/indexnow.mjs /connections-answers /connections-answers/archive
//   node tools/indexnow.mjs --from FILE   site paths, one per line
//   --wait-live   first wait, up to 5 minutes, until the live site serves each page as it is in this
//                 checkout, so a page is never announced before its deploy has finished. Pages that
//                 are still not live after that are left out.
//   --dry-run     print what would be sent, and send nothing
//
// The key is the 32-character .txt file in the site root. The live site serves it at /KEY.txt, which
// is how IndexNow checks that the request comes from the site's owner.
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, SITE, isMain } from './lib/site.mjs';

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const WAIT_MS = 5 * 60 * 1000;
const POLL_MS = 10 * 1000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function findKey(root = ROOT) {
    for (const name of fs.readdirSync(root)) {
        const match = name.match(/^([0-9a-f]{32})\.txt$/);
        if (match && fs.readFileSync(path.join(root, name), 'utf8').trim() === match[1]) return match[1];
    }
    throw new Error('No IndexNow key file (32 hex characters, .txt) in the site root');
}

export function payload(locs, key) {
    return {
        host: new URL(SITE).host,
        key,
        keyLocation: `${SITE}/${key}.txt`,
        urlList: locs.map((loc) => `${SITE}${loc === '/' ? '' : loc}`),
    };
}

// The title and the body. The live copy must match the local one in both.
const contentOf = (html) => (html.match(/<title>[\s\S]*?<\/title>/) || [''])[0] + (html.match(/<main>[\s\S]*?<\/main>/) || [''])[0];

function localPage(loc) {
    return fs.readFileSync(path.join(ROOT, loc.replace(/^\//, ''), 'index.html'), 'utf8');
}

async function isLive(loc) {
    try {
        const res = await fetch(`${SITE}${loc === '/' ? '' : loc}`, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache' } });
        return res.ok && contentOf(await res.text()) === contentOf(localPage(loc));
    } catch {
        return false;
    }
}

async function waitLive(locs) {
    const deadline = Date.now() + WAIT_MS;
    let pending = locs;
    for (;;) {
        const checks = await Promise.all(pending.map(isLive));
        pending = pending.filter((loc, i) => !checks[i]);
        if (!pending.length || Date.now() >= deadline) break;
        console.log(`Waiting for the deploy: ${pending.length} of ${locs.length} pages not live yet.`);
        await sleep(POLL_MS);
    }
    if (pending.length) console.log(`Not live after ${WAIT_MS / 60000} minutes, left out: ${pending.join(' ')}`);
    return locs.filter((loc) => !pending.includes(loc));
}

export async function main(args = process.argv.slice(2)) {
    const fromAt = args.indexOf('--from');
    const listed = fromAt === -1 ? [] : fs.readFileSync(args[fromAt + 1], 'utf8').split('\n');
    const named = args.filter((arg, i) => arg.startsWith('/') && i !== fromAt + 1);
    let locs = [...new Set([...listed, ...named].map((line) => line.trim()).filter(Boolean))];
    for (const loc of locs) if (!loc.startsWith('/')) throw new Error(`Not a site path: ${loc}`);
    if (!locs.length) {
        console.log('No changed pages to send.');
        return;
    }
    const body = payload(locs, findKey());
    if (args.includes('--dry-run')) {
        console.log(JSON.stringify(body, null, 2));
        return;
    }
    if (args.includes('--wait-live')) {
        locs = await waitLive(locs);
        if (!locs.length) return;
        body.urlList = payload(locs, body.key).urlList;
    }
    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
    });
    // 200 is accepted. 202 is accepted with the key check still to come.
    if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow answered HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    console.log(`IndexNow took ${locs.length} page${locs.length === 1 ? '' : 's'} (HTTP ${res.status}):\n  ${body.urlList.join('\n  ')}`);
}

if (isMain(import.meta.url)) {
    main().catch((err) => {
        console.error(err.message);
        process.exit(1);
    });
}
