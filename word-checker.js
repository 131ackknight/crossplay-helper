(function () {
    var LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    var loading = null;

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = src;
            script.onload = function () { resolve(); };
            script.onerror = function () { reject(new Error(src)); };
            document.body.appendChild(script);
        });
    }

    function ensureDictionary() {
        if (window.SOLVER_WORDS && window.CROSSPLAY_CUTS) return Promise.resolve();
        if (!loading) {
            loading = loadScript('/crossplay-cuts.js').then(function () {
                return loadScript('/dictionary.20261109.js');
            });
        }
        return loading;
    }

    function normalize(raw) {
        return String(raw || '').toUpperCase().replace(/[^A-Z]/g, '');
    }

    function currentGame() {
        var active = document.querySelector('.game-pill.active');
        return active ? active.getAttribute('data-game') : 'crossplay';
    }

    function hooksFor(word) {
        var before = [];
        var after = [];
        for (var i = 0; i < LETTERS.length; i++) {
            var letter = LETTERS.charAt(i);
            if (lexiconHas(letter + word)) before.push(letter);
            if (word.length < 15 && lexiconHas(word + letter)) after.push(letter);
        }
        return { before: before, after: after };
    }

    function verdict(word, game) {
        window.lexiconGame = game;
        var inFile = window.SOLVER_WORDS.has(word);
        var cut = window.CROSSPLAY_CUTS.has(word);
        if (word.length < 2) {
            return { kind: 'no', title: 'Too short', text: 'A play has to be at least two letters.' };
        }
        if (word.length > 15) {
            return { kind: 'no', title: 'Too long', text: 'The board is 15 squares across. This checker stops at 15 letters.' };
        }
        if (cut && game === 'crossplay') {
            return {
                kind: 'cut',
                title: word + ' is not playable in Crossplay',
                text: inFile
                    ? 'The Times removed it from NWL2023. It is one of 182 cuts, almost all trademarks or proper nouns. The Scrabble setting on this site still has it.'
                    : 'The Times removed it from NWL2023. It is one of 182 cuts, almost all trademarks or proper nouns. It is not in this solver\'s file either.'
            };
        }
        if (inFile) {
            var text = game === 'wwf'
                ? 'It is in this solver\'s file. Words with Friends has its own list, which is not loaded here, so this is not a Words with Friends ruling.'
                : game === 'scrabble'
                    ? 'It is in this solver\'s file. Scrabble\'s current list, NWL2023, still has 17,991 words this file does not.'
                    : 'Crossplay has not cut it. This file is still missing 17,991 other Crossplay words, but this word is one both lists share.';
            if (word.length === 2) text += ' The 107 two-letter words in this file match NWL2023.';
            return { kind: 'yes', title: word + ' is in this solver\'s list', text: text, hooks: hooksFor(word) };
        }
        return {
            kind: 'no',
            title: word + ' is not in this solver\'s list',
            text: 'That is not a Crossplay ruling. Crossplay has 196,419 words. This file has 178,562. The missing 17,991 were added to the NASPA list after 2006. The about page has the counts.'
        };
    }

    function escapeText(value) {
        return String(value).replace(/[&<>]/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch];
        });
    }

    function render(result) {
        var el = document.getElementById('verdict');
        var hooks = '';
        if (result.hooks) {
            hooks = '<p class="hook-row">Before: ' + (result.hooks.before.join(' ') || 'none') + '</p>'
                + '<p class="hook-row">After: ' + (result.hooks.after.join(' ') || 'none') + '</p>';
        }
        el.className = 'verdict verdict--' + result.kind;
        el.hidden = false;
        el.innerHTML = '<p><strong>' + escapeText(result.title) + '</strong></p><p>' + escapeText(result.text) + '</p>' + hooks;
    }

    function check(event) {
        if (event) event.preventDefault();
        var input = document.getElementById('checkWord');
        var word = normalize(input.value);
        input.value = word;
        var verdictEl = document.getElementById('verdict');
        if (!word) {
            render({ kind: 'no', title: 'Type a word', text: 'Letters only. A blank is not a word.' });
            return;
        }
        verdictEl.hidden = false;
        verdictEl.className = 'verdict';
        verdictEl.innerHTML = '<p>Checking the word list…</p>';
        ensureDictionary().then(function () {
            render(verdict(word, currentGame()));
        }).catch(function () {
            render({ kind: 'no', title: 'The word list did not load', text: 'Check your connection and try again.' });
        });
    }

    document.querySelectorAll('.game-pill').forEach(function (btn) {
        btn.addEventListener('click', function () {
            document.querySelectorAll('.game-pill').forEach(function (other) {
                var on = other === btn;
                other.classList.toggle('active', on);
                other.setAttribute('aria-pressed', on ? 'true' : 'false');
            });
            window.lexiconGame = btn.getAttribute('data-game');
            if (document.getElementById('checkWord').value) check();
        });
    });

    document.getElementById('checkForm').addEventListener('submit', check);
    window.lexiconGame = 'crossplay';
})();
