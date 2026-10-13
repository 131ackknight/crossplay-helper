// Letter values and bingo differ by game. Solver and breakdown both read window.LETTER_POINTS / window.BINGO_BONUS.
const LETTER_POINTS_BY_GAME = {
    crossplay: {
        'A': 1, 'B': 4, 'C': 3, 'D': 2, 'E': 1, 'F': 4, 'G': 4, 'H': 3,
        'I': 1, 'J': 10, 'K': 6, 'L': 2, 'M': 3, 'N': 1, 'O': 1, 'P': 3,
        'Q': 10, 'R': 1, 'S': 1, 'T': 1, 'U': 2, 'V': 6, 'W': 5, 'X': 8,
        'Y': 4, 'Z': 10, '?': 0
    },
    scrabble: {
        'A': 1, 'B': 3, 'C': 3, 'D': 2, 'E': 1, 'F': 4, 'G': 2, 'H': 4,
        'I': 1, 'J': 8, 'K': 5, 'L': 1, 'M': 3, 'N': 1, 'O': 1, 'P': 3,
        'Q': 10, 'R': 1, 'S': 1, 'T': 1, 'U': 1, 'V': 4, 'W': 4, 'X': 8,
        'Y': 4, 'Z': 10, '?': 0
    },
    wwf: {
        'A': 1, 'B': 4, 'C': 4, 'D': 2, 'E': 1, 'F': 4, 'G': 3, 'H': 3,
        'I': 1, 'J': 10, 'K': 5, 'L': 2, 'M': 4, 'N': 2, 'O': 1, 'P': 4,
        'Q': 10, 'R': 1, 'S': 1, 'T': 1, 'U': 2, 'V': 5, 'W': 4, 'X': 8,
        'Y': 3, 'Z': 10, '?': 0
    }
};
const BINGO_BONUS_BY_GAME = { crossplay: 40, scrabble: 50, wwf: 35 };
const MAX_BLANKS_BY_GAME = { crossplay: 3, scrabble: 2, wwf: 2 };
// Scrabble's center star is a double word. Crossplay's star only marks the opening square.
// Words with Friends has no center bonus. Crossplay's 8 double-word squares are nine fewer than Scrabble's 17.
const CENTER_DOUBLE_WORD = { crossplay: false, scrabble: true, wwf: false };
const SHOW_CENTER_STAR = { crossplay: true, scrabble: true, wwf: false };

// Game presets
const GAME_PRESETS = {
    crossplay: {
        name: 'NYT Crossplay',
        tw: [[0,3],[0,11],[3,0],[3,14],[11,0],[11,14],[14,3],[14,11]],
        dw: [[1,1],[1,13],[3,7],[7,3],[7,11],[11,7],[13,1],[13,13]],
        tl: [[0,0],[0,14],[1,6],[1,8],[4,5],[4,9],[5,4],[5,10],[6,1],[6,13],
             [8,1],[8,13],[9,4],[9,10],[10,5],[10,9],[13,6],[13,8],[14,0],[14,14]],
        dl: [[0,7],[2,4],[2,10],[3,3],[3,11],[4,2],[4,12],[5,7],[7,0],[7,5],
             [7,9],[7,14],[9,7],[10,2],[10,12],[11,3],[11,11],[12,4],[12,10],[14,7]]
    },
    scrabble: {
        name: 'Scrabble',
        tw: [[0,0],[0,7],[0,14],[7,0],[7,14],[14,0],[14,7],[14,14]],
        dw: [[1,1],[2,2],[3,3],[4,4],[1,13],[2,12],[3,11],[4,10],
             [13,1],[12,2],[11,3],[10,4],[13,13],[12,12],[11,11],[10,10],[7,7]],
        tl: [[1,5],[1,9],[5,1],[5,5],[5,9],[5,13],[9,1],[9,5],[9,9],[9,13],[13,5],[13,9]],
        dl: [[0,3],[0,11],[2,6],[2,8],[3,0],[3,7],[3,14],[6,2],[6,6],[6,8],[6,12],
             [7,3],[7,11],[8,2],[8,6],[8,8],[8,12],[11,0],[11,7],[11,14],[12,6],[12,8],
             [14,3],[14,11]]
    },
    wwf: {
        name: 'Words with Friends',
        tw: [[0,3],[0,11],[3,0],[3,14],[5,0],[5,14],[9,0],[9,14],[11,0],[11,14],[14,3],[14,11]],
        dw: [[1,6],[1,8],[5,5],[5,9],[7,3],[7,11],[9,5],[9,9],[13,6],[13,8]],
        tl: [[0,6],[0,8],[3,7],[5,7],[6,2],[6,12],[8,2],[8,12],[9,7],[11,7],[14,6],[14,8]],
        dl: [[1,2],[1,5],[1,9],[1,12],[2,1],[2,4],[2,10],[2,13],[3,3],[3,11],
             [4,2],[4,6],[4,8],[4,12],[5,1],[5,13],[6,4],[6,10],[7,6],[7,8],
             [8,4],[8,10],[9,1],[9,13],[10,2],[10,6],[10,8],[10,12],[11,3],[11,11],
             [12,1],[12,4],[12,10],[12,13],[13,2],[13,5],[13,9],[13,12]]
    }
};

function letterRowsHtml(game) {
    const points = LETTER_POINTS_BY_GAME[game];
    return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ?'.split('').map((letter) => {
        const label = letter === '?' ? 'Blank (?)' : letter;
        return '<tr><td>' + label + '</td><td>' + points[letter] + '</td></tr>';
    }).join('\n');
}

function letterDiffs(leftGame, rightGame) {
    const left = LETTER_POINTS_BY_GAME[leftGame];
    const right = LETTER_POINTS_BY_GAME[rightGame];
    const diffs = [];
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
        if (left[letter] !== right[letter]) {
            diffs.push({ letter, left: left[letter], right: right[letter] });
        }
    }
    return diffs;
}

function squareMap(game) {
    const preset = GAME_PRESETS[game];
    const squares = {};
    const paint = (list, kind) => list.forEach(([row, col]) => { squares[row + ',' + col] = kind; });
    paint(preset.tw, 'tw');
    paint(preset.dw, 'dw');
    paint(preset.tl, 'tl');
    paint(preset.dl, 'dl');
    if (SHOW_CENTER_STAR[game]) squares['7,7'] = 'center';
    return squares;
}

function boardLayoutHtml(game) {
    const squares = squareMap(game);
    let html = '';
    for (let row = 0; row < 15; row++) {
        for (let col = 0; col < 15; col++) {
            const kind = squares[row + ',' + col] || '';
            const label = kind === 'center' ? '★' : (kind ? kind.toUpperCase() : '');
            html += '<div class="cell' + (kind ? ' ' + kind : '') + '">' + label + '</div>';
        }
    }
    return html;
}

