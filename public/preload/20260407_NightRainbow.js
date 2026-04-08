// Preload: AKAI MidiMix mapping for nightrainbow
// Usage: http://localhost:5173/?preload=20260407_NightRainbow.js
//
// Getters (参照するたびに現在値を返す):
//   knob11 .. knob83, fader1 .. fader8, master
//
// Functions (数値を返す、() => で包んでHydraに渡す):
//   btnM1..8 (Mute) — momentary:
//     btnM1()           → 1.0 while held
//     btnM1(decay)      → 1.0→0.0 over decay ms on press
//     btnM1(decay, amt) → amt→0.0
//     btnM1Up(decay)    → trigger on release
//   btnR1..4 (Rec) — per-channel loop toggle:
//     btnR押下 → そのカラムのknob*1,*2 / fader / btnMをクオンタイズループ
//     再押下 → そのチャンネルのループ停止
//   btnR5..8 (Rec) — plain toggle (0/1, decay対応)
//   knob*3 (row3, ch1-4) — loop length: 1/2/4/8 bars
//   note 26 — MIDIスナップショット記録
//   SOLO (note 27) — 全ループ停止
//
// Example:
//   osc(20).rotate(() => fader1 * .5)
//     .add(solid(1), () => btnM1(200) * 0.8)
//     .out()

// --- CC map ---
_knobCC = [[16, 20, 24, 28, 46, 50, 54, 58],
[17, 21, 25, 29, 47, 51, 55, 59],
[18, 22, 26, 30, 48, 52, 56, 60]]
_faderCC = [19, 23, 27, 31, 49, 53, 57, 61]
_muteNotes = [1, 4, 7, 10, 13, 16, 19, 22]
_recNotes = [3, 6, 9, 12, 15, 18, 21, 24]

// --- Button state tracking ---
_btnPrev = new Array(128).fill(0)
_btnPressT = new Array(128).fill(-Infinity)
_btnReleaseT = new Array(128).fill(-Infinity)
_btnLastPoll = new Array(128).fill(0)
_toggleState = new Array(128).fill(0)
_toggleOnT = new Array(128).fill(-Infinity)
_toggleOffT = new Array(128).fill(-Infinity)

_pollBtn = (n) => {
    const now = performance.now()
    if (now - _btnLastPoll[n] < 1) return
    _btnLastPoll[n] = now
    const curr = midi.note[n] > 0 ? 1 : 0
    const prev = _btnPrev[n]
    if (curr && !prev) {
        _btnPressT[n] = now
        // toggle: flip on press
        _toggleState[n] = 1 - _toggleState[n]
        if (_toggleState[n]) _toggleOnT[n] = now
        else _toggleOffT[n] = now
    }
    if (!curr && prev) _btnReleaseT[n] = now
    _btnPrev[n] = curr
}

// --- Knobs / Faders → getter ---
// knob_0_0 .. knob_7_2, fader_0 .. fader_7, master
_defGet = (name, fn) => Object.defineProperty(window, name, { get: fn, configurable: true })

_knobCC.forEach((row, r) =>
    row.forEach((ccNum, c) =>
        _defGet(`knob${c + 1}${r + 1}`, () => midi.cc[ccNum])))

_faderCC.forEach((ccNum, i) =>
    _defGet(`fader${i + 1}`, () => midi.cc[ccNum]))

_defGet('master', () => midi.cc[62])

// --- Buttons (直接数値を返す) ---
btnMute = (col, decay, amount = 1) => {
    const n = _muteNotes[col - 1]; _pollBtn(n)
    if (decay == null) return midi.note[n] > 0 ? 1 : 0
    return Math.max(0, amount * (1 - (performance.now() - _btnPressT[n]) / decay))
}
// btnRec: toggle — 押すたびにON/OFF切り替え
btnRec = (col, decay, amount = 1) => {
    const n = _recNotes[col - 1]; _pollBtn(n)
    if (decay == null) return _toggleState[n]
    // decayあり: ON/OFFになった瞬間からの減衰
    if (_toggleState[n]) {
        return Math.max(0, amount * (1 - (performance.now() - _toggleOnT[n]) / decay))
    } else {
        return 0
    }
}
btnMuteUp = (col, decay = 200, amount = 1) => {
    const n = _muteNotes[col - 1]; _pollBtn(n)
    return Math.max(0, amount * (1 - (performance.now() - _btnReleaseT[n]) / decay))
}
// btnRecUp: トグルがOFFになった瞬間のトリガー
btnRecUp = (col, decay = 200, amount = 1) => {
    const n = _recNotes[col - 1]; _pollBtn(n)
    return Math.max(0, amount * (1 - (performance.now() - _toggleOffT[n]) / decay))
}

