// Example preload: MIDI helpers
// Usage: http://localhost:5173/?preload=example.js
//
// Hydra editor example:
//   osc(() => cc(1) * 60).color(cc(2), cc(3), cc(4)).out(o0)

// CC value (0.0 - 1.0)
cc = (n) => () => midi.cc[n]

// CC value mapped to custom range
ccRange = (n, min, max) => () => midi.cc[n] * (max - min) + min

// Note velocity (0.0 - 1.0), useful as trigger/envelope
noteOn = (n) => () => midi.note[n]

// Any active note count (0.0 - 1.0 clamped)
noteAny = () => () => Math.min(midi.activeNotes.size, 1)

// Pitch bend (-1.0 - 1.0)
bend = () => () => midi.pitch

console.log('[preload] MIDI helpers loaded: cc, ccRange, noteOn, noteAny, bend')
