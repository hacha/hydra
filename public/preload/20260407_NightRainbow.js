// Preload: AKAI MidiMix mapping for nightrainbow
// Usage: http://localhost:5173/?preload=20260407_NightRainbow.js
//
// Getters (参照するたびに現在値を返す):
//   knob11 .. knob83, fader1 .. fader8, master
//
// Functions (数値を返す、() => で包んでHydraに渡す):
//   btnMute(col)                  → 1.0 while held
//   btnMute(col, decay)           → 1.0→0.0 over decay ms
//   btnMute(col, decay, amount)   → amount→0.0 over decay ms
//   btnRec(col, ...)              → same for rec row
//   btnMuteUp(col, decay, amount) → trigger on release
//   btnRecUp(col, decay, amount)  → trigger on release
//
// Example:
//   osc(20).rotate(() => fader1 * .5)
//     .add(solid(1), () => btnMute(1, 200) * 0.8)
//     .out()

// --- CC map ---
_knobCC = [[16,20,24,28,46,50,54,58],
           [17,21,25,29,47,51,55,59],
           [18,22,26,30,48,52,56,60]]
_faderCC = [19,23,27,31,49,53,57,61]
_muteNotes = [1, 4, 7, 10, 13, 16, 19, 22]
_recNotes  = [3, 6, 9, 12, 15, 18, 21, 24]

// --- Button state tracking ---
_btnPrev = new Array(128).fill(0)
_btnPressT = new Array(128).fill(-Infinity)
_btnReleaseT = new Array(128).fill(-Infinity)
_btnLastPoll = new Array(128).fill(0)

_pollBtn = (n) => {
    const now = performance.now()
    if (now - _btnLastPoll[n] < 1) return
    _btnLastPoll[n] = now
    const curr = midi.note[n] > 0 ? 1 : 0
    const prev = _btnPrev[n]
    if (curr && !prev) _btnPressT[n] = now
    if (!curr && prev) _btnReleaseT[n] = now
    _btnPrev[n] = curr
}

// --- Knobs / Faders → getter ---
// knob_0_0 .. knob_7_2, fader_0 .. fader_7, master
_defGet = (name, fn) => Object.defineProperty(window, name, { get: fn, configurable: true })

_knobCC.forEach((row, r) =>
    row.forEach((ccNum, c) =>
        _defGet(`knob${c+1}${r+1}`, () => midi.cc[ccNum])))

_faderCC.forEach((ccNum, i) =>
    _defGet(`fader${i+1}`, () => midi.cc[ccNum]))

_defGet('master', () => midi.cc[62])

// --- Buttons (直接数値を返す) ---
btnMute = (col, decay, amount = 1) => {
    const n = _muteNotes[col-1]; _pollBtn(n)
    if (decay == null) return midi.note[n] > 0 ? 1 : 0
    return Math.max(0, amount * (1 - (performance.now() - _btnPressT[n]) / decay))
}
btnRec = (col, decay, amount = 1) => {
    const n = _recNotes[col-1]; _pollBtn(n)
    if (decay == null) return midi.note[n] > 0 ? 1 : 0
    return Math.max(0, amount * (1 - (performance.now() - _btnPressT[n]) / decay))
}
btnMuteUp = (col, decay = 200, amount = 1) => {
    const n = _muteNotes[col-1]; _pollBtn(n)
    return Math.max(0, amount * (1 - (performance.now() - _btnReleaseT[n]) / decay))
}
btnRecUp = (col, decay = 200, amount = 1) => {
    const n = _recNotes[col-1]; _pollBtn(n)
    return Math.max(0, amount * (1 - (performance.now() - _btnReleaseT[n]) / decay))
}

// --- Shortcuts: btnM1(decay?, amount?) / btnR1(decay?, amount?) ---
for (let i = 1; i <= 8; i++) {
    window[`btnM${i}`] = (decay, amount) => btnMute(i, decay, amount)
    window[`btnR${i}`] = (decay, amount) => btnRec(i, decay, amount)
    window[`btnM${i}Up`] = (decay, amount) => btnMuteUp(i, decay, amount)
    window[`btnR${i}Up`] = (decay, amount) => btnRecUp(i, decay, amount)
}

console.log('[preload] AKAI MidiMix: knob11..knob83, fader1..8, master, btnM1..8(decay?,amt?), btnR1..8(decay?,amt?)')
