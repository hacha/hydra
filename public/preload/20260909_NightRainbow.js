// Preload: InstaChord mapping for nightrainbow
// InstaChord (Melody演奏モード / Key=C) を MIDIコントローラとして使う
// Usage: http://localhost:5173/?preload=20260909_NightRainbow
//
// 中央のボタン7個 x 弦3本 = 21音を ic<ボタン><弦> で参照する。
// ボタン1..7 = C2から始まるCメジャースケール、弦0..2 = +0 / +12 / +24 半音。
//
//   ic10=36 ic11=48 ic12=60   (C)     ic50=43 ic51=55 ic52=67   (G)
//   ic20=38 ic21=50 ic22=62   (D)     ic60=45 ic61=57 ic62=69   (A)
//   ic30=40 ic31=52 ic32=64   (E)     ic70=47 ic71=59 ic72=71   (B)
//   ic40=41 ic41=53 ic42=65   (F)
//
// --- 使い方 (すべて関数。Hydraには () => で包んで渡す) ---
//   ic10()            押されている間 1
//   ic10(200)         押した瞬間から200msで 1→0 に減衰
//   ic10(200, 0.5)    0.5→0 に減衰
//   ic10Up(200)       離した瞬間から減衰
//   ic10T()           トグル 0/1 (押すたび反転)
//   ic10T(200)        トグルを200msかけて滑らかに切り替える (ONで0→1、OFFで1→0)
//
//   icNotes()         21音のフラット配列。midi.loop('mel', { includeNotes: icNotes() }) に使える
//
// ゲート(引数なし)は midi.note[] を読むだけだが、減衰とトグルは押した瞬間が要るので
// MIDIイベントをフックしている。ハード入力はポート、midi.loop再生とセッション再生は
// midi._replayEvent を経由するため、両方に仕掛けて同じ挙動になるようにしてある。
//
// Example:
//   osc(20, 0.1)
//     .rotate(() => ic10T() * 0.5)
//     .add(solid(1,1,1), () => ic72(150) * 0.8)
//     .out(o0)

// hydra 側の window.midi が用意されるまで待つ
for (let i = 0; i < 100 && !window.midi; i++) await new Promise(r => setTimeout(r, 50))
if (!window.midi) {
  console.error('[instachord] window.midi が見つかりません。MIDI初期化を確認してください。')
  return
}

_IC_BASE = 36                             // 左下ボタンの一番下の弦 = C2
_IC_STEPS = [0, 2, 4, 5, 7, 9, 11]        // Cメジャー: ボタン1..7
_icNoteOf = (b, s) => _IC_BASE + _IC_STEPS[b - 1] + s * 12

icNotes = () => _IC_STEPS.flatMap(step => [0, 12, 24].map(o => _IC_BASE + step + o))

// --- 状態 ---
_icOnT = new Array(128).fill(-Infinity)   // ノートONの時刻
_icUpT = new Array(128).fill(-Infinity)   // ノートOFFの時刻
_icToggle = new Array(128).fill(0)
_icToggleT = new Array(128).fill(-Infinity)   // トグルが切り替わった時刻
_icToggleT0 = new Array(128).fill(-Infinity)  // その1回前の切り替え時刻 (ランプの連続性用)

_icOurNotes = new Set(icNotes())

_icEvent = (status, d1, d2) => {
  const cmd = status >> 4
  if (!_icOurNotes.has(d1)) return
  if (cmd === 9 && d2 > 0) {
    const t = performance.now()
    _icOnT[d1] = t
    _icToggle[d1] = 1 - _icToggle[d1]
    _icToggleT0[d1] = _icToggleT[d1]
    _icToggleT[d1] = t
  } else if (cmd === 8 || (cmd === 9 && d2 === 0)) {
    _icUpT[d1] = performance.now()
  }
}

// ハード入力: MidiInput は生成時にbind済みハンドラをポートへ登録しているので
// メソッド差し替えでは捕まえられない。ポートに自前リスナーを足す。
if (window.__icPortHandler) {
  midi.inputs.forEach(inp => inp.removeEventListener('midimessage', window.__icPortHandler))
}
window.__icPortHandler = (e) => _icEvent(e.data[0], e.data[1], e.data[2])
_icAttachPorts = () => midi.inputs.forEach(inp => {
  inp.removeEventListener('midimessage', window.__icPortHandler)
  inp.addEventListener('midimessage', window.__icPortHandler)
})
_icAttachPorts()
if (!window.__icStateChangeHooked && midi.midiAccess) {
  window.__icStateChangeHooked = true
  midi.midiAccess.addEventListener('statechange', () => setTimeout(_icAttachPorts, 100))
}

// ルーパー / セッション再生は midi._replayEvent を通るのでラップする
if (!window.__icReplayPatched) {
  window.__icReplayPatched = true
  window.__icOrigReplay = midi._replayEvent.bind(midi)
  midi._replayEvent = (status, d1, d2) => {
    window.__icOrigReplay(status, d1, d2)
    _icEvent(status, d1, d2)
  }
}

// --- アクセサ生成 ---
_icDecay = (fromT, decay, amount) =>
  Math.max(0, amount * (1 - (performance.now() - fromT) / decay))

_icClamp01 = (v) => v < 0 ? 0 : v > 1 ? 1 : v

// トグルを decay ms かけて 0↔1 へランプさせる。
// ランプ途中で切り替えても跳ばないよう、切り替え時点の値から続きを描く。
_icToggleRamp = (n, decay, amount) => {
  if (_icToggleT[n] === -Infinity) return 0
  const st = _icToggle[n]
  const prev = (_icToggleT[n] - _icToggleT0[n]) / decay
  const from = _icClamp01(st + (st ? -prev : prev))
  const elapsed = (performance.now() - _icToggleT[n]) / decay
  return amount * _icClamp01(from + (st ? elapsed : -elapsed))
}

for (let b = 1; b <= 7; b++) {
  for (let s = 0; s <= 2; s++) {
    const n = _icNoteOf(b, s)
    window[`ic${b}${s}`] = (decay = null, amount = 1) =>
      decay == null ? (midi.note[n] > 0 ? 1 : 0) : _icDecay(_icOnT[n], decay, amount)
    window[`ic${b}${s}Up`] = (decay = 200, amount = 1) => _icDecay(_icUpT[n], decay, amount)
    window[`ic${b}${s}T`] = (decay = null, amount = 1) =>
      decay == null ? _icToggle[n] : _icToggleRamp(n, decay, amount)
  }
}

console.log(`[preload] instachord loaded: ic10()..ic72() / ic10Up() / ic10T()`)
