# Crossplay Word Finder

A web-based tool to find the highest-scoring words for your NYT Crossplay game.

## Features

- **Interactive 15x15 Board**: Click any square to enter letters already on the board
- **Visual Special Squares**: Double/Triple Letter and Word squares are color-coded
- **Tile Rack Input**: Enter your 7 available tiles (use `?` for blank tiles)
- **Smart Word Finder**: Finds all valid word placements and ranks them by score
- **Score Calculation**: Crossplay sweep is 40, Scrabble bingo is 50, Words with Friends bingo is 35
- **Hover Preview**: Hover over results to see exactly where the word would be placed

## How to Use

1. **Open the app**: Simply open `index.html` in any modern web browser (Chrome, Firefox, Safari, Edge)

2. **Enter the board state**: Click on any square to type a letter that's already on the board. This represents the current state of your game.

3. **Enter your tiles**: Type your 7 available letters in the tile rack boxes at the top of the controls panel. Use `?` for blank/wild tiles.

4. **Find words**: Click the "Find Best Words" button to calculate all possible plays.

5. **Review results**: The top 20 highest-scoring words are displayed. Hover over any result to see where it would be placed on the board (highlighted in yellow).

6. **Clear and repeat**: Use the "Clear Board" button to start fresh for a new game.

## Scoring (NYT Crossplay)

The app uses NYT Crossplay scoring:

### Letter Values

| Points | Letters |
|--------|---------|
| 1 pt   | A, E, I, N, O, R, S, T |
| 2 pts  | D, L, U |
| 3 pts  | C, H, M, P |
| 4 pts  | B, F, G, Y |
| 5 pts  | W |
| 6 pts  | K, V |
| 8 pts  | X |
| 10 pts | J, Q, Z |
| 0 pts  | Blank (?) |

### Bonus Squares
- **DL (Light Blue)**: Double Letter Score
- **TL (Dark Blue)**: Triple Letter Score  
- **DW (Pink)**: Double Word Score
- **TW (Red)**: Triple Word Score
- **★ (Center)**: Opening square. It does not multiply the score. The first word must cover it.

### All-tiles bonus
Using all 7 tiles earns **40** in Crossplay, **50** in Scrabble, and **35** in Words with Friends. Crossplay has 3 blanks; Scrabble and Words with Friends have 2. The Crossplay center star does not multiply the score.

## Note on Board Layout

The bonus square positions in this app use a standard layout. NYT Crossplay may have a slightly different bonus square arrangement - the exact layout is not publicly documented. The scoring algorithm and word finding will work correctly regardless.

## Technical Details

- **No installation required**: Works entirely in the browser
- **No internet needed**: All processing happens locally
- **No API keys**: The dictionary and solver run client-side
- **Dictionary**: Contains thousands of valid Crossplay words
- **Solver worker**: The board solvers load `crossplay-cuts.js` and the dictionary in `solver-worker.js`, a Web Worker, so building the word list and searching never block the page. Browsers without workers load the same scripts on the page. When the dictionary file is renamed, update `SOLVER_SCRIPTS` in `app.js`.
- **Solver tests**: `node --test tools/test/solver.test.mjs` checks that the worker returns the same moves as the in-page solver, and checks both against `tools/test/fixtures/solver-golden.json`. Run it with `UPDATE_SOLVER_GOLDEN=1` only when a scoring change is intended.

## Tips

1. For the first move, at least one letter must cover the center star
2. Blank tiles (?) can represent any letter but score 0 points
3. The algorithm checks cross-words automatically - all formed words must be valid
4. High-value letters in Crossplay: J, Q, Z (10 pts), X (8 pts), K, V (6 pts)
5. W is worth 5 points in Crossplay - higher than traditional word games!

## Browser Compatibility

Works on all modern browsers:
- Chrome 60+
- Firefox 55+
- Safari 12+
- Edge 79+

## NYT Spelling Bee

Pages: `/spelling-bee-solver` (the solver), `/spelling-bee-answers` (today), `/spelling-bee-answers/yesterday` (the answer list for the day before), `/spelling-bee-answers/YYYY-MM-DD` (one page per day, today included), and `/spelling-bee-answers/archive`.

A puzzle gets its pages once its date's 3 a.m. Eastern rollover has passed when the pages are built. A saved puzzle for a later date stays out of the pages, the sitemap, and `spelling-bee-today.json` until a build after its rollover. `/spelling-bee-hints` redirects to the today page.

### Daily answers

`.github/workflows/spelling-bee-daily.yml` runs `tools/spelling-bee-daily.mjs` at 07:17, 07:47, 08:17, 08:47, 09:17, and 11:17 UTC. The Times resets the puzzle at 3 a.m. Eastern, which is 07:00 UTC in summer and 08:00 UTC in winter, so in either season there is a run at 3:17 a.m. Eastern and two retries within the hour after it. GitHub can delay or drop scheduled runs, and runs with nothing new do nothing. The script:

