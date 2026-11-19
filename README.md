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

Pages: `/spelling-bee-solver` (the solver), `/spelling-bee-answers` (today), `/spelling-bee-answers/YYYY-MM-DD` (one page per day), and `/spelling-bee-answers/archive`.

### Daily answers

`.github/workflows/spelling-bee-daily.yml` runs `tools/spelling-bee-daily.mjs` at 07:17, 07:47, 08:17, 08:47, 09:17, and 11:17 UTC. The Times resets the puzzle at 3 a.m. Eastern, which is 07:00 UTC in summer and 08:00 UTC in winter, so in either season there is a run at 3:17 a.m. Eastern and two retries within the hour after it. GitHub can delay or drop scheduled runs, and runs with nothing new do nothing. The script:

1. Reads `window.gameData` (today and yesterday) from https://www.nytimes.com/puzzles/spelling-bee.
2. Checks the letters, answers, and pangrams. If anything looks wrong it exits with an error and writes nothing.
3. Saves each puzzle to `data/spelling-bee/YYYY-MM-DD.json`, dated by the Times' print date.
4. Runs `tools/build-spelling-bee-pages.mjs`. That writes `spelling-bee-today.json`, `spelling-bee-learned.json`, every page under `spelling-bee-answers/`, and the lines between the `spelling-bee` markers in `sitemap.xml`.

Dated pages more than 30 days older than the newest puzzle get `noindex` and drop out of the sitemap, so the daily pages don't swamp what Google indexes. They stay on the site and in the archive. Change `INDEX_DAYS` in `tools/build-spelling-bee-pages.mjs` to move the window.

The workflow commits only when something changed, with the message `Spelling Bee answers for YYYY-MM-DD`. The commit author is the repo owner because Vercel's Hobby plan only deploys commits by the account owner. Run it by hand from the Actions tab with Run workflow.

The generated pages copy their header and footer from `spelling-bee-solver/index.html`, so nav and build number changes there reach them on the next run. To rebuild them now:

    node tools/build-spelling-bee-pages.mjs

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

## License

Free to use for personal purposes.