// --- Shortcuts: btnM1(decay?, amount?) / btnR1(decay?, amount?) ---
for (let i = 1; i <= 8; i++) {
    window[`btnM${i}`] = (decay, amount) => btnMute(i, decay, amount)
    window[`btnM${i}Up`] = (decay, amount) => btnMuteUp(i, decay, amount)
    window[`btnR${i}`] = (decay, amount) => btnRec(i, decay, amount)
    window[`btnR${i}Up`] = (decay, amount) => btnRecUp(i, decay, amount)
}

// --- Toast (左下に一時表示) ---
_toastEl = null
_toastTimer = null
_toast = (msg, ms = 1500) => {
    if (!_toastEl) {
        _toastEl = document.createElement('div')
        _toastEl.id = '_midi-toast'
        Object.assign(_toastEl.style, {
            position: 'fixed', bottom: '28px', left: '10px', zIndex: 10,
            color: 'rgba(255,255,255,.8)', fontFamily: 'monospace', fontSize: '10px',
            pointerEvents: 'none', transition: 'opacity 0.3s', opacity: '0'
        })
    }
    // chooのre-renderでDOMから外れた場合に再追加
    if (!_toastEl.parentNode) document.body.appendChild(_toastEl)
    _toastEl.textContent = msg
    _toastEl.style.opacity = '0.8'
    clearTimeout(_toastTimer)
    _toastTimer = setTimeout(() => { _toastEl.style.opacity = '0' }, ms)
}

_loopChCount = 4 // ch1-4 only

// --- Loop Indicator (円形プログレス) ---
_loopIndicatorEl = null
_loopIndicatorSvgs = []

_initLoopIndicator = () => {
    _loopIndicatorEl = document.createElement('div')
    _loopIndicatorEl.id = '_loop-indicator'
    Object.assign(_loopIndicatorEl.style, {
        position: 'fixed', bottom: '44px', left: '10px', zIndex: 10,
        display: 'flex', gap: '4px', pointerEvents: 'none'
    })
    const r = 9, stroke = 2, size = (r + stroke) * 2
    const circumference = 2 * Math.PI * r
    for (let i = 0; i < _loopChCount; i++) {
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
        svg.setAttribute('width', size)
        svg.setAttribute('height', size)
        svg.innerHTML = `
            <circle cx="${r + stroke}" cy="${r + stroke}" r="${r}"
                fill="none" stroke="rgba(255,255,255,.1)" stroke-width="${stroke}"/>
            <circle cx="${r + stroke}" cy="${r + stroke}" r="${r}"
                fill="none" stroke="rgba(255,255,255,.1)" stroke-width="${stroke}"
                stroke-dasharray="${circumference}" stroke-dashoffset="${circumference}"
                stroke-linecap="round" transform="rotate(-90 ${r + stroke} ${r + stroke})"/>
            <text x="${r + stroke}" y="${r + stroke}" text-anchor="middle" dominant-baseline="central"
                fill="rgba(255,255,255,.2)" font-family="monospace" font-size="7"></text>
        `
        _loopIndicatorSvgs.push({
            el: svg,
            progress: svg.querySelectorAll('circle')[1],
            text: svg.querySelector('text'),
            circumference
        })
        _loopIndicatorEl.appendChild(svg)
    }
}
_initLoopIndicator()