1. Reads `window.gameData` (today and yesterday) from https://www.nytimes.com/puzzles/spelling-bee.
2. Checks the letters, answers, and pangrams. If anything looks wrong it exits with an error and writes nothing.
3. Saves each puzzle to `data/spelling-bee/YYYY-MM-DD.json`, dated by the Times' print date. The file also keeps, in UTC, when it was first saved (`published`) and when its answer list last changed (`updated`). The today page shows the update time, and the structured data carries both as New York times. Files from before November 19, 2026 only have a date.
4. Runs `tools/build-spelling-bee-pages.mjs`. That writes `spelling-bee-today.json`, `spelling-bee-learned.json`, every page under `spelling-bee-answers/`, `data/spelling-bee/last-changed.json`, and the lines between the `spelling-bee` markers in `sitemap.xml`.

Sitemap `lastmod` is the time each page really changed, in New York time. A dated page uses its `updated` time. The yesterday page uses the time today's puzzle was saved. The today page and the archive change for more than their own puzzle: a new day's link, a corrected word count on another day, new copy, or a puzzle that goes live at a build after its rollover. So their `lastmod` is the build time when their content last changed. `data/spelling-bee/last-changed.json` keeps that time with a hash of the content. The head, header, and footer don't count, so a new build number leaves `lastmod` alone. The archive's `dateModified` is the same time. The today page's `dateModified` stays its `updated` time, to match the Updated line. The daily job saves and builds on one clock, so on a normal day the two are the same. A rebuild on a branch records the time it ran, but the change goes live when the branch is merged, so merge soon after rebuilding. A change to the markup alone, with the same words on the page, also changes the hash. To keep the old time for one of those, put it back in `last-changed.json` after the rebuild and build once more.

Dated pages more than 30 days older than the newest puzzle get `noindex` and drop out of the sitemap, so the daily pages don't swamp what Google indexes. They stay on the site and in the archive. Change `INDEX_DAYS` in `tools/build-spelling-bee-pages.mjs` to move the window.

The workflow commits only when something changed, with the message `Spelling Bee answers for YYYY-MM-DD`. The commit author is the repo owner because Vercel's Hobby plan only deploys commits by the account owner. Run it by hand from the Actions tab with Run workflow.

The generated pages copy their header and footer from `spelling-bee-solver/index.html`, so nav and build number changes there reach them on the next run. To rebuild them now:

    node tools/build-spelling-bee-pages.mjs

Tests for the rollover gate and the built pages:

    node --test 'tools/test/*.test.mjs'

If the Times blocks the fetch, save the puzzle page from a browser and run:

    node tools/spelling-bee-daily.mjs --file path/to/saved-page.html

To take the answer pages down: disable the workflow, delete `data/spelling-bee/`, `spelling-bee-answers/`, `spelling-bee-today.json`, and the `spelling-bee` block in `sitemap.xml`, then remove the "Spelling Bee answers" links from the nav and footer. The solver keeps working without them.

### Word list

The solver loads `spelling-bee-words.YYYYMMDD.js`. `tools/build-spelling-bee.mjs` makes it from the solver dictionary, the Crossplay cuts, `tools/data/scowl-levels.txt`, and `tools/data/spelling-bee-blocklist.txt`. Rebuild only when one of those changes. The script renames the file and updates `spelling-bee-solver.js` and `vercel.json`.

    node tools/build-spelling-bee.mjs

- **Likely:** words that fit Bee rules (4+ letters, no S, at most 7 different letters) and are in SCOWL at size 60 or below.
- **Other:** the rest of the Bee-shaped words.
- **Learned:** `spelling-bee-learned.json` lists words the Times accepted that are not in the likely tier, and likely words it turned down. It is rebuilt with the pages each day from `data/spelling-bee/` and `tools/data/spelling-bee-seed.json`, which holds 24 official puzzles from December 2024 to February 2026. The seed puzzles have no pages.

SCOWL size was picked on 26 official puzzles. At size 60 the likely tier found 85% of the answers and 93% of its words were accepted. At size 70 it found 90%, but only 71% were accepted.

