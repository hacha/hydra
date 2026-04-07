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
//   btnR1..8 (Rec) — per-channel loop toggle:
//     btnR押下 → そのカラムのknob*1,*2 / fader / btnMをクオンタイズループ
//     再押下 → そのチャンネルのループ停止
//   knob*3 (row3) — loop length: 1/2/4/8/16/32 bars
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
        Object.assign(_toastEl.style, {
            position: 'fixed', bottom: '28px', left: '10px', zIndex: 10,
            color: 'rgba(255,255,255,.8)', fontFamily: 'monospace', fontSize: '10px',
            pointerEvents: 'none', transition: 'opacity 0.3s', opacity: '0'
        })
        document.body.appendChild(_toastEl)
    }
    _toastEl.textContent = msg
    _toastEl.style.opacity = '0.8'
    clearTimeout(_toastTimer)
    _toastTimer = setTimeout(() => { _toastEl.style.opacity = '0' }, ms)
}

// --- MIDI Looper (per-channel, quantized) ---
// btnR1..8: toggle ON → loop that column's knobs/fader/mute, OFF → stop
// knob*3 (row 3): loop length selector — 1/2/4/8/16/32 bars
// SOLO (note 27): all-stop
//
// Column N records: knobN1 (row1 CC), knobN2 (row2 CC), btnMN (mute note), faderN (CC)
// knobN3 (row3 CC) is NOT recorded — it controls loop length

_loopBarChoices = [1, 2, 4, 8]
_loopExcludeNotes = [..._recNotes, 27] // Rec buttons + SOLO never looped

// Per-column config: { includeCCs, includeNotes, lengthCC }
_loopCols = []
for (let i = 0; i < 8; i++) {
    _loopCols.push({
        includeCCs: [_knobCC[0][i], _knobCC[1][i], _faderCC[i]], // knob row1, row2, fader
        includeNotes: [_muteNotes[i]],                            // mute button
        lengthCC: _knobCC[2][i]                                   // knob row3 = length selector
    })
}

_loopPrevToggle = new Array(128).fill(0)
_loopKillPrev = 0

_loopLastBars = new Array(8).fill(-1) // track per-column to detect change

_getLoopBars = (col) => {
    const cc = _loopCols[col].lengthCC
    const val = midi.cc[cc] // 0-1
    const idx = Math.min(Math.floor(val * _loopBarChoices.length), _loopBarChoices.length - 1)
    return _loopBarChoices[idx]
}

_pollLoopLength = () => {
    for (let i = 0; i < 8; i++) {
        const bars = _getLoopBars(i)
        if (bars !== _loopLastBars[i]) {
            _loopLastBars[i] = bars
            if (midi.cc[_loopCols[i].lengthCC] > 0) { // only show after knob is touched
                _toast(`ch${i + 1} loop: ${bars} bar`)
            }
        }
    }
}

_snapshotPrev = 0

_pollLoop = () => {
    // 再生中はloop操作をスキップ（MIDI値はスナップショットから再生される）
    if (midi._isPlayback) return

    // note 26 → MIDI snapshot
    const snap = midi.note[26] > 0 ? 1 : 0
    if (snap && !_snapshotPrev) {
        try { midiSnapshot() } catch (e) { console.warn('[snapshot]', e) }
        _toast('MIDI snapshot')
    }
    _snapshotPrev = snap

    _pollLoopLength()

    // All-stop on note 27 (SOLO)
    const kill = midi.note[27] > 0 ? 1 : 0
    if (kill && !_loopKillPrev) {
        midi.stopLoop()
        for (const n of _recNotes) {
            _toggleState[n] = 0
            _loopPrevToggle[n] = 0
        }
        _toast('LOOP ALL STOP')
    }
    _loopKillPrev = kill

    for (let i = 0; i < 8; i++) {
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
                _toast(`ch${i + 1} LOOP ${bars} bar`)
            } else {
                midi.stopLoop(`ch${i + 1}`)
                _toast(`ch${i + 1} STOP`)
            }
        }
    }
}

    // Poll loop toggles every frame
    ; (function _loopRAF() { _pollLoop(); requestAnimationFrame(_loopRAF) })()

console.log('[preload] AKAI MidiMix: knob*3=loop length (1/2/4/8/16/32 bar), btnR1..8=per-channel loop (quantized), SOLO=all stop')
