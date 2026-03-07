# Crossplay Word Finder

A web-based tool to find the highest-scoring words for your NYT Crossplay game.

## Features

- **Interactive 15x15 Board**: Click any square to enter letters already on the board
- **Visual Special Squares**: Double/Triple Letter and Word squares are color-coded
- **Tile Rack Input**: Enter your 7 available tiles (use `?` for blank tiles)
- **Smart Word Finder**: Finds all valid word placements and ranks them by score
- **Score Calculation**: Uses Crossplay scoring with 40-point bingo bonus
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
- **★ (Center)**: Double Word Score (first word must cover this)

### Bingo Bonus
Using all 7 tiles in one play earns a **40-point bonus**!

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

## License

Free to use for personal purposes.