SCOWL is Copyright 2000-2018 by Kevin Atkinson. The full notice is in `licenses/scowl.txt` and is published at `/licenses/scowl.txt`. To refresh the size data from a new SCOWL release (http://wordlist.aspell.net/):

    node tools/build-spelling-bee.mjs --scowl path/to/scowl/final

## NYT Connections

Pages: `/connections-answers` (today), `/connections-answers/yesterday`, `/connections-answers/YYYY-MM-DD` (one page per day), and `/connections-answers/archive`. `/connections-hints` redirects to the today page.

The Times unlocks each Connections at midnight in the player's own time zone, so two clocks decide what is live when the pages are built:

- **A dated page** goes up once its date has started somewhere in the world. A date starts first at UTC+14, which is 10:00 UTC the day before: 5 a.m. Eastern in winter, 6 a.m. in summer. By then someone is playing that puzzle.
- **The today page** shows the puzzle for the New York date, so it moves on at midnight Eastern. The yesterday page moves with it. Until then the today page links to the next day's page for readers who are already on it.

The Times posts puzzles in its feed weeks ahead. The daily script refuses a date that has not unlocked anywhere, and the builder hides a saved puzzle until it has, so nothing goes out early.

Each page shows the 16 words in the order the game deals them, then three sets of hints, closed until opened: one word from each group, the category names, and the answers. The hints are made from the puzzle data by rule. The yesterday page shows the four groups open. The archive lists dates and puzzle numbers only.

The puzzle number counts days from June 12, 2023, which was #1. The feed's `id` is a different number.

### Daily job

`.github/workflows/connections-daily.yml` runs `tools/connections-daily.mjs --wait` at 03:45, 04:10, 04:45, 05:10, 05:40, 10:05, 10:35, and 12:17 UTC. Midnight Eastern is 04:00 UTC in summer and 05:00 UTC in winter. In either season one run starts 15 minutes before it, and `--wait` makes a run that starts within 20 minutes before midnight Eastern sleep until just after it, so the today page moves on time. The 10:05 run puts up the next day's page. The rest are retries, and a run with nothing new does nothing. The script:

1. Fetches `https://www.nytimes.com/svc/connections/v2/YYYY-MM-DD.json` for the New York date, for the next date once it has unlocked somewhere, and for yesterday again if it is already saved, to pick up a correction.
2. Checks each response: the date asked for, four groups of four, a title on each group, text on each card, board positions 0 to 15 once each, and 16 different cards. If anything looks wrong it exits with an error and writes nothing.
3. Saves each puzzle to `data/connections/YYYY-MM-DD.json`. The file keeps, in UTC, when it was first saved (`published`) and when its groups last changed (`updated`).
4. Runs `tools/build-connections-pages.mjs`. That writes every page under `connections-answers/`, `data/connections/last-changed.json`, and the lines between the `connections` markers in `sitemap.xml`.

The workflow commits only when something changed. The message is `Connections answers for YYYY-MM-DD` when a new puzzle was saved, `Connections correction for YYYY-MM-DD` when a saved puzzle changed, and `Connections today page for YYYY-MM-DD` when only the today page moved. The commit author is the repo owner, for the same Vercel reason as the Spelling Bee job. Both workflows share one concurrency group, `daily-answers`, because both edit `sitemap.xml`.

After the push, `tools/indexnow.mjs` waits until the live site serves the new pages, then sends the pages whose title or body changed to IndexNow, so Bing and the engines that share it pick them up within minutes. The key is the 32-character `.txt` file in the site root. Google does not use IndexNow. If this step fails, the run still passes: the pages are already live.

Sitemap `lastmod` works as it does for Spelling Bee. A dated page uses its `updated` time. The today page, the yesterday page, and the archive use the build time when their content last changed, kept in `data/connections/last-changed.json`. The today page shows that time as its Updated line. Dated pages more than 30 days older than the newest puzzle get `noindex` and drop out of the sitemap (`INDEX_DAYS` in `tools/build-connections-pages.mjs`).

The pages copy their header and footer from `spelling-bee-solver/index.html`. To rebuild them now:

    node tools/build-connections-pages.mjs

To add or repair one day, or to read a saved copy of a feed response if the Times blocks the fetch:

    node tools/connections-daily.mjs --date 2026-11-20
    node tools/connections-daily.mjs --file path/to/saved-response.json

To see what would be sent to IndexNow without sending it:

    node tools/indexnow.mjs --dry-run /connections-answers

The tests use the saved feed responses in `tools/test/fixtures/connections/`, not the live data:

    node --test 'tools/test/*.test.mjs'

To take the pages down: delete `.github/workflows/connections-daily.yml`, `data/connections/`, `connections-answers/`, and the `connections` block in `sitemap.xml`, then remove the "Connections answers" links from the nav and footer and the `/connections-hints` redirect in `vercel.json`.

### Shared code

`tools/lib/site.mjs` holds what both daily sections use: the page renderer, the `lastmod` tracker, the sitemap splice, the Eastern-time helpers, and the page template in `tools/templates/page.html`. `tools/lib/bee.mjs` and `tools/lib/connections.mjs` hold what is specific to each game.

## License

Free to use for personal purposes.
