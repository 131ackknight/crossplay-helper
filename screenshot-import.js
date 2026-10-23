// Read an NYT Crossplay screenshot in the browser. The image is never uploaded.
(function () {
    const POINTS = {
        A: 1, B: 4, C: 3, D: 2, E: 1, F: 4, G: 4, H: 3,
        I: 1, J: 10, K: 6, L: 2, M: 3, N: 1, O: 1, P: 3,
        Q: 10, R: 1, S: 1, T: 1, U: 2, V: 6, W: 5, X: 8,
        Y: 4, Z: 10
    };
    const LETTER_SIZE = 24;
    const DIGIT_SIZE = 16;
    const MIN_GRID_SCORE = 1.5;
    const UNSURE_SCORE = 0.82;

    let letterTemplates = null;
    let digitTemplates = null;
    let tessWorker = null;
    let currentImage = null;
    let cropRect = null;
    let cropDrag = null;

    function unpack(b64, size) {
        const bin = atob(b64);
        const out = new Float32Array(size * size);
        const n = Math.min(bin.length, out.length);
        for (let i = 0; i < n; i++) out[i] = bin.charCodeAt(i) / 255;
        return out;
    }

    function loadTemplates() {
        if (letterTemplates) return;
        const src = window.CROSSPLAY_GLYPHS || { letters: {}, digits: {} };
        letterTemplates = {};
        digitTemplates = {};
        Object.keys(src.letters || {}).forEach((ch) => {
            letterTemplates[ch] = unpack(src.letters[ch], LETTER_SIZE);
        });
        Object.keys(src.digits || {}).forEach((ch) => {
            digitTemplates[ch] = unpack(src.digits[ch], DIGIT_SIZE);
        });
    }

    function ncc(a, b) {
        let meanA = 0;
        let meanB = 0;
        for (let i = 0; i < a.length; i++) {
            meanA += a[i];
            meanB += b[i];
        }
        meanA /= a.length;
        meanB /= b.length;
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < a.length; i++) {
            const da = a[i] - meanA;
            const db = b[i] - meanB;
            dot += da * db;
            normA += da * da;
            normB += db * db;
        }
        const denom = Math.sqrt(normA * normB);
        return denom < 1e-6 ? 0 : dot / denom;
    }

    function drawToCanvas(img) {
        const canvas = document.createElement('canvas');
        canvas.width = img.naturalWidth || img.width;
        canvas.height = img.naturalHeight || img.height;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        return { width: canvas.width, height: canvas.height, data };
    }

    function pitchOf(white, width, height) {
        const profile = new Float64Array(width);
        for (let x = 0; x < width; x++) {
            let sum = 0;
            for (let y = 0; y < height; y++) sum += white[y * width + x];
            profile[x] = sum / height;
        }
        let mean = 0;
        for (let i = 0; i < width; i++) mean += profile[i];
        mean /= width;
        for (let i = 0; i < width; i++) profile[i] -= mean;
        const limit = Math.min(width, height);
        let best = null;
        for (let lag = 12; lag < 400; lag++) {
            if (15 * lag > limit * 1.05) break;
            if (15 * lag < limit * 0.4) continue;
            let score = 0;
            for (let i = 0; i < width - lag; i++) score += profile[i] * profile[i + lag];
            const prev = score;
            if (best && score < best.score) continue;
            // Keep peaks only. Compare with neighbors by a cheap local check later.
            if (!best || score > best.score) best = { score, lag, raw: prev };
        }
        if (!best) return null;
        // Snap to the local peak so a plateau does not land one pixel early.
        const lag = best.lag;
        function corr(step) {
            if (step < 12 || 15 * step > limit * 1.05) return -Infinity;
            let score = 0;
            for (let i = 0; i < width - step; i++) score += profile[i] * profile[i + step];
            return score;
        }
        let peak = lag;
        if (corr(lag - 1) > corr(peak)) peak = lag - 1;
        if (corr(lag + 1) > corr(peak)) peak = lag + 1;
        return peak;
    }

    function locate(white, width, height, pitch) {
        const span = 15 * pitch;
        if (span >= height || span >= width) return null;
        let best = null;
        const step = 3;
        for (let y0 = 0; y0 <= height - span; y0 += step) {
            for (let x0 = 0; x0 <= width - span; x0 += step) {
                let boundary = 0;
                let boundaryN = 0;
                for (let i = 0; i < 16; i++) {
                    const x = Math.min(width - 1, x0 + i * pitch);
                    for (let y = y0; y < y0 + span; y += 4) {
                        boundary += white[y * width + x];
                        boundaryN++;
                    }
                    const y = Math.min(height - 1, y0 + i * pitch);
                    for (let x2 = x0; x2 < x0 + span; x2 += 4) {
                        boundary += white[y * width + x2];
                        boundaryN++;
                    }
                }
                let centers = 0;
                let centerN = 0;
                for (let row = 0; row < 15; row++) {
                    const y = Math.min(height - 1, y0 + Math.floor((row + 0.5) * pitch));
                    for (let col = 0; col < 15; col++) {
                        const x = Math.min(width - 1, x0 + Math.floor((col + 0.5) * pitch));
                        centers += white[y * width + x];
                        centerN++;
                    }
                }
                const score = boundary / boundaryN + (1 - centers / centerN);
                if (!best || score > best.score) best = { score, x0, y0 };
            }
        }
        return best;
    }

    function isTileCrop(data, width, x1, y1, x2, y2) {
        let blue = 0;
        let green = 0;
        let n = 0;
        for (let y = y1; y < y2; y++) {
            for (let x = x1; x < x2; x++) {
                const i = (y * width + x) * 4;
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                if (b > 130 && b > r + 35 && b > g + 15) blue++;
                if (g > 100 && g > r + 25 && g > b + 25 && g < 210) green++;
                n++;
            }
        }
        if (!n) return false;
        return blue / n > 0.35 || green / n > 0.35;
    }

    function components(mask, width, height) {
        const seen = new Uint8Array(width * height);
        const found = [];
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const start = y * width + x;
                if (!mask[start] || seen[start]) continue;
                const stack = [start];
                seen[start] = 1;
                let count = 0;
                let minX = x;
                let maxX = x;
                let minY = y;
                let maxY = y;
                while (stack.length) {
                    const idx = stack.pop();
                    count++;
                    const cy = Math.floor(idx / width);
                    const cx = idx - cy * width;
                    if (cx < minX) minX = cx;
                    if (cx > maxX) maxX = cx;
                    if (cy < minY) minY = cy;
                    if (cy > maxY) maxY = cy;
                    const neighbors = [idx - 1, idx + 1, idx - width, idx + width];
                    for (let n = 0; n < 4; n++) {
                        const next = neighbors[n];
                        if (n < 2) {
                            const ny = Math.floor(next / width);
                            if (ny !== cy) continue;
                        }
                        if (next < 0 || next >= mask.length || !mask[next] || seen[next]) continue;
                        seen[next] = 1;
                        stack.push(next);
                    }
                }
                found.push({ count, minX, minY, maxX, maxY });
            }
        }
        found.sort((a, b) => b.count - a.count);
        return found;
    }

    function boxResize(src, sw, sh, dw, dh) {
        const out = new Float32Array(dw * dh);
        for (let y = 0; y < dh; y++) {
            const y0 = (y * sh) / dh;
            const y1 = ((y + 1) * sh) / dh;
            const iy0 = Math.floor(y0);
            const iy1 = Math.min(sh, Math.ceil(y1));
            for (let x = 0; x < dw; x++) {
                const x0 = (x * sw) / dw;
                const x1 = ((x + 1) * sw) / dw;
                const ix0 = Math.floor(x0);
                const ix1 = Math.min(sw, Math.ceil(x1));
                let sum = 0;
                let n = 0;
                for (let yy = iy0; yy < iy1; yy++) {
                    for (let xx = ix0; xx < ix1; xx++) {
                        sum += src[yy * sw + xx];
                        n++;
                    }
                }
                out[y * dw + x] = n ? sum / n : 0;
            }
        }
        return out;
    }

    function toCanvas(mask, mw, mh, x0, y0, x1, y1, size) {
        const sw = x1 - x0 + 1;
        const sh = y1 - y0 + 1;
        const src = new Float32Array(sw * sh);
        for (let y = 0; y < sh; y++) {
            for (let x = 0; x < sw; x++) src[y * sw + x] = mask[(y0 + y) * mw + (x0 + x)] ? 1 : 0;
        }
        const pad = 1;
        const scale = (size - 2 * pad) / Math.max(sw, sh, 1);
        const nh = Math.max(1, Math.round(sh * scale));
        const nw = Math.max(1, Math.round(sw * scale));
        const resized = boxResize(src, sw, sh, nw, nh);
        const out = new Float32Array(size * size);
        const ox = Math.floor((size - nw) / 2);
        const oy = Math.floor((size - nh) / 2);
        for (let y = 0; y < nh; y++) {
            for (let x = 0; x < nw; x++) out[(oy + y) * size + (ox + x)] = resized[y * nw + x];
        }
        return out;
    }

    function glyphsFromCrop(data, imageWidth, x1, y1, x2, y2) {
        const cw = x2 - x1;
        const ch = y2 - y1;
        if (cw < 8 || ch < 8) return null;
        const mask = new Uint8Array(cw * ch);
        let inkCount = 0;
        for (let y = 0; y < ch; y++) {
            for (let x = 0; x < cw; x++) {
                const i = ((y1 + y) * imageWidth + (x1 + x)) * 4;
                const lum = (data[i] + data[i + 1] + data[i + 2]) / 3;
                if (lum > 200) {
                    mask[y * cw + x] = 1;
                    inkCount++;
                }
            }
        }
        if (inkCount < 20) return null;
        const comps = components(mask, cw, ch);
        if (!comps.length || comps[0].count < 20) return null;
        const letterBox = comps[0];
        const cy = (letterBox.minY + letterBox.maxY) / 2;
        const cx = (letterBox.minX + letterBox.maxX) / 2;
        if (letterBox.count < 40 && cy < ch * 0.45 && cx > cw * 0.45) return null;
        const letter = toCanvas(mask, cw, ch, letterBox.minX, letterBox.minY, letterBox.maxX, letterBox.maxY, LETTER_SIZE);
        const digits = [];
        for (let i = 1; i < comps.length; i++) {
            const box = comps[i];
            if (box.count < 8) continue;
            const midY = (box.minY + box.maxY) / 2;
            const midX = (box.minX + box.maxX) / 2;
            if (midY < ch * 0.5 && midX > cw * 0.32) {
                digits.push({
                    x: box.minX,
                    glyph: toCanvas(mask, cw, ch, box.minX, box.minY, box.maxX, box.maxY, DIGIT_SIZE)
                });
            }
        }
        digits.sort((a, b) => a.x - b.x);
        return { letter, digits: digits.map((item) => item.glyph) };
    }

    function bestMatches(glyph, templates) {
        const scored = [];
        Object.keys(templates).forEach((ch) => {
            scored.push({ ch, score: ncc(glyph, templates[ch]) });
        });
        scored.sort((a, b) => b.score - a.score);
        return scored;
    }

    function readDigit(parts) {
        if (!parts.length || !Object.keys(digitTemplates).length) return '';
        let text = '';
        parts.forEach((part) => {
            const scored = bestMatches(part, digitTemplates);
            if (scored.length && scored[0].score > 0.45) text += scored[0].ch;
        });
        return text;
    }

    function chooseLetter(glyph, digitParts) {
        const scored = bestMatches(glyph, letterTemplates);
        if (!scored.length) return { ch: '', score: 0 };
        const best = scored[0];
        const digit = readDigit(digitParts);
        const value = /^\d+$/.test(digit) ? parseInt(digit, 10) : null;
        let digitAgreed = false;
        if (value !== null && value > 0) {
            const fitting = scored.filter((item) => POINTS[item.ch] === value);
            if (fitting.length && fitting[0].score >= best.score - 0.12) {
                digitAgreed = true;
                const chosen = fitting[0];
                const runner = scored.find((item) => item.ch !== chosen.ch);
                return {
                    ch: chosen.ch,
                    score: chosen.score,
                    unsure: chosen.score < UNSURE_SCORE || (runner && chosen.score - runner.score < 0.08 && POINTS[runner.ch] !== value)
                };
            }
        }
        const runner = scored[1];
        const unsure = best.score < UNSURE_SCORE || (runner && best.score - runner.score < 0.08 && POINTS[best.ch] !== POINTS[runner.ch] && !digitAgreed);
        return { ch: best.ch, score: best.score, unsure };
    }

    function cellBox(x0, y0, pitch, row, col) {
        const inset = pitch * 0.1;
        return {
            x1: Math.round(x0 + col * pitch + inset),
            y1: Math.round(y0 + row * pitch + inset),
            x2: Math.round(x0 + (col + 1) * pitch - inset),
            y2: Math.round(y0 + (row + 1) * pitch - inset)
        };
    }

    function readBoard(image, x0, y0, pitch) {
        const board = [];
        const confidence = [];
        const unsure = [];
        for (let row = 0; row < 15; row++) {
            board.push([]);
            confidence.push([]);
            for (let col = 0; col < 15; col++) {
                const box = cellBox(x0, y0, pitch, row, col);
                if (!isTileCrop(image.data, image.width, box.x1, box.y1, box.x2, box.y2)) {
                    board[row].push('');
                    confidence[row].push(1);
                    continue;
                }
                const glyphs = glyphsFromCrop(image.data, image.width, box.x1, box.y1, box.x2, box.y2);
                if (!glyphs) {
                    board[row].push('');
                    confidence[row].push(0.4);
                    unsure.push({ row, col });
                    continue;
                }
                const chosen = chooseLetter(glyphs.letter, glyphs.digits);
                board[row].push(chosen.ch);
                confidence[row].push(chosen.score);
                if (chosen.unsure) unsure.push({ row, col, glyph: glyphs });
            }
        }
        return { board, confidence, unsure };
    }

    function readRack(image, top) {
        const rack = [];
        const confidence = [];
        const width = image.width;
        const height = image.height;
        const data = image.data;
        if (top >= height - 10) return { rack: ['', '', '', '', '', '', ''], confidence: [0, 0, 0, 0, 0, 0, 0] };
        const colCount = new Int32Array(width);
        for (let y = top; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const i = (y * width + x) * 4;
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                if (b > 130 && b > r + 35 && b > g + 15) colCount[x]++;
            }
        }
        const runs = [];
        let start = -1;
        for (let x = 0; x <= width; x++) {
            const on = x < width && colCount[x] > 30;
            if (on && start < 0) start = x;
            if (!on && start >= 0) {
                if (x - start > 40) runs.push([start, x - 1]);
                start = -1;
            }
        }
        const tiles = [];
        runs.forEach(([x1, x2]) => {
            const mid = Math.floor((x1 + x2) / 2);
            let y1 = -1;
            let y2 = -1;
            for (let y = top; y < height; y++) {
                const i = (y * width + mid) * 4;
                const r = data[i];
                const g = data[i + 1];
                const b = data[i + 2];
                const blue = b > 130 && b > r + 35 && b > g + 15;
                if (blue && y1 < 0) y1 = y;
                if (blue) y2 = y;
            }
            if (y1 < 0 || y2 - y1 < 40) return;
            tiles.push({ x1, y1, x2, y2, w: x2 - x1 });
        });
        tiles.sort((a, b) => a.x1 - b.x1);
        const picked = tiles.length > 7 ? tiles.slice(0, 7) : tiles;
        for (let i = 0; i < 7; i++) {
            const tile = picked[i];
            if (!tile) {
                rack.push('');
                confidence.push(0);
                continue;
            }
            const glyphs = glyphsFromCrop(data, width, tile.x1 + 4, tile.y1 + 4, tile.x2 - 4, tile.y2 - 4);
            if (!glyphs) {
                rack.push('?');
                confidence.push(0.5);
                continue;
            }
            const chosen = chooseLetter(glyphs.letter, glyphs.digits);
            rack.push(chosen.ch || '?');
            confidence.push(chosen.score);
        }
        return { rack, confidence };
    }

    function analyze(image, forced) {
        loadTemplates();
        const white = new Uint8Array(image.width * image.height);
        for (let i = 0, p = 0; i < image.data.length; i += 4, p++) {
            const r = image.data[i];
            const g = image.data[i + 1];
            const b = image.data[i + 2];
            white[p] = r > 242 && g > 242 && b > 242 ? 1 : 0;
        }
        let x0;
        let y0;
        let pitch;
        let score = 0;
        if (forced) {
            x0 = Math.round(forced.x);
            y0 = Math.round(forced.y);
            pitch = forced.size / 15;
            score = 2;
        } else {
            pitch = pitchOf(white, image.width, image.height);
            if (!pitch) return { ok: false, message: 'No board found in that picture.' };
            const found = locate(white, image.width, image.height, pitch);
            if (!found || found.score < MIN_GRID_SCORE) {
                return { ok: false, score: found ? found.score : 0, message: 'The board was hard to find. Drag the box onto it.' };
            }
            x0 = found.x0;
            y0 = found.y0;
            score = found.score;
        }
        const read = readBoard(image, x0, y0, pitch);
        const rack = readRack(image, Math.round(y0 + 15 * pitch + pitch * 0.4));
        return {
            ok: true,
            score,
            x0,
            y0,
            pitch,
            board: read.board,
            confidence: read.confidence,
            unsure: read.unsure,
            rack: rack.rack,
            rackConfidence: rack.confidence
        };
    }

    async function fillUnsureWithTesseract(image, result) {
        const weak = (result.unsure || []).filter((cell) => cell.glyph && result.confidence[cell.row][cell.col] < 0.62);
        if (!weak.length) return result;
        try {
            const worker = await getTessWorker();
            for (let i = 0; i < weak.length; i++) {
                const cell = weak[i];
                const box = cellBox(result.x0, result.y0, result.pitch, cell.row, cell.col);
                const canvas = cropCanvas(image, box.x1, box.y1, box.x2, box.y2);
                const recognized = await worker.recognize(canvas);
                const letter = ((recognized.data && recognized.data.text) || '').toUpperCase().replace(/[^A-Z]/g, '').charAt(0);
                const tessScore = recognized.data ? recognized.data.confidence / 100 : 0;
                if (letter && tessScore > result.confidence[cell.row][cell.col]) {
                    result.board[cell.row][cell.col] = letter;
                    result.confidence[cell.row][cell.col] = Math.max(tessScore, 0.7);
                }
            }
        } catch (err) {
            // The template guess stays. The review grid shows the unsure cells.
        }
        return result;
    }

    function cropCanvas(image, x1, y1, x2, y2) {
        const canvas = document.createElement('canvas');
        const w = Math.max(1, x2 - x1);
        const h = Math.max(1, y2 - y1);
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        const src = document.createElement('canvas');
        src.width = image.width;
        src.height = image.height;
        src.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(image.data), image.width, image.height), 0, 0);
        ctx.drawImage(src, x1, y1, w, h, 0, 0, w, h);
        return canvas;
    }

    function loadScript(url) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = url;
            script.onload = resolve;
            script.onerror = reject;
            document.head.appendChild(script);
        });
    }

    async function getTessWorker() {
        if (tessWorker) return tessWorker;
        if (!window.Tesseract) {
            await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js');
        }
        tessWorker = await window.Tesseract.createWorker('eng', 1, {
            workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
            corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1/tesseract-core-simd-lstm.wasm.js',
            langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng@1.0.0/4.0.0'
        });
        await tessWorker.setParameters({
            tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
            tessedit_pageseg_mode: '10'
        });
        return tessWorker;
    }

    window.readCrossplayScreenshot = async function (img, forced) {
        const image = drawToCanvas(img);
        const result = analyze(image, forced);
        result.image = image;
        return result;
    };

    function openModal() {
        const modal = document.getElementById('shotModal');
        if (modal) modal.hidden = false;
    }

    function closeModal() {
        const modal = document.getElementById('shotModal');
        if (modal) modal.hidden = true;
        currentImage = null;
    }

    function setStatus(text) {
        const el = document.getElementById('shotStatus');
        if (el) el.textContent = text;
    }

    function showCropper(show) {
        const crop = document.getElementById('shotCrop');
        const review = document.getElementById('shotReview');
        if (crop) crop.hidden = !show;
        if (review) review.hidden = show;
        const apply = document.getElementById('shotApply');
        if (apply) apply.hidden = show;
        const adjust = document.getElementById('shotAdjust');
        if (adjust) adjust.hidden = show;
    }

    function renderReview(result) {
        const grid = document.getElementById('shotGrid');
        const rack = document.getElementById('shotRack');
        if (!grid || !rack) return;
        grid.innerHTML = '';
        for (let row = 0; row < 15; row++) {
            for (let col = 0; col < 15; col++) {
                const input = document.createElement('input');
                input.maxLength = 1;
                input.value = result.board[row][col] || '';
                input.dataset.row = String(row);
                input.dataset.col = String(col);
                input.setAttribute('aria-label', 'Row ' + (row + 1) + ' column ' + (col + 1));
                if ((result.confidence[row][col] || 0) < UNSURE_SCORE && result.board[row][col]) {
                    input.className = 'unsure';
                }
                input.addEventListener('input', () => {
                    input.value = input.value.toUpperCase().replace(/[^A-Z?]/g, '').slice(0, 1);
                    input.classList.remove('unsure');
                });
                grid.appendChild(input);
            }
        }
        rack.innerHTML = '';
        for (let i = 0; i < 7; i++) {
            const input = document.createElement('input');
            input.maxLength = 1;
            input.value = result.rack[i] || '';
            input.dataset.rack = String(i);
            input.setAttribute('aria-label', 'Rack tile ' + (i + 1));
            if ((result.rackConfidence[i] || 0) < UNSURE_SCORE && result.rack[i]) input.className = 'unsure';
            input.addEventListener('input', () => {
                input.value = input.value.toUpperCase().replace(/[^A-Z?]/g, '').slice(0, 1);
                input.classList.remove('unsure');
            });
            rack.appendChild(input);
        }
        const unsureCount = grid.querySelectorAll('.unsure').length + rack.querySelectorAll('.unsure').length;
        const rackEmpty = result.rack.every((ch) => !ch);
        let status = unsureCount
            ? 'Outlined letters are the unsure ones. Fix them, then apply. Read on this device.'
            : 'Read on this device. Fix any letter that looks wrong, then apply.';
        if (rackEmpty) status += ' The rack was not in this picture. Type your tiles.';
        setStatus(status);
        showCropper(false);
    }

    function readReview() {
        const board = [];
        for (let row = 0; row < 15; row++) {
            board.push([]);
            for (let col = 0; col < 15; col++) {
                const input = document.querySelector('#shotGrid input[data-row="' + row + '"][data-col="' + col + '"]');
                board[row].push(input && input.value ? input.value.toUpperCase() : '');
            }
        }
        const rack = [];
        for (let i = 0; i < 7; i++) {
            const input = document.querySelector('#shotRack input[data-rack="' + i + '"]');
            rack.push(input && input.value ? input.value.toUpperCase() : '');
        }
        return { board, rack };
    }

    function applyReview() {
        const read = readReview();
        if (typeof boardHasTiles === 'function' && boardHasTiles()) {
            const replace = confirm('Replace the letters on this board with the screenshot?');
            if (!replace) return;
        }
        const select = document.getElementById('gameSelect');
        if (select && select.value !== 'crossplay') {
            select.value = 'crossplay';
            if (typeof changeGame === 'function') changeGame();
        }
        window.boardState = read.board.map((row) => row.map((ch) => (ch && ch !== '?' ? ch : null)));
        if (typeof applySavedBoard === 'function') applySavedBoard();
        if (typeof saveBoardState === 'function') saveBoardState();
        if (typeof setPlayerTiles === 'function') setPlayerTiles(read.rack);
        if (typeof savePlayerTiles === 'function') savePlayerTiles();
        const results = document.getElementById('results');
        if (results) results.innerHTML = '';
        const meta = document.getElementById('resultsMeta');
        if (meta) meta.textContent = '';
        closeModal();
    }

    function defaultCrop(img) {
        const w = img.naturalWidth || img.width;
        const h = img.naturalHeight || img.height;
        const size = Math.round(Math.min(w, h) * 0.86);
        return {
            x: Math.round((w - size) / 2),
            y: Math.round(Math.max(0, h * 0.18)),
            size
        };
    }

    function drawCrop() {
        const canvas = document.getElementById('shotCanvas');
        if (!canvas || !currentImage || !cropRect) return;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(currentImage, 0, 0, canvas.width, canvas.height);
        const scale = canvas.width / (currentImage.naturalWidth || currentImage.width);
        ctx.strokeStyle = '#2b6fd9';
        ctx.lineWidth = 3;
        ctx.strokeRect(cropRect.x * scale, cropRect.y * scale, cropRect.size * scale, cropRect.size * scale);
    }

    function mountCropper(img) {
        const canvas = document.getElementById('shotCanvas');
        if (!canvas) return;
        const nw = img.naturalWidth || img.width;
        const nh = img.naturalHeight || img.height;
        const scale = Math.min(1, 420 / nw);
        canvas.width = Math.max(1, Math.round(nw * scale));
        canvas.height = Math.max(1, Math.round(nh * scale));
        if (!cropRect) cropRect = defaultCrop(img);
        drawCrop();
    }

    function canvasPoint(event) {
        const canvas = document.getElementById('shotCanvas');
        const bounds = canvas.getBoundingClientRect();
        const nx = (currentImage.naturalWidth || currentImage.width);
        const scale = nx / bounds.width;
        return {
            x: (event.clientX - bounds.left) * scale,
            y: (event.clientY - bounds.top) * scale
        };
    }

    function onCropPointerDown(event) {
        if (!cropRect || !currentImage) return;
        const point = canvasPoint(event);
        const margin = Math.max(18, cropRect.size * 0.08);
        const nearLeft = Math.abs(point.x - cropRect.x) < margin;
        const nearRight = Math.abs(point.x - (cropRect.x + cropRect.size)) < margin;
        const nearTop = Math.abs(point.y - cropRect.y) < margin;
        const nearBottom = Math.abs(point.y - (cropRect.y + cropRect.size)) < margin;
        let mode = 'move';
        if (nearLeft || nearRight || nearTop || nearBottom) mode = 'resize';
        cropDrag = { mode, dx: point.x - cropRect.x, dy: point.y - cropRect.y, edgeX: nearRight ? 'r' : 'l', edgeY: nearBottom ? 'b' : 't' };
        event.preventDefault();
    }

    function onCropPointerMove(event) {
        if (!cropDrag || !cropRect || !currentImage) return;
        const point = canvasPoint(event);
        const nw = currentImage.naturalWidth || currentImage.width;
        const nh = currentImage.naturalHeight || currentImage.height;
        if (cropDrag.mode === 'move') {
            cropRect.x = Math.round(Math.max(0, Math.min(nw - cropRect.size, point.x - cropDrag.dx)));
            cropRect.y = Math.round(Math.max(0, Math.min(nh - cropRect.size, point.y - cropDrag.dy)));
        } else {
            const left = cropDrag.edgeX === 'l' ? point.x : cropRect.x;
            const top = cropDrag.edgeY === 't' ? point.y : cropRect.y;
            const right = cropDrag.edgeX === 'r' ? point.x : cropRect.x + cropRect.size;
            const bottom = cropDrag.edgeY === 'b' ? point.y : cropRect.y + cropRect.size;
            const size = Math.max(80, Math.min(right - left, bottom - top, nw, nh));
            cropRect.size = Math.round(size);
            cropRect.x = Math.round(Math.max(0, Math.min(left, nw - size)));
            cropRect.y = Math.round(Math.max(0, Math.min(top, nh - size)));
        }
        drawCrop();
    }

    function onCropPointerUp() {
        cropDrag = null;
    }

    async function runRead(forced) {
        if (!currentImage) return;
        setStatus('Reading the board…');
        showCropper(false);
        await new Promise((resolve) => setTimeout(resolve, 30));
        const result = await window.readCrossplayScreenshot(currentImage, forced);
        if (!result.ok) {
            setStatus(result.message || 'The board was hard to find. Drag the box onto it.');
            showCropper(true);
            mountCropper(currentImage);
            return;
        }
        renderReview(result);
        const weak = (result.unsure || []).filter((cell) => result.confidence[cell.row][cell.col] < 0.62);
        if (weak.length) {
            setStatus('Checking ' + weak.length + ' unsure tiles…');
            fillUnsureWithTesseract(result.image, result).then(() => {
                if (!document.getElementById('shotModal') || document.getElementById('shotModal').hidden) return;
                renderReview(result);
            });
        }
    }

    function useFile(file) {
        if (!file || !file.type || file.type.indexOf('image/') !== 0) return;
        const url = URL.createObjectURL(file);
        const img = new Image();
        img.onload = () => {
            URL.revokeObjectURL(url);
            currentImage = img;
            cropRect = null;
            openModal();
            runRead(null);
        };
        img.onerror = () => {
            URL.revokeObjectURL(url);
            setStatus('That picture could not be opened.');
            openModal();
        };
        img.src = url;
    }

    function init() {
        const button = document.getElementById('uploadShotBtn');
        const input = document.getElementById('shotFile');
        if (!button || !input) return;
        button.addEventListener('click', () => input.click());
        input.addEventListener('change', () => {
            const file = input.files && input.files[0];
            input.value = '';
            useFile(file);
        });
        document.addEventListener('paste', (event) => {
            const target = event.target;
            if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
            const items = event.clipboardData && event.clipboardData.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                if (items[i].type.indexOf('image/') === 0) {
                    useFile(items[i].getAsFile());
                    event.preventDefault();
                    return;
                }
            }
        });
        const board = document.getElementById('board');
        if (board) {
            board.addEventListener('dragover', (event) => event.preventDefault());
            board.addEventListener('drop', (event) => {
                event.preventDefault();
                const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
                useFile(file);
            });
        }
        const strip = document.getElementById('uploadStrip');
        if (strip) {
            strip.addEventListener('click', (event) => {
                if (event.target.closest('#uploadShotBtn')) return;
                input.click();
            });
            strip.addEventListener('dragover', (event) => {
                event.preventDefault();
                strip.classList.add('drag');
            });
            strip.addEventListener('dragleave', (event) => {
                if (event.relatedTarget && strip.contains(event.relatedTarget)) return;
                strip.classList.remove('drag');
            });
            strip.addEventListener('drop', (event) => {
                event.preventDefault();
                strip.classList.remove('drag');
                const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
                useFile(file);
            });
        }
        const cancel = document.getElementById('shotCancel');
        if (cancel) cancel.addEventListener('click', closeModal);
        const apply = document.getElementById('shotApply');
        if (apply) apply.addEventListener('click', applyReview);
        const adjust = document.getElementById('shotAdjust');
        if (adjust) {
            adjust.addEventListener('click', () => {
                if (!currentImage) return;
                showCropper(true);
                mountCropper(currentImage);
                setStatus('Drag the box onto the board. Drag an edge to resize it.');
            });
        }
        const reread = document.getElementById('shotReread');
        if (reread) {
            reread.addEventListener('click', () => {
                if (cropRect) runRead({ x: cropRect.x, y: cropRect.y, size: cropRect.size });
            });
        }
        const canvas = document.getElementById('shotCanvas');
        if (canvas) {
            canvas.addEventListener('pointerdown', onCropPointerDown);
            window.addEventListener('pointermove', onCropPointerMove);
            window.addEventListener('pointerup', onCropPointerUp);
        }
        const modal = document.getElementById('shotModal');
        if (modal) {
            modal.addEventListener('click', (event) => {
                if (event.target === modal) closeModal();
            });
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
