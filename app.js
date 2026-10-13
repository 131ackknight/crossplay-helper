        // Board configuration
        const BOARD_SIZE = 15;
        const CENTER = 7;
        const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
        // Also expose to window for dictionary.js
        window.BOARD_SIZE = BOARD_SIZE;
        window.CENTER = CENTER;

        function applyGameScoring(game) {
            const key = LETTER_POINTS_BY_GAME[game] ? game : 'crossplay';
            window.LETTER_POINTS = LETTER_POINTS_BY_GAME[key];
            window.BINGO_BONUS = BINGO_BONUS_BY_GAME[key];
            window.maxBlanks = MAX_BLANKS_BY_GAME[key];
            window.centerScoresDoubleWord = CENTER_DOUBLE_WORD[key];
            window.showCenterStar = SHOW_CENTER_STAR[key];
        }

        applyGameScoring('crossplay');

        // Special squares configuration (Crossplay layout)
        const SPECIAL_SQUARES = {};
        
        // Triple Word (TW) - red squares
        [[0,3],[0,11],[3,0],[3,14],[11,0],[11,14],[14,3],[14,11]].forEach(([r,c]) => {
            SPECIAL_SQUARES[`${r},${c}`] = 'tw';
        });
        
        // Double Word (DW) - pink squares
        [[1,1],[1,13],[3,7],[7,3],[7,11],[11,7],[13,1],[13,13]].forEach(([r,c]) => {
            SPECIAL_SQUARES[`${r},${c}`] = 'dw';
        });
        
        // Triple Letter (TL) - dark blue squares
        [[0,0],[0,14],[1,6],[1,8],[4,5],[4,9],[5,4],[5,10],[6,1],[6,13],
         [8,1],[8,13],[9,4],[9,10],[10,5],[10,9],[13,6],[13,8],[14,0],[14,14]].forEach(([r,c]) => {
            SPECIAL_SQUARES[`${r},${c}`] = 'tl';
        });
        
        // Double Letter (DL) - light blue squares
        [[0,7],[2,4],[2,10],[3,3],[3,11],[4,2],[4,12],[5,7],[7,0],[7,5],
         [7,9],[7,14],[9,7],[10,2],[10,12],[11,3],[11,11],[12,4],[12,10],[14,7]].forEach(([r,c]) => {
            SPECIAL_SQUARES[`${r},${c}`] = 'dl';
        });

        // Center
        SPECIAL_SQUARES[`${CENTER},${CENTER}`] = 'center';

        // Store default configuration for reset
        const DEFAULT_SPECIAL_SQUARES = { ...SPECIAL_SQUARES };

        // Current game type
        let currentGame = 'crossplay';
        
        // Currently selected saved board name (empty = working on unsaved board)
        let currentSavedBoardName = localStorage.getItem('crossplay_current_board_name') || '';
        
        // Helper to set and persist the current board name
        function setCurrentBoardName(name) {
            currentSavedBoardName = name;
            localStorage.setItem('crossplay_current_board_name', name);
        }

        // Layout version - increment this when default layout changes
        const LAYOUT_VERSION = 4;

        // A dedicated solver URL pins its game. The homepage still restores the last choice.
        function pageGameDefault() {
            const game = document.body && document.body.dataset.game;
            return game && GAME_PRESETS[game] ? game : '';
        }

        function paintPreset(game) {
            const preset = GAME_PRESETS[game];
            for (const key in SPECIAL_SQUARES) {
                delete SPECIAL_SQUARES[key];
            }
            preset.tw.forEach(([r, c]) => { SPECIAL_SQUARES[`${r},${c}`] = 'tw'; });
            preset.dw.forEach(([r, c]) => { SPECIAL_SQUARES[`${r},${c}`] = 'dw'; });
            preset.tl.forEach(([r, c]) => { SPECIAL_SQUARES[`${r},${c}`] = 'tl'; });
            preset.dl.forEach(([r, c]) => { SPECIAL_SQUARES[`${r},${c}`] = 'dl'; });
            if (SHOW_CENTER_STAR[game]) {
                SPECIAL_SQUARES['7,7'] = 'center';
            }
        }

        // Load saved bonus configuration from localStorage
        function loadBonusConfig() {
            try {
                const pinnedGame = pageGameDefault();
                if (pinnedGame) {
                    currentGame = pinnedGame;
                } else {
                    const savedGame = localStorage.getItem('crossplayHelper_game');
                    if (savedGame && GAME_PRESETS[savedGame]) {
                        currentGame = savedGame;
                    }
                }
                applyGameScoring(currentGame);

                if (pinnedGame) {
                    // Show this page's board without overwriting a layout saved from another game.
                    paintPreset(currentGame);
                    const enabledState = localStorage.getItem('crossplay_bonuses_enabled');
                    if (enabledState !== null) {
                        window.bonusScoringEnabled = enabledState === 'true';
                    }
                    return;
                }

                // Check if layout version changed - if so, reset to current game's defaults
                const savedVersion = localStorage.getItem('crossplay_layout_version');
                if (savedVersion !== String(LAYOUT_VERSION)) {
                    // New layout version - clear old saved config and apply current game's defaults
                    localStorage.removeItem('crossplay_bonuses');
                    localStorage.setItem('crossplay_layout_version', String(LAYOUT_VERSION));
                    
                    paintPreset(currentGame);
                    return;
                }

                const saved = localStorage.getItem('crossplay_bonuses');
                if (saved) {
                    const config = JSON.parse(saved);
                    // Clear current and apply saved
                    for (const key in SPECIAL_SQUARES) {
                        delete SPECIAL_SQUARES[key];
                    }
                    Object.assign(SPECIAL_SQUARES, config);
                }
                
                // Load bonus enabled state
                const enabledState = localStorage.getItem('crossplay_bonuses_enabled');
                if (enabledState !== null) {
                    window.bonusScoringEnabled = enabledState === 'true';
                }
            } catch (e) {
                console.log('Could not load bonus config:', e);
            }
        }

        // Save bonus configuration to localStorage
        function saveBonusConfig() {
            try {
                localStorage.setItem('crossplay_bonuses', JSON.stringify(SPECIAL_SQUARES));
                localStorage.setItem('crossplay_bonuses_enabled', String(window.bonusScoringEnabled));
            } catch (e) {
                console.log('Could not save bonus config:', e);
            }
        }

        // Save board state to localStorage
        // - When on unsaved board: write to crossplay_board (the one "unsaved" workspace).
        // - When on a saved board: only update that board in saved boards; do not touch crossplay_board.
        function saveBoardState() {
            try {
                if (currentSavedBoardName) {
                    const boards = getSavedBoards();
                    if (boards[currentSavedBoardName]) {
                        boards[currentSavedBoardName].boardState = JSON.parse(JSON.stringify(window.boardState));
                        boards[currentSavedBoardName].savedAt = new Date().toISOString();
                        setSavedBoards(boards);
                    }
                } else {
                    localStorage.setItem('crossplay_board', JSON.stringify(window.boardState));
                }
            } catch (e) {
                console.log('Could not save board state:', e);
            }
        }

        // Load board state from localStorage
        function loadBoardState() {
            try {
                const saved = localStorage.getItem('crossplay_board');
                if (saved) {
                    const savedBoard = JSON.parse(saved);
                    // Validate it's the right size
                    if (savedBoard.length === BOARD_SIZE && savedBoard[0].length === BOARD_SIZE) {
                        window.boardState = savedBoard;
                        return true;
                    }
                }
            } catch (e) {
                console.log('Could not load board state:', e);
            }
            return false;
        }

        // Get all saved boards from localStorage
        function getSavedBoards() {
            try {
                const saved = localStorage.getItem('crossplay_saved_boards');
                return saved ? JSON.parse(saved) : {};
            } catch (e) {
                return {};
            }
        }

        // Save all boards to localStorage
        function setSavedBoards(boards) {
            try {
                localStorage.setItem('crossplay_saved_boards', JSON.stringify(boards));
            } catch (e) {
                console.log('Could not save boards:', e);
            }
        }

        // Save current board with a name
        function saveCurrentBoard() {
            const name = prompt('Enter a name for this board (e.g., "Game vs Mom"):');
            if (!name || !name.trim()) return;
            
            const boardName = name.trim();
            const boards = getSavedBoards();
            
            // Save board data including game type, bonuses, and tiles
            boards[boardName] = {
                boardState: JSON.parse(JSON.stringify(window.boardState)),
                gameType: currentGame,
                bonuses: JSON.parse(JSON.stringify(SPECIAL_SQUARES)),
                bonusEnabled: window.bonusScoringEnabled,
                playerTiles: getPlayerTilesArray(),
                savedAt: new Date().toISOString()
            };
            
            setSavedBoards(boards);
            
            // Track this as the active saved board
            setCurrentBoardName(boardName);
            
            // Refresh dropdown (will auto-select the active board)
            updateBoardSelect();
            
            alert(`Board "${boardName}" saved! Changes will auto-save.`);
        }

        // Check if current board has any tiles
        function boardHasTiles() {
            for (let row = 0; row < BOARD_SIZE; row++) {
                for (let col = 0; col < BOARD_SIZE; col++) {
                    if (window.boardState[row][col]) {
                        return true;
                    }
                }
            }
            return false;
        }

        // Load a saved board (or switch to unsaved workspace)
        function loadSavedBoard() {
            const select = document.getElementById('boardSelect');
            const boardName = select.value;
            
            // Switching to "Unsaved Board" — restore the unsaved workspace from localStorage
            if (!boardName) {
                if (currentSavedBoardName) {
                    const boards = getSavedBoards();
                    if (boards[currentSavedBoardName]) {
                        boards[currentSavedBoardName].boardState = JSON.parse(JSON.stringify(window.boardState));
                        boards[currentSavedBoardName].playerTiles = getPlayerTilesArray();
                        boards[currentSavedBoardName].savedAt = new Date().toISOString();
                        setSavedBoards(boards);
                    }
                }
                setCurrentBoardName('');
                const saved = localStorage.getItem('crossplay_board');
                if (saved) {
                    try {
                        const parsed = JSON.parse(saved);
                        if (parsed.length === BOARD_SIZE && parsed[0].length === BOARD_SIZE) {
                            window.boardState = parsed;
                        }
                    } catch (e) {}
                }
                const tilesSaved = localStorage.getItem('crossplay_player_tiles');
                if (tilesSaved) {
                    try {
                        setPlayerTiles(JSON.parse(tilesSaved));
                    } catch (e) {
                        setPlayerTiles([]);
                    }
                } else {
                    setPlayerTiles([]);
                }
                refreshBonusDisplay();
                applySavedBoard();
                updateBoardSelect();
                return;
            }
            
            // Check if current board is unsaved and has tiles
            if (!currentSavedBoardName && boardHasTiles()) {
                const targetBoard = boardName; // Remember where we want to go
                const response = confirm(
                    'You have an unsaved board with tiles on it.\n\n' +
                    'Click "OK" to save it first, or "Cancel" to discard and switch.'
                );
                
                if (response) {
                    // User wants to save first
                    const name = prompt('Enter a name for this board (e.g., "Game vs Mom"):');
                    if (name && name.trim()) {
                        // Save the current board
                        const boards = getSavedBoards();
                        boards[name.trim()] = {
                            boardState: JSON.parse(JSON.stringify(window.boardState)),
                            gameType: currentGame,
                            bonuses: JSON.parse(JSON.stringify(SPECIAL_SQUARES)),
                            bonusEnabled: window.bonusScoringEnabled,
                            playerTiles: getPlayerTilesArray(),
                            savedAt: new Date().toISOString()
                        };
                        setSavedBoards(boards);
                    } else {
                        // User cancelled the name prompt - abort the whole switch
                        updateBoardSelect();
                        return;
                    }
                }
                // Continue with switch to target board (either after saving or discarding)
            }
            
            const boards = getSavedBoards();
            const savedBoard = boards[boardName];
            
            if (!savedBoard) {
                alert('Board not found');
                select.value = '';
                setCurrentBoardName('');
                return;
            }
            
            // Track this as the active saved board
            setCurrentBoardName(boardName);
            
            // Load board state
            window.boardState = savedBoard.boardState;
            
            // Load game type
            if (savedBoard.gameType && GAME_PRESETS[savedBoard.gameType]) {
                currentGame = savedBoard.gameType;
                document.getElementById('gameSelect').value = currentGame;
                applyGameScoring(currentGame);
            }
            
            // Load bonus configuration
            if (savedBoard.bonuses) {
                for (const key in SPECIAL_SQUARES) {
                    delete SPECIAL_SQUARES[key];
                }
                Object.assign(SPECIAL_SQUARES, savedBoard.bonuses);
            }
            
            // Load bonus enabled state
            if (savedBoard.bonusEnabled !== undefined) {
                window.bonusScoringEnabled = savedBoard.bonusEnabled;
                document.getElementById('bonusEnabled').checked = window.bonusScoringEnabled;
            }
            
            // Load player tiles
            if (savedBoard.playerTiles) {
                setPlayerTiles(savedBoard.playerTiles);
            } else {
                // Clear tiles if none saved
                setPlayerTiles([]);
            }
            
            // Refresh display
            refreshBonusDisplay();
            applySavedBoard();
            
            // Do not overwrite the unsaved workspace (crossplay_board) when loading a named board,
            // so switching back to "Unsaved Board" restores the previous unsaved state.
            saveBonusConfig();
            localStorage.setItem('crossplayHelper_game', currentGame);
        }

        // Delete a saved board
        function deleteSavedBoard() {
            const select = document.getElementById('boardSelect');
            const boardName = select.value;
            
            if (!boardName) {
                alert('Select a saved board to delete');
                return;
            }
            
            if (!confirm(`Delete board "${boardName}"?`)) {
                return;
            }
            
            const boards = getSavedBoards();
            delete boards[boardName];
            setSavedBoards(boards);
            
            // If we deleted the active board, clear it
            if (currentSavedBoardName === boardName) {
                setCurrentBoardName('');
                
                // Clear the board
                window.boardState = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
                applySavedBoard();
                
                // Clear the tiles
                setPlayerTiles([]);
                
                // Clear results
                document.getElementById('results').innerHTML = '';
                
                // Save the cleared state
                localStorage.setItem('crossplay_board', JSON.stringify(window.boardState));
                localStorage.setItem('crossplay_player_tiles', JSON.stringify([]));
            }
            
            // Refresh dropdown
            updateBoardSelect();
        }

        // Start a new empty board
        function newBoard() {
            if (!confirm('Start a new empty board? Make sure to save your current board first if needed.')) {
                return;
            }
            
            // Stop tracking any saved board
            setCurrentBoardName('');
            
            // Clear board state
            window.boardState = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
            
            // Reset display
            for (let row = 0; row < BOARD_SIZE; row++) {
                for (let col = 0; col < BOARD_SIZE; col++) {
                    updateCellDisplay(row, col);
                }
            }
            
            // Refresh board select to show unsaved state
            updateBoardSelect();
            
            // Clear results
            document.getElementById('results').innerHTML = '';
            
            // Save the empty board (just to localStorage, not a named board)
            localStorage.setItem('crossplay_board', JSON.stringify(window.boardState));
        }

        // Update the board select dropdown
        function updateBoardSelect() {
            const select = document.getElementById('boardSelect');
            
            // Clear all options
            select.innerHTML = '';
            
            // Add saved boards
            const boards = getSavedBoards();
            const sortedNames = Object.keys(boards).sort((a, b) => {
                // Sort by most recently saved
                const dateA = boards[a].savedAt || '';
                const dateB = boards[b].savedAt || '';
                return dateB.localeCompare(dateA);
            });
            
            if (sortedNames.length === 0) {
                // No saved boards - show placeholder
                const placeholder = document.createElement('option');
                placeholder.value = '';
                placeholder.textContent = 'No saved boards';
                placeholder.disabled = true;
                select.appendChild(placeholder);
            } else {
                // Always offer "Unsaved Board" so user can switch back to it from any saved board
                const unsavedOption = document.createElement('option');
                unsavedOption.value = '';
                unsavedOption.textContent = '-- Unsaved Board --';
                if (!currentSavedBoardName) {
                    unsavedOption.selected = true;
                }
                select.appendChild(unsavedOption);
                
                for (const name of sortedNames) {
                    const option = document.createElement('option');
                    option.value = name;
                    const gameLabel = boards[name].gameType ? ` (${GAME_PRESETS[boards[name].gameType]?.name || boards[name].gameType})` : '';
                    option.textContent = name + gameLabel;
                    if (name === currentSavedBoardName) {
                        option.selected = true;
                    }
                    select.appendChild(option);
                }
            }
        }

        // Load saved config on startup
        loadBonusConfig();

        // Board state (on window so dictionary.js can access it)
        window.boardState = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
        let selectedCell = null;
        let highlightedCells = [];
        let typeDirection = 'H'; // H = horizontal (across), V = vertical (down)

        // Initialize the board
        function initBoard() {
            const boardEl = document.getElementById('board');
            boardEl.innerHTML = '';

            for (let row = 0; row < BOARD_SIZE; row++) {
                for (let col = 0; col < BOARD_SIZE; col++) {
                    const cell = document.createElement('div');
                    cell.className = 'cell';
                    cell.dataset.row = row;
                    cell.dataset.col = col;

                    const special = SPECIAL_SQUARES[`${row},${col}`];
                    if (special) {
                        cell.classList.add(special);
                        cell.textContent = special === 'center' ? '★' : special.toUpperCase();
                    }

                    cell.addEventListener('click', () => handleCellClick(row, col));
                    boardEl.appendChild(cell);
                }
            }

            // Desktop: listen for keydown events directly on the board
            if (!isTouchDevice) {
                boardEl.addEventListener('keydown', handleBoardKeydown);
            }

            // Mobile: route typing through a hidden input so the virtual keyboard appears
            if (isTouchDevice) {
                const boardInput = document.getElementById('boardInput');
                if (boardInput) {
                    boardInput.addEventListener('keydown', handleBoardKeydown);
                    boardInput.addEventListener('input', (e) => {
                        if (!e.target.value) return;
                        const ch = e.target.value.slice(-1);
                        const fakeEvent = {
                            key: ch,
                            preventDefault: () => {}
                        };
                        handleBoardKeydown(fakeEvent);
                        e.target.value = '';
                    });
                }
            }
        }

        // Select a cell for input
        function selectCell(row, col) {
            // Remove previous selection
            document.querySelectorAll('.cell.selected').forEach(c => c.classList.remove('selected'));
            
            selectedCell = { row, col };
            const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
            cell.classList.add('selected');
            
            // Focus the appropriate element to capture keyboard input
            if (isTouchDevice) {
                const boardInput = document.getElementById('boardInput');
                if (boardInput) {
                    boardInput.focus();
                    boardInput.value = '';
                }
            } else {
                document.getElementById('board').focus();
            }
        }

        // Deselect cell
        function deselectCell() {
            document.querySelectorAll('.cell.selected').forEach(c => c.classList.remove('selected'));
            selectedCell = null;
        }

        // Set typing direction
        function setDirection(dir) {
            typeDirection = dir;
            document.getElementById('dirH').classList.toggle('active', dir === 'H');
            document.getElementById('dirV').classList.toggle('active', dir === 'V');
        }

        // Bonus scoring state (global so dictionary.js can access it)
        window.bonusScoringEnabled = true;

        // Toggle bonus scoring on/off
        function toggleBonusScoring() {
            window.bonusScoringEnabled = document.getElementById('bonusEnabled').checked;
            // Update visual indicator on cells
            document.querySelectorAll('.cell').forEach(cell => {
                const row = parseInt(cell.dataset.row);
                const col = parseInt(cell.dataset.col);
                const special = SPECIAL_SQUARES[`${row},${col}`];
                if (special) {
                    cell.classList.toggle('bonus-disabled', !window.bonusScoringEnabled);
                }
            });
            saveBonusConfig();
        }

        // Handle cell click - select for typing
        function handleCellClick(row, col) {
            selectCell(row, col);
        }

        // Apply a game preset
        function applyGamePreset(gameType) {
            if (!GAME_PRESETS[gameType]) return;
            paintPreset(gameType);
            refreshBonusDisplay();
            saveBonusConfig();
        }

        // Change game type
        function changeGame() {
            const select = document.getElementById('gameSelect');
            currentGame = select.value;
            applyGameScoring(currentGame);
            applyGamePreset(currentGame);
            enforceBlankLimit(true);
            
            // Save selected game to localStorage
            localStorage.setItem('crossplayHelper_game', currentGame);
        }

        // Refresh bonus display on all cells
        function refreshBonusDisplay() {
            for (let row = 0; row < BOARD_SIZE; row++) {
                for (let col = 0; col < BOARD_SIZE; col++) {
                    const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
                    cell.classList.remove('dl', 'tl', 'dw', 'tw', 'center');
                    
                    if (!window.boardState[row][col]) {
                        const special = SPECIAL_SQUARES[`${row},${col}`];
                        if (special) {
                            cell.classList.add(special);
                            cell.textContent = special === 'center' ? '★' : special.toUpperCase();
                        } else {
                            cell.textContent = '';
                        }
                    }
                }
            }
        }

        // Handle keyboard input on board
        function handleBoardKeydown(e) {
            if (!selectedCell) return;

            const { row, col } = selectedCell;

            // Letter input
            if (/^[a-zA-Z]$/.test(e.key)) {
                e.preventDefault();
                const letter = e.key.toUpperCase();
                window.boardState[row][col] = letter;
                updateCellDisplay(row, col);
                saveBoardState();
                
                // Auto-advance to next cell
                if (typeDirection === 'H' && col < BOARD_SIZE - 1) {
                    selectCell(row, col + 1);
                } else if (typeDirection === 'V' && row < BOARD_SIZE - 1) {
                    selectCell(row + 1, col);
                }
                return;
            }

            // Arrow key navigation
            if (e.key === 'ArrowUp' && row > 0) {
                e.preventDefault();
                selectCell(row - 1, col);
            } else if (e.key === 'ArrowDown' && row < BOARD_SIZE - 1) {
                e.preventDefault();
                selectCell(row + 1, col);
            } else if (e.key === 'ArrowLeft' && col > 0) {
                e.preventDefault();
                selectCell(row, col - 1);
            } else if (e.key === 'ArrowRight' && col < BOARD_SIZE - 1) {
                e.preventDefault();
                selectCell(row, col + 1);
            }

            // Backspace - clear current cell and move back
            if (e.key === 'Backspace') {
                e.preventDefault();
                if (window.boardState[row][col]) {
                    window.boardState[row][col] = null;
                    updateCellDisplay(row, col);
                    saveBoardState();
                } else {
                    // Move back
                    if (typeDirection === 'H' && col > 0) {
                        selectCell(row, col - 1);
                        window.boardState[row][col - 1] = null;
                        updateCellDisplay(row, col - 1);
                        saveBoardState();
                    } else if (typeDirection === 'V' && row > 0) {
                        selectCell(row - 1, col);
                        window.boardState[row - 1][col] = null;
                        updateCellDisplay(row - 1, col);
                        saveBoardState();
                    }
                }
            }

            // Delete - clear current cell
            if (e.key === 'Delete') {
                e.preventDefault();
                window.boardState[row][col] = null;
                updateCellDisplay(row, col);
                saveBoardState();
            }

            // Escape - deselect
            if (e.key === 'Escape') {
                e.preventDefault();
                deselectCell();
            }

            // Tab - toggle direction
            if (e.key === 'Tab') {
                e.preventDefault();
                setDirection(typeDirection === 'H' ? 'V' : 'H');
            }
        }

        // Count blanks in tile inputs
        function countBlanks() {
            const inputs = document.querySelectorAll('#tileInput input');
            return Array.from(inputs).filter(input => input.value === '?').length;
        }

        // Initialize tile inputs
        function initTileInputs() {
            const container = document.getElementById('tileInput');
            container.innerHTML = '';

            for (let i = 0; i < 7; i++) {
                const input = document.createElement('input');
                input.type = 'text';
                input.maxLength = 1;
                input.placeholder = '';
                input.addEventListener('input', (e) => {
                    let value = e.target.value.toUpperCase();
                    
                    // Check if trying to add a blank (?)
                    if (value === '?') {
                        const currentBlanks = countBlanks();
                        // Don't count this input if it was already a blank
                        const wasBlank = e.target.dataset.prevValue === '?';
                        if (!wasBlank && currentBlanks > window.maxBlanks) {
                            e.target.value = '';
                            const gameName = GAME_PRESETS[currentGame]?.name || 'This game';
                            alert(`${gameName} has ${window.maxBlanks} blank ${window.maxBlanks === 1 ? 'tile' : 'tiles'}.`);
                            return;
                        }
                    }
                    
                    e.target.value = value;
                    e.target.dataset.prevValue = value;
                    
                    if (e.target.value && i < 6) {
                        container.children[i + 1].focus();
                    }
                    
                    savePlayerTiles();
                });
                input.addEventListener('keydown', (e) => {
                    if (e.key === 'Backspace' && !e.target.value && i > 0) {
                        container.children[i - 1].focus();
                    }
                });
                input.addEventListener('blur', savePlayerTiles);
                container.appendChild(input);
            }
        }

        // Get player tiles as string
        function getPlayerTiles() {
            const inputs = document.querySelectorAll('#tileInput input');
            return Array.from(inputs)
                .map(input => input.value.toUpperCase())
                .filter(v => v)
                .join('');
        }

        // Get player tiles as array (preserves empty slots)
        function getPlayerTilesArray() {
            const inputs = document.querySelectorAll('#tileInput input');
            return Array.from(inputs).map(input => input.value.toUpperCase());
        }

        // Set player tiles from array
        function setPlayerTiles(tilesArray) {
            const inputs = document.querySelectorAll('#tileInput input');
            inputs.forEach((input, i) => {
                input.value = tilesArray[i] || '';
                input.dataset.prevValue = input.value;
            });
            enforceBlankLimit(false);
        }

        // Drop rack blanks beyond the selected game's tile bag.
        function enforceBlankLimit(notify) {
            const inputs = document.querySelectorAll('#tileInput input');
            let seen = 0;
            let removed = 0;
            inputs.forEach((input) => {
                if (input.value === '?') {
                    seen++;
                    if (seen > window.maxBlanks) {
                        input.value = '';
                        input.dataset.prevValue = '';
                        removed++;
                    }
                }
            });
            if (removed && notify) {
                const gameName = GAME_PRESETS[currentGame]?.name || 'This game';
                alert(`${gameName} allows ${window.maxBlanks} blanks. Extra blanks were cleared.`);
            }
            if (removed) savePlayerTiles();
        }

        // Save player tiles to localStorage
        function savePlayerTiles() {
            const tiles = getPlayerTilesArray();
            if (currentSavedBoardName) {
                const boards = getSavedBoards();
                if (boards[currentSavedBoardName]) {
                    boards[currentSavedBoardName].playerTiles = tiles;
                    setSavedBoards(boards);
                }
            } else {
                localStorage.setItem('crossplay_player_tiles', JSON.stringify(tiles));
            }
        }

        // Load player tiles from localStorage
        function loadPlayerTiles() {
            try {
                const saved = localStorage.getItem('crossplay_player_tiles');
                if (saved) {
                    const tiles = JSON.parse(saved);
                    setPlayerTiles(tiles);
                }
            } catch (e) {
                console.log('Could not load player tiles:', e);
            }
        }

        // Clear player tiles
        function clearTiles() {
            const inputs = document.querySelectorAll('#tileInput input');
            inputs.forEach(input => input.value = '');
            inputs[0].focus();
            document.getElementById('results').innerHTML = '';
            savePlayerTiles();
        }

        // Update cell display
        function updateCellDisplay(row, col) {
            const cell = document.querySelector(`.cell[data-row="${row}"][data-col="${col}"]`);
            const letter = window.boardState[row][col];

            // Always clear bonus classes first
            cell.classList.remove('dl', 'tl', 'dw', 'tw', 'center');

            if (letter) {
                cell.classList.add('has-tile');
                cell.textContent = letter;
                cell.dataset.points = window.LETTER_POINTS[letter] || 0;
            } else {
                cell.classList.remove('has-tile');
                const special = SPECIAL_SQUARES[`${row},${col}`];
                if (special) {
                    cell.classList.add(special);
                    cell.textContent = special === 'center' ? '★' : special.toUpperCase();
                } else {
                    cell.textContent = '';
                }
                delete cell.dataset.points;
            }
        }

        // Clear board
        function clearBoard() {
            window.boardState = Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null));
            for (let row = 0; row < BOARD_SIZE; row++) {
                for (let col = 0; col < BOARD_SIZE; col++) {
                    updateCellDisplay(row, col);
                }
            }
            clearHighlights();
            document.getElementById('results').innerHTML = '';
            // If we're viewing a saved board, don't overwrite it with empty — switch to unsaved so the saved board stays intact
            if (currentSavedBoardName) {
                setCurrentBoardName('');
                localStorage.setItem('crossplay_board', JSON.stringify(window.boardState));
                updateBoardSelect();
            } else {
                saveBoardState();
            }
        }

        // Clear highlighted cells
        function clearHighlights() {
            document.querySelectorAll('.cell.highlighted, .cell.new-tile').forEach(cell => {
                cell.classList.remove('highlighted', 'new-tile');
            });
        }

        // Format word with blanks shown in lowercase
        function formatWordWithBlanks(move) {
            if (!move.blankPositions || move.blankPositions.length === 0) {
                return move.word;
            }
            
            let result = '';
            for (let i = 0; i < move.word.length; i++) {
                if (move.blankPositions.includes(i)) {
                    result += `<span style="text-transform: lowercase; color: #888;">${move.word[i].toLowerCase()}</span>`;
                } else {
                    result += move.word[i];
                }
            }
            return result;
        }

        // Highlight a word placement
        function highlightWord(move) {
            clearHighlights();
            const { row, col, direction, word, newTiles } = move;

            for (let i = 0; i < word.length; i++) {
                const r = direction === 'H' ? row : row + i;
                const c = direction === 'H' ? col + i : col;
                const cell = document.querySelector(`.cell[data-row="${r}"][data-col="${c}"]`);

                if (cell) {
                    cell.classList.add('highlighted');
                    if (newTiles.includes(i)) {
                        cell.classList.add('new-tile');
                    }
                }
            }
        }

        // Find words - main function
        function findWords() {
            const tiles = getPlayerTiles();
            
            if (tiles.length === 0) {
                showResults({ error: 'Please enter your available tiles first.' });
                return;
            }

            const tooManyBlanks = (tiles.match(/\?/g) || []).length;
            if (tooManyBlanks > window.maxBlanks) {
                const gameName = GAME_PRESETS[currentGame]?.name || 'This game';
                showResults({ error: `${gameName} has only ${window.maxBlanks} blank tiles.` });
                return;
            }

            if (typeof findAllMoves !== 'function') {
                showResults({ error: 'The word list is still loading. Try again in a moment.' });
                return;
            }

            const resultsDiv = document.getElementById('results');
            const blankCount = (tiles.match(/\?/g) || []).length;
            const loadingMsg = blankCount >= 2 
                ? 'Finding best words (this may take a moment with multiple blanks)...'
                : 'Finding best words...';
            resultsDiv.innerHTML = `<div class="loading">${loadingMsg}</div>`;

            // Reset hint state when finding words
            window.hintLevel = 0;

            // Use setTimeout to allow UI to update
            setTimeout(() => {
                try {
                    const moves = findAllMoves(tiles);
                    showResults({ moves });
                } catch (e) {
                    showResults({ error: 'Search took too long. Try using fewer blank tiles.' });
                }
            }, 50);
        }

        // Hint state tracking
        window.hintLevel = 0;
        window.cachedHintMoves = null;

        // Get hint - progressive hints
        function getHint() {
            const tiles = getPlayerTiles();
            
            if (tiles.length === 0) {
                showResults({ error: 'Please enter your available tiles first.' });
                return;
            }

            const tooManyBlanks = (tiles.match(/\?/g) || []).length;
            if (tooManyBlanks > window.maxBlanks) {
                const gameName = GAME_PRESETS[currentGame]?.name || 'This game';
                showResults({ error: `${gameName} has only ${window.maxBlanks} blank tiles.` });
                return;
            }

            if (typeof findAllMoves !== 'function') {
                showResults({ error: 'The word list is still loading. Try again in a moment.' });
                return;
            }

            const resultsDiv = document.getElementById('results');
            
            // If we don't have cached moves or tiles changed, recalculate
            if (!window.cachedHintMoves || window.cachedHintTiles !== tiles) {
                resultsDiv.innerHTML = '<div class="loading">Analyzing board</div>';
                
                setTimeout(() => {
                    const moves = findAllMoves(tiles);
                    window.cachedHintMoves = moves;
                    window.cachedHintTiles = tiles;
                    window.hintLevel = 1;
                    showHint(moves, 1);
                }, 50);
            } else {
                // Progress to next hint level
                window.hintLevel = Math.min(window.hintLevel + 1, 5);
                showHint(window.cachedHintMoves, window.hintLevel);
            }
        }

        // Show hint based on level
        function showHint(moves, level) {
            const resultsDiv = document.getElementById('results');
            
            if (!moves || moves.length === 0) {
                resultsDiv.innerHTML = `
                    <div class="no-results">
                        <p>No valid words found.</p>
                        <p>Make sure you've entered your tiles correctly.</p>
                    </div>`;
                return;
            }

            const best = moves[0];
            const playerTiles = getPlayerTiles();
            
            // Find which player tiles are used
            const usedTiles = [];
            for (const idx of best.newTiles) {
                usedTiles.push(best.word[idx]);
            }
            
            // Build progressive hints
            let hints = [];
            
            // Level 1: Score range
            hints.push(`<div class="hint-item">The best word scores <strong>${best.score} points</strong></div>`);
            
            // Level 2: Word length
            if (level >= 2) {
                hints.push(`<div class="hint-item">The word is <strong>${best.word.length} letters</strong> long</div>`);
            }
            
            // Level 3: Direction and general area
            if (level >= 3) {
                const direction = best.direction === 'H' ? 'horizontally (Across)' : 'vertically (Down)';
                const rowArea = best.row < 5 ? 'top' : best.row > 9 ? 'bottom' : 'middle';
                const colArea = best.col < 5 ? 'left' : best.col > 9 ? 'right' : 'center';
                hints.push(`<div class="hint-item">Play it <strong>${direction}</strong> in the <strong>${rowArea}-${colArea}</strong> area</div>`);
            }
            
            // Level 4: Number of tiles used and high-value tiles
            if (level >= 4) {
                hints.push(`<div class="hint-item">You'll use <strong>${best.newTiles.length} tiles</strong> from your rack</div>`);
                const highValue = usedTiles.filter(t => window.LETTER_POINTS[t] >= 4);
                if (highValue.length > 0) {
                    hints.push(`<div class="hint-item">High-value tiles used: <strong>${highValue.join(', ')}</strong></div>`);
                }
            }
            
            // Level 5: First letter hint
            if (level >= 5) {
                hints.push(`<div class="hint-item">The word starts with <strong>"${best.word[0]}"</strong></div>`);
            }
            
            const moreHints = level < 5 ? `<p class="hint-more">Click "Get a Hint" again for more clues (${level}/5)</p>` : '<p class="hint-more">That\'s all the hints! Use "Show Me Best Move" to see the answer.</p>';
            
            resultsDiv.innerHTML = `
                <div class="hint-container">
                    <h3>Hints</h3>
                    ${hints.join('')}
                    ${moreHints}
                </div>`;
        }

        // Show results
        function showResults(data) {
            const resultsDiv = document.getElementById('results');

            if (data.error) {
                resultsDiv.innerHTML = `<div class="status error">${data.error}</div>`;
                return;
            }

            if (!data.moves || data.moves.length === 0) {
                resultsDiv.innerHTML = `
                    <div class="no-results">
                        <p>No valid words found.</p>
                        <p>Make sure you've entered your tiles correctly.</p>
                    </div>`;
                return;
            }

            const top20 = data.moves.slice(0, 20);
            
            resultsDiv.innerHTML = `
                <h3>Best Words (${data.moves.length} found)</h3>
                <div class="results-list">
                    ${top20.map((move, i) => `
                        <div class="result-item" 
                             onmouseenter="highlightWord(window.foundMoves[${i}])"
                             onmouseleave="clearHighlights()"
                             onclick="selectMove(${i})">
                            <span class="result-word">${formatWordWithBlanks(move)}</span>
                            <div class="result-info">
                                <div class="result-score">${move.score} pts</div>
                                <div class="result-position">${move.direction === 'H' ? 'Across' : 'Down'} at ${move.row + 1},${move.col + 1}</div>
                            </div>
                            <button class="place-btn" onclick="event.stopPropagation(); placeMove(${i})">Place</button>
                        </div>
                    `).join('')}
                </div>`;

            window.foundMoves = top20;
        }

        // Select a move
        function selectMove(index) {
            document.querySelectorAll('.result-item').forEach((el, i) => {
                el.classList.toggle('active', i === index);
            });
            highlightWord(window.foundMoves[index]);
            showScoreBreakdown(window.foundMoves[index]);
        }

        // Place a move on the board
        function placeMove(index) {
            const move = window.foundMoves[index];
            if (!move) return;
            
            const { word, row, col, direction, newTiles, blankPositions = [] } = move;
            const isHorizontal = direction === 'H';
            
            // Place each letter of the word on the board
            for (let i = 0; i < word.length; i++) {
                const r = isHorizontal ? row : row + i;
                const c = isHorizontal ? col + i : col;
                
                // Only place if it's a new tile (not already on board)
                if (newTiles.includes(i)) {
                    window.boardState[r][c] = word[i];
                    updateCellDisplay(r, c);
                }
            }
            
            // Remove used tiles from the rack
            const inputs = document.querySelectorAll('#tileInput input');
            const usedTiles = [];
            
            // Collect tiles that were used (new tiles only)
            for (let i = 0; i < word.length; i++) {
                if (newTiles.includes(i)) {
                    // Check if this position used a blank (blankPositions can be Set or array)
                    const isBlank = blankPositions instanceof Set 
                        ? blankPositions.has(i) 
                        : (Array.isArray(blankPositions) && blankPositions.includes(i));
                    if (isBlank) {
                        usedTiles.push('?');
                    } else {
                        usedTiles.push(word[i]);
                    }
                }
            }
            
            // Remove used tiles from rack inputs
            for (const tile of usedTiles) {
                for (const input of inputs) {
                    if (input.value.toUpperCase() === tile) {
                        input.value = '';
                        break;
                    }
                }
            }
            
            // Consolidate remaining tiles to the left
            const remainingTiles = Array.from(inputs)
                .map(input => input.value)
                .filter(v => v); // Get non-empty values
            
            // Clear all inputs and refill from the left
            inputs.forEach((input, i) => {
                input.value = remainingTiles[i] || '';
            });
            
            // Save the board state and player tiles
            saveBoardState();
            savePlayerTiles();
            
            // Clear results and highlights
            clearHighlights();
            document.getElementById('results').innerHTML = 
                '<div style="padding: 15px; text-align: center; color: var(--accent);">' +
                `Placed "${word}" for ${move.score} points!</div>`;
        }

        // Show detailed score breakdown
        function showScoreBreakdown(move) {
            const { word, row, col, direction, score, newTiles, blankPositions = [] } = move;
            const isHorizontal = direction === 'H';
            
            let breakdown = [];
            let wordMultiplier = 1;
            let baseWordScore = 0;
            let crossWordTotal = 0;
            
            // Calculate main word breakdown
            for (let i = 0; i < word.length; i++) {
                const r = isHorizontal ? row : row + i;
                const c = isHorizontal ? col + i : col;
                const letter = word[i];
                const isNew = newTiles.includes(i);
                const isBlank = blankPositions.includes(i);
                const rawSpecial = SPECIAL_SQUARES[`${r},${c}`];
                const special = (rawSpecial === 'center' && !window.centerScoresDoubleWord) ? null : rawSpecial;
                
                let basePoints = isBlank ? 0 : (window.LETTER_POINTS[letter] || 0);
                let letterMult = 1;
                let wordMult = 1;
                
                if (isNew && window.bonusScoringEnabled) {
                    if (r === 7 && c === 7 && window.centerScoresDoubleWord) wordMult = 2;
                    else if (special === 'dl') letterMult = 2;
                    else if (special === 'tl') letterMult = 3;
                    else if (special === 'dw') wordMult = 2;
                    else if (special === 'tw') wordMult = 3;
                }
                
                const finalPoints = basePoints * letterMult;
                baseWordScore += finalPoints;
                wordMultiplier *= wordMult;
                
                breakdown.push({
                    letter,
                    position: `(${r+1},${c+1})`,
                    isNew,
                    isBlank,
                    special: isNew ? special : null,
                    basePoints,
                    letterMult,
                    wordMult,
                    finalPoints
                });
            }
            
            const mainWordScore = baseWordScore * wordMultiplier;
            
            // Calculate cross-words
            let crossWords = [];
            for (const i of newTiles) {
                const r = isHorizontal ? row : row + i;
                const c = isHorizontal ? col + i : col;
                const crossInfo = getCrossWordInfo(r, c, word[i], direction, blankPositions.includes(i));
                if (crossInfo) {
                    crossWords.push(crossInfo);
                    crossWordTotal += crossInfo.score;
                }
            }
            
            // Bingo bonus
            const bingoBonus = newTiles.length === 7 ? window.BINGO_BONUS : 0;
            
            // Build breakdown HTML
            let html = `
                <div class="score-breakdown">
                    <h4>Score Breakdown: ${word}</h4>
                    <table class="breakdown-table">
                        <tr>
                            <th>Letter</th>
                            <th>Pos</th>
                            <th>Base</th>
                            <th>Bonus</th>
                            <th>Points</th>
                        </tr>
                        ${breakdown.map(b => `
                            <tr class="${b.isNew ? 'new-tile' : ''} ${b.isBlank ? 'blank-tile' : ''}">
                                <td>${b.letter}${b.isBlank ? ' (blank)' : ''}${b.isNew ? ' *' : ''}</td>
                                <td>${b.position}</td>
                                <td>${b.basePoints}</td>
                                <td>${b.special ? b.special.toUpperCase() : '-'}</td>
                                <td>${b.finalPoints}${b.wordMult > 1 ? ` (×${b.wordMult} word)` : ''}</td>
                            </tr>
                        `).join('')}
                    </table>
                    <div class="breakdown-total">
                        <span>Main word: ${baseWordScore}${wordMultiplier > 1 ? ` × ${wordMultiplier}` : ''} = ${mainWordScore}</span>
                    </div>
                    ${crossWords.length > 0 ? `
                        <div style="margin-top: 10px; font-size: 12px;">
                            <strong>Cross-words:</strong>
                            ${crossWords.map(cw => `<div>${cw.word}: ${cw.score} pts</div>`).join('')}
                            <div><strong>Cross-word total: ${crossWordTotal}</strong></div>
                        </div>
                    ` : ''}
                    ${bingoBonus > 0 ? `<div style="margin-top: 5px; color: #f1c40f;">Bingo bonus (7 tiles): +${bingoBonus}</div>` : ''}
                    <div class="breakdown-total" style="font-size: 16px; color: var(--accent);">
                        <span>TOTAL</span>
                        <span>${mainWordScore} + ${crossWordTotal}${bingoBonus > 0 ? ` + ${bingoBonus}` : ''} = ${score}</span>
                    </div>
                    <div style="margin-top: 10px; font-size: 11px; color: var(--text-secondary);">
                        * = new tile placed from your rack
                    </div>
                </div>
            `;
            
            // Remove existing breakdown and add new one
            const existing = document.querySelector('.score-breakdown');
            if (existing) existing.remove();
            
            document.querySelector('.results').insertAdjacentHTML('beforeend', html);
        }

        // Get cross-word info for a position
        function getCrossWordInfo(row, col, letter, mainDirection, isBlank) {
            const isHorizontal = mainDirection === 'H';
            let crossWord = letter;
            let hasAdjacent = false;
            let startR = row, startC = col;
            
            // Look backwards
            let pos = isHorizontal ? row - 1 : col - 1;
            while (pos >= 0) {
                const r = isHorizontal ? pos : row;
                const c = isHorizontal ? col : pos;
                if (window.boardState[r][c]) {
                    crossWord = window.boardState[r][c] + crossWord;
                    startR = isHorizontal ? pos : row;
                    startC = isHorizontal ? col : pos;
                    hasAdjacent = true;
                    pos--;
                } else break;
            }
            
            // Look forwards
            pos = isHorizontal ? row + 1 : col + 1;
            while (pos < BOARD_SIZE) {
                const r = isHorizontal ? pos : row;
                const c = isHorizontal ? col : pos;
                if (window.boardState[r][c]) {
                    crossWord = crossWord + window.boardState[r][c];
                    hasAdjacent = true;
                    pos++;
                } else break;
            }
            
            if (!hasAdjacent) return null;
            
            // Calculate score
            let score = 0;
            let multiplier = 1;
            
            for (let i = 0; i < crossWord.length; i++) {
                const r = isHorizontal ? startR + i : startR;
                const c = isHorizontal ? startC : startC + i;
                const char = crossWord[i];
                const isNewTile = (isHorizontal && r === row) || (!isHorizontal && c === col);
                
                let letterScore = (isNewTile && isBlank) ? 0 : (window.LETTER_POINTS[char] || 0);
                
                if (isNewTile && window.bonusScoringEnabled) {
                    const special = SPECIAL_SQUARES[`${r},${c}`];
                    if (r === 7 && c === 7 && window.centerScoresDoubleWord) multiplier *= 2;
                    else if (special === 'dl') letterScore *= 2;
                    else if (special === 'tl') letterScore *= 3;
                    else if (special === 'dw') multiplier *= 2;
                    else if (special === 'tw') multiplier *= 3;
                }
                
                score += letterScore;
            }
            
            return { word: crossWord, score: score * multiplier };
        }

        // Initialize UI to match saved state
        function initSavedState() {
            const select = document.getElementById('gameSelect');
            const pinnedGame = pageGameDefault();
            if (pinnedGame) {
                currentGame = pinnedGame;
                if (select) select.value = currentGame;
                applyGameScoring(currentGame);
            } else {
                const savedGame = localStorage.getItem('crossplayHelper_game');
                if (savedGame && GAME_PRESETS[savedGame]) {
                    currentGame = savedGame;
                    if (select) select.value = currentGame;
                    applyGameScoring(currentGame);
                }
            }
            
            // Sync bonus enabled checkbox
            const checkbox = document.getElementById('bonusEnabled');
            if (!checkbox) return;
            checkbox.checked = window.bonusScoringEnabled;
            
            // Update visual state if bonuses are disabled
            if (!window.bonusScoringEnabled) {
                document.querySelectorAll('.cell').forEach(cell => {
                    const row = parseInt(cell.dataset.row);
                    const col = parseInt(cell.dataset.col);
                    const special = SPECIAL_SQUARES[`${row},${col}`];
                    if (special) {
                        cell.classList.add('bonus-disabled');
                    }
                });
            }
        }

        // Apply saved board state to display
        function applySavedBoard() {
            for (let row = 0; row < BOARD_SIZE; row++) {
                for (let col = 0; col < BOARD_SIZE; col++) {
                    // Update ALL cells, not just ones with tiles
                    updateCellDisplay(row, col);
                }
            }
        }

        // Initialize on load. Explainer pages do not include a board.
        if (document.getElementById('board')) {
            initBoard();
            initTileInputs();
            loadBoardState();
            loadPlayerTiles();
            applySavedBoard();
            initSavedState();

            if (currentSavedBoardName) {
                const boards = getSavedBoards();
                if (!boards[currentSavedBoardName]) {
                    setCurrentBoardName('');
                }
            }

            updateBoardSelect();
        }
