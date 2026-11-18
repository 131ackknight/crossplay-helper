(function () {
    var WORDS_SRC = '/spelling-bee-words.20261118.js';
    var STORE_KEY = 'wgh-spelling-bee';
    var RANKS = [
        ['Beginner', 0], ['Good Start', 2], ['Moving Up', 5], ['Good', 8], ['Solid', 15],
        ['Nice', 25], ['Great', 40], ['Amazing', 50], ['Genius', 70], ['Queen Bee', 100]
    ];
    var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    var WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

    var inputs = Array.prototype.slice.call(document.querySelectorAll('#beeInputs input'));
    var foundEl = document.getElementById('beeFound');
    var wordsLoading = null;
    var todayLoading = null;
    var current = null;
    var revealed = {};
    var revealAll = false;
    var state = readState();

    function $(id) {
        return document.getElementById(id);
    }

    function readState() {
        try {
            return JSON.parse(localStorage.getItem(STORE_KEY)) || {};
        } catch (e) {
            return {};
        }
    }

    function saveState() {
        try {
            localStorage.setItem(STORE_KEY, JSON.stringify(state));
        } catch (e) { /* storage full or blocked */ }
    }

    function escapeText(value) {
        return String(value).replace(/[&<>"]/g, function (ch) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch];
        });
    }

    function mask(word) {
        var m = 0;
        for (var i = 0; i < word.length; i++) m |= 1 << (word.charCodeAt(i) - 97);
        return m;
    }

    function bitCount(m) {
        var n = 0;
        while (m) {
            m &= m - 1;
            n++;
        }
        return n;
    }

    function isPangram(word) {
        return bitCount(mask(word)) === 7;
    }

    function score(word) {
        return (word.length === 4 ? 1 : word.length) + (isPangram(word) ? 7 : 0);
    }

    function total(words) {
        return words.reduce(function (sum, word) { return sum + score(word); }, 0);
    }

    function thresholds(max) {
        return RANKS.map(function (rank) {
            return { name: rank[0], points: Math.round(max * rank[1] / 100) };
        });
    }

    function longDate(iso) {
        var parts = iso.split('-').map(Number);
        var date = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
        return WEEKDAYS[date.getUTCDay()] + ', ' + MONTHS[date.getUTCMonth()] + ' ' + date.getUTCDate() + ', ' + date.getUTCFullYear();
    }

    function shortDate(iso) {
        var parts = iso.split('-').map(Number);
        return MONTHS[parts[1] - 1].slice(0, 3) + ' ' + parts[2];
    }

    function setStatus(text, isError) {
        var el = $('beeStatus');
        el.textContent = text;
        el.classList.toggle('bee-status--error', !!isError);
    }

    function loadScript(src) {
        return new Promise(function (resolve, reject) {
            var script = document.createElement('script');
            script.src = src;
            script.onload = function () { resolve(); };
            script.onerror = function () { reject(new Error(src)); };
            document.body.appendChild(script);
        });
    }

    function indexWords(list) {
        return list.filter(Boolean).map(function (word) { return { w: word, m: mask(word) }; });
    }

    function loadWords() {
        if (!wordsLoading) {
            var learned = fetch('/spelling-bee-learned.json').then(function (res) {
                return res.ok ? res.json() : null;
            }).catch(function () { return null; });
            wordsLoading = Promise.all([loadScript(WORDS_SRC), learned]).then(function (results) {
                var data = results[1] || { accepted: [], rejected: [], puzzles: 0 };
                return {
                    likely: indexWords(window.BEE_LIKELY.split('\n')),
                    other: indexWords(window.BEE_OTHER.split('\n')),
                    accepted: indexWords(data.accepted),
                    acceptedSet: new Set(data.accepted),
                    rejected: new Set(data.rejected),
                    puzzles: data.puzzles || 0
                };
            });
            wordsLoading.catch(function () { wordsLoading = null; });
        }
        return wordsLoading;
    }

    function loadToday() {
        if (!todayLoading) {
            todayLoading = fetch('/spelling-bee-today.json', { cache: 'no-cache' }).then(function (res) {
                if (!res.ok) throw new Error('HTTP ' + res.status);
                return res.json();
            });
            todayLoading.catch(function () { todayLoading = null; });
        }
        return todayLoading;
    }

    function getLetters() {
        return inputs.map(function (input) { return input.value.toLowerCase(); }).join('');
    }

    // With no start box, replaces all seven letters. With one, fills from that box on.
    function setLetters(text, from) {
        var letters = String(text || '').toLowerCase().replace(/[^a-z]/g, '');
        var start = from || 0;
        for (var i = start; i < inputs.length; i++) {
            if (i - start < letters.length) inputs[i].value = letters.charAt(i - start).toUpperCase();
            else if (from === undefined) inputs[i].value = '';
        }
        return Math.min(start + letters.length, inputs.length - 1);
    }

    function checkLetters(letters) {
        if (letters.length < 7) return 'Enter all seven letters, center letter first.';
        if (letters.indexOf('s') !== -1) return 'Spelling Bee never uses S. Check the letters.';
        for (var i = 0; i < letters.length; i++) {
            if (letters.indexOf(letters.charAt(i)) !== i) {
                return letters.charAt(i).toUpperCase() + ' is in there twice. Each letter appears once in the hive.';
            }
        }
        return '';
    }

    function sameHive(today, letters) {
        return today.center === letters.charAt(0) &&
            today.outer.slice().sort().join('') === letters.slice(1).split('').sort().join('');
    }

    function solve() {
        var letters = getLetters();
        var problem = checkLetters(letters);
        if (problem) {
            setStatus(problem, true);
            return;
        }
        setStatus('');
        if (state.letters !== letters) {
            state = { letters: letters, found: '' };
            foundEl.value = '';
            revealed = {};
            revealAll = false;
            saveState();
        }
        loadToday().then(function (today) {
            if (sameHive(today, letters)) showOfficial(today);
            else showGuess(letters);
        }, function () {
            showGuess(letters);
        });
    }

    function showOfficial(today) {
        current = {
            center: today.center,
            answers: today.answers.slice().sort(),
            other: [],
            official: true,
            date: today.date,
            url: today.url
        };
        render();
        loadWords().then(function (words) {
            if (!current || !current.official || current.date !== today.date) return;
            var answerSet = new Set(current.answers);
            var hive = mask(today.center + today.outer.join(''));
            var center = mask(today.center);
            var common = [];
            var rare = [];
            words.likely.concat(words.accepted).forEach(function (e) {
                if ((e.m & center) && !(e.m & ~hive) && !answerSet.has(e.w) && common.indexOf(e.w) === -1) common.push(e.w);
            });
            words.other.forEach(function (e) {
                if ((e.m & center) && !(e.m & ~hive) && !answerSet.has(e.w) && common.indexOf(e.w) === -1) rare.push(e.w);
            });
            current.other = common.sort().concat(rare.sort());
            renderOther();
        }).catch(function () { /* the left-out list is optional */ });
    }

    function showGuess(letters) {
        setStatus('Loading the word list…');
        loadWords().then(function (words) {
            setStatus('');
            var hive = mask(letters);
            var center = mask(letters.charAt(0));
            var answers = [];
            var other = [];
            function fits(e) {
                return (e.m & center) && !(e.m & ~hive);
            }
            words.likely.forEach(function (e) {
                if (fits(e)) (words.rejected.has(e.w) ? other : answers).push(e.w);
            });
            words.accepted.forEach(function (e) {
                if (fits(e) && answers.indexOf(e.w) === -1) answers.push(e.w);
            });
            words.other.forEach(function (e) {
                if (fits(e) && !words.acceptedSet.has(e.w)) other.push(e.w);
            });
            current = {
                center: letters.charAt(0),
                answers: answers.sort(),
                other: other.sort(),
                official: false,
                puzzles: words.puzzles
            };
            render();
        }, function () {
            setStatus('The word list did not load. Check your connection and try again.', true);
        });
    }

    function render() {
        $('beeEmpty').hidden = true;
        $('beeOutput').hidden = false;
        $('beeSource').textContent = current.official ? 'Official list · ' + shortDate(current.date) : 'Best guess';
        var note = $('beeNote');
        if (current.official) {
            note.innerHTML = 'The Times\' answer list for ' + escapeText(longDate(current.date)) +
                '. <a href="' + escapeText(current.url) + '">Open the answers page</a>';
        } else {
            note.textContent = 'A best guess from the Scrabble word list' +
                (current.puzzles ? ', corrected by ' + current.puzzles + ' past Times puzzles' : '') +
                '. The Times\' list may differ by a few words.';
        }
        foundEl.value = state.found || '';
        update();
        renderOther();
    }

    function renderOther() {
        var details = $('beeOther');
        var list = current.other;
        details.hidden = !list.length;
        if (!list.length) return;
        $('beeOtherSummary').textContent = (current.official ? 'Scrabble words the Times left out' : 'Rarer Scrabble words') + ' (' + list.length + ')';
        $('beeOtherNote').textContent = current.official
            ? 'These fit the letters and are in the Scrabble list, but the Times did not accept them. Common words come first.'
            : 'These fit the letters, but the Times takes few of them. If the Times accepts one, type it in your found words and it counts.';
        $('beeOtherList').innerHTML = list.map(function (word) { return '<li>' + escapeText(word.toUpperCase()) + '</li>'; }).join('');
    }

    // In a guess, a rarer word the player found must be one the Times took, so it moves up.
    function typedWords() {
        var answerSet = new Set(current.answers);
        var found = {};
        var unknown = [];
        var moved = false;
        foundEl.value.toLowerCase().split(/[^a-z]+/).forEach(function (word) {
            if (!word) return;
            if (!answerSet.has(word) && !current.official && current.other.indexOf(word) !== -1) {
                current.other.splice(current.other.indexOf(word), 1);
                current.answers.push(word);
                current.answers.sort();
                answerSet.add(word);
                moved = true;
            }
            if (answerSet.has(word)) found[word] = true;
            else if (unknown.indexOf(word) === -1) unknown.push(word);
        });
        return { found: found, unknown: unknown, moved: moved };
    }

    function update() {
        var typed = typedWords();
        if (typed.moved) renderOther();
        var found = typed.found;
        var answers = current.answers;
        var max = total(answers);
        var foundList = answers.filter(function (word) { return found[word]; });
        var pangrams = answers.filter(isPangram);
        var ranks = thresholds(max);
        var genius = ranks[8].points;
        var about = current.official ? '' : 'about ';

        $('beeStats').innerHTML = [
            '<li><b>' + answers.length + '</b> ' + (current.official ? '' : 'likely ') + (answers.length === 1 ? 'word' : 'words') + '</li>',
            '<li>' + about + '<b>' + max + '</b> points</li>',
            '<li><b>' + pangrams.length + '</b> ' + (pangrams.length === 1 ? 'pangram' : 'pangrams') + '</li>',
            '<li>Genius ' + about + '<b>' + genius + '</b></li>'
        ].join('');

        var points = total(foundList);
        var rank = ranks[0];
        var next = null;
        ranks.forEach(function (r) {
            if (points >= r.points) rank = r;
            else if (!next) next = r;
        });
        var progress = foundList.length + ' of ' + answers.length + ' words, ' + points + ' of ' + max + ' points. Rank: ' + rank.name + '.';
        if (next) progress += ' ' + next.name + ' is ' + (next.points - points) + (next.points - points === 1 ? ' point' : ' points') + ' away.';
        if (typed.unknown.length) {
            progress += ' Not on ' + (current.official ? 'the Times\' list' : 'the solver\'s list') + ': ' +
                typed.unknown.slice(0, 6).map(function (w) { return w.toUpperCase(); }).join(', ') + '.';
        }
        $('beeProgress').textContent = foundEl.value.trim() ? progress : 'Type the words you have found to count down the hints.';

        renderGrid(answers, found);
        renderTwos(answers, found);
        renderPangrams(pangrams, found);
        renderWords(answers, found);
        $('beeRevealAll').textContent = revealAll ? 'Hide all' : 'Reveal all';
        if (!answers.length) {
            $('beeWords').innerHTML = '<p class="bee-sub">No likely words for these letters. Check the rarer list below.</p>';
        }
    }

    function renderGrid(answers, found) {
        var lengths = [];
        var firsts = [];
        answers.forEach(function (word) {
            if (lengths.indexOf(word.length) === -1) lengths.push(word.length);
            if (firsts.indexOf(word.charAt(0)) === -1) firsts.push(word.charAt(0));
        });
        lengths.sort(function (a, b) { return a - b; });
        firsts.sort();
        if (!answers.length) {
            $('beeGrid').innerHTML = '';
            return;
        }
        function count(first, length, onlyLeft) {
            return answers.filter(function (word) {
                return (!first || word.charAt(0) === first) && (!length || word.length === length) && (!onlyLeft || !found[word]);
            }).length;
        }
        function cell(first, length) {
            var all = count(first, length, false);
            if (!all) return '<td class="bee-grid-none">-</td>';
            var left = count(first, length, true);
            return '<td' + (left ? '' : ' class="bee-grid-done"') + '>' + left + '</td>';
        }
        var html = '<div class="bee-grid-scroll"><table class="bee-grid"><thead><tr><th scope="col"><span class="visually-hidden">First letter</span></th>';
        lengths.forEach(function (length) { html += '<th scope="col">' + length + '</th>'; });
        html += '<th scope="col">Σ</th></tr></thead><tbody>';
        firsts.forEach(function (first) {
            html += '<tr><th scope="row">' + first.toUpperCase() + '</th>';
            lengths.forEach(function (length) { html += cell(first, length); });
            html += cell(first, null) + '</tr>';
        });
        html += '</tbody><tfoot><tr><th scope="row">Σ</th>';
        lengths.forEach(function (length) { html += cell(null, length); });
        html += cell(null, null) + '</tr></tfoot></table></div>';
        $('beeGrid').innerHTML = html;
    }

    function renderTwos(answers, found) {
        var pairs = {};
        answers.forEach(function (word) {
            var pair = word.slice(0, 2);
            if (!pairs[pair]) pairs[pair] = { all: 0, left: 0 };
            pairs[pair].all++;
            if (!found[word]) pairs[pair].left++;
        });
        $('beeTwos').innerHTML = Object.keys(pairs).sort().map(function (pair) {
            return '<li' + (pairs[pair].left ? '' : ' class="bee-done"') + '>' + pair.toUpperCase() + '-' + pairs[pair].left + '</li>';
        }).join('');
    }

    function renderPangrams(pangrams, found) {
        if (!pangrams.length) {
            $('beePangrams').innerHTML = '<li>No pangram in this list. The Times puzzle always has at least one.</li>';
            return;
        }
        $('beePangrams').innerHTML = pangrams.map(function (word) {
            if (found[word]) return '<li class="bee-done">Found: <b>' + word.toUpperCase() + '</b></li>';
            return '<li>' + word.length + ' letters, starts with ' + word.charAt(0).toUpperCase() +
                (word.length === 7 ? '. Perfect pangram: each letter once.' : '') + '</li>';
        }).join('');
    }

    function renderWords(answers, found) {
        var groups = {};
        answers.forEach(function (word) {
            var pair = word.slice(0, 2);
            (groups[pair] = groups[pair] || []).push(word);
        });
        $('beeWords').innerHTML = Object.keys(groups).sort().map(function (pair) {
            var chips = groups[pair].map(function (word) {
                var shown = found[word] || revealed[word] || revealAll;
                var classes = 'bee-chip' + (isPangram(word) ? ' bee-chip--pangram' : '') + (found[word] ? ' bee-chip--found' : '') + (shown ? '' : ' bee-chip--hidden');
                var text = shown ? word.toUpperCase() : word.slice(0, 2).toUpperCase() + new Array(word.length - 1).join('_');
                var label = shown ? '' : ' aria-label="Hidden ' + word.length + '-letter word starting with ' + pair.toUpperCase() + '. Tap to reveal."';
                return '<button type="button" class="' + classes + '" data-word="' + word + '"' + label + '>' + text + '</button>';
            }).join('');
            return '<div class="bee-group"><span class="bee-group-label">' + pair.toUpperCase() + '</span><div class="bee-group-chips">' + chips + '</div></div>';
        }).join('');
    }

    inputs.forEach(function (input, i) {
        input.addEventListener('input', function () {
            var letters = input.value.toLowerCase().replace(/[^a-z]/g, '');
            if (letters.length > 1) {
                inputs[letters.length >= 7 ? setLetters(letters.slice(0, 7)) : setLetters(letters, i)].focus();
                return;
            }
            input.value = letters.toUpperCase();
            if (letters && i < inputs.length - 1) inputs[i + 1].focus();
        });
        input.addEventListener('paste', function (event) {
            var text = (event.clipboardData || window.clipboardData).getData('text');
            var letters = String(text || '').toLowerCase().replace(/[^a-z]/g, '');
            if (letters.length < 2) return;
            event.preventDefault();
            inputs[letters.length >= 7 ? setLetters(letters.slice(0, 7)) : setLetters(letters, i)].focus();
        });
        input.addEventListener('keydown', function (event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                solve();
            } else if (event.key === 'Backspace' && !input.value && i > 0) {
                event.preventDefault();
                inputs[i - 1].value = '';
                inputs[i - 1].focus();
            } else if (event.key === 'ArrowLeft' && i > 0) {
                inputs[i - 1].focus();
            } else if (event.key === 'ArrowRight' && i < inputs.length - 1) {
                inputs[i + 1].focus();
            }
        });
        input.addEventListener('focus', function () { input.select(); });
    });

    foundEl.addEventListener('input', function () {
        state.found = foundEl.value;
        saveState();
        if (current) update();
    });

    $('beeWords').addEventListener('click', function (event) {
        var chip = event.target.closest('.bee-chip');
        if (!chip) return;
        var word = chip.getAttribute('data-word');
        revealed[word] = !revealed[word];
        update();
    });

    $('beeRevealAll').addEventListener('click', function () {
        revealAll = !revealAll;
        if (!revealAll) revealed = {};
        update();
    });

    $('beeSolve').addEventListener('click', solve);

    $('beeToday').addEventListener('click', function () {
        setStatus('Loading today\'s puzzle…');
        loadToday().then(function (today) {
            setLetters(today.center + today.outer.join(''));
            solve();
        }, function () {
            setStatus('Today\'s puzzle did not load. Type the letters instead.', true);
        });
    });

    $('beeClear').addEventListener('click', function () {
        setLetters('');
        foundEl.value = '';
        state = {};
        current = null;
        revealed = {};
        revealAll = false;
        try {
            localStorage.removeItem(STORE_KEY);
        } catch (e) { /* storage blocked */ }
        $('beeOutput').hidden = true;
        $('beeEmpty').hidden = false;
        $('beeSource').textContent = '';
        setStatus('');
        inputs[0].focus();
    });

    if (state.letters && state.letters.length === 7) {
        setLetters(state.letters);
        solve();
    } else {
        loadToday().then(function (today) {
            if (getLetters()) return;
            setLetters(today.center + today.outer.join(''));
            solve();
        }, function () { /* the empty form still works */ });
    }
})();
