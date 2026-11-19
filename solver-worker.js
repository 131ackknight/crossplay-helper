// Runs the board solver off the main thread. app.js sends the word list scripts once,
// then the board, scoring tables, and rack for each search.
// The dictionary script reads its settings from window and SPECIAL_SQUARES, so both live on the worker scope.
self.window = self;
self.SPECIAL_SQUARES = {};

self.onmessage = function (event) {
    const msg = event.data || {};
    if (msg.type === 'load') {
        try {
            importScripts.apply(self, msg.scripts);
            self.postMessage({ type: 'ready' });
        } catch (error) {
            self.postMessage({ type: 'load-error', message: String((error && error.message) || error) });
        }
        return;
    }
    if (msg.type === 'solve') {
        try {
            Object.assign(self, msg.state);
            self.SPECIAL_SQUARES = msg.specialSquares || {};
            self.postMessage({ type: 'moves', id: msg.id, moves: findAllMoves(msg.tiles) });
        } catch (error) {
            self.postMessage({ type: 'solve-error', id: msg.id, message: String((error && error.message) || error) });
        }
    }
};