_updateLoopIndicator = () => {
    if (!_loopIndicatorEl) return
    if (!_loopIndicatorEl.parentNode) document.body.appendChild(_loopIndicatorEl)
    const now = performance.now()
    for (let i = 0; i < _loopChCount; i++) {
        const loop = midi._loops && midi._loops.get(`ch${i + 1}`)
        const ind = _loopIndicatorSvgs[i]
        const bars = _getLoopBars(i)
        ind.text.textContent = bars
        if (loop && loop.startTime) {
            const elapsed = (now - loop.startTime) % loop.durationMs
            const ratio = elapsed / loop.durationMs
            ind.progress.setAttribute('stroke-dashoffset',
                ind.circumference * (1 - ratio))
            ind.progress.setAttribute('stroke', 'rgba(255,255,255,.7)')
            ind.text.setAttribute('fill', 'rgba(255,255,255,.8)')
        } else {
            ind.progress.setAttribute('stroke-dashoffset', ind.circumference)
            ind.progress.setAttribute('stroke', 'rgba(255,255,255,.1)')
            ind.text.setAttribute('fill', 'rgba(255,255,255,.25)')
        }
    }
}

// --- MIDI Looper (per-channel, quantized) ---
// btnR1..4: loop toggle (per-column knobs/fader/mute)
// btnR5..8: plain toggle (original behavior, usable in Hydra code)
// knob*3 (row 3, ch1-4): loop length selector — 1/2/4/8 bars
// note 26: MIDI snapshot, note 27 (SOLO): all-loop stop

_loopBarChoices = [1, 2, 4, 8]
_loopExcludeNotes = [..._recNotes, 26, 27] // Rec buttons + snapshot + SOLO never looped

// Per-column config (ch1-4 only)
_loopCols = []
for (let i = 0; i < _loopChCount; i++) {
    _loopCols.push({
        includeCCs: [_knobCC[0][i], _knobCC[1][i], _faderCC[i]],
        includeNotes: [_muteNotes[i]],
        lengthCC: _knobCC[2][i]
    })
}

_loopPrevToggle = new Array(128).fill(0)
_loopKillPrev = 0

_getLoopBars = (col) => {
    const cc = _loopCols[col].lengthCC
    const val = midi.cc[cc]
    const idx = Math.min(Math.floor(val * _loopBarChoices.length), _loopBarChoices.length - 1)
    return _loopBarChoices[idx]
}

_snapshotPrev = 0

_pollLoop = () => {
    _updateLoopIndicator()

    if (midi._isPlayback) return

    // note 26 → MIDI snapshot
    const snap = midi.note[26] > 0 ? 1 : 0
    if (snap && !_snapshotPrev) {
        try { midiSnapshot() } catch (e) { console.warn('[snapshot]', e) }
        _toast('MIDI snapshot')
    }
    _snapshotPrev = snap

    // All-stop on note 27 (SOLO)
    const kill = midi.note[27] > 0 ? 1 : 0
    if (kill && !_loopKillPrev) {
        midi.stopLoop()
        for (let i = 0; i < _loopChCount; i++) {
            const n = _recNotes[i]
            _toggleState[n] = 0
            _loopPrevToggle[n] = 0
        }
    }
    _loopKillPrev = kill

    // btnR1..4 → loop toggle
    for (let i = 0; i < _loopChCount; i++) {
        const n = _recNotes[i]
        _pollBtn(n)
        const curr = _toggleState[n]
        if (curr !== _loopPrevToggle[n]) {
            _loopPrevToggle[n] = curr
            if (curr) {
                const col = _loopCols[i]
                const bars = _getLoopBars(i)
                midi.loop(`ch${i + 1}`, {
                    bars,
                    includeCCs: col.includeCCs,
                    includeNotes: col.includeNotes,
                    excludeNotes: _loopExcludeNotes,
                    quantize: true
                })
            } else {
                midi.stopLoop(`ch${i + 1}`)
            }
        }
    }

    // btnR5..8 → just poll toggle state (no loop, available via btnR5() etc.)
    for (let i = _loopChCount; i < 8; i++) {
        _pollBtn(_recNotes[i])
    }
}

;(function _loopRAF() { _pollLoop(); requestAnimationFrame(_loopRAF) })()

console.log('[preload] AKAI MidiMix: btnR1-4=loop, btnR5-8=toggle, knob*3(1-4)=loop length, note26=snapshot, SOLO=all stop')
