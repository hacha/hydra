// strudel-mini: hydra-strudel の P() / mini() だけを軽量に提供する差し替え実装。
// 元の hydra-strudel は webaudio スケジューラ・tonal・ドラム音源サンプルを CDN から
// 非同期ロードしており、P() が使えるまで数秒かかる(= undefined レースの原因)うえに
// 視覚用途では過剰だった。ここでは mini 記法のパーサ(core + mini)だけをバンドル同梱し、
// クロックを hydra の time/bpm に連動させることで、起動時 CDN ダウンロードを無くし
// window.P を同期的に利用可能にしつつ、hydra ネイティブの配列シーケンサと速度を揃える。
//
// licensed with CC BY-NC-SA 4.0 https://creativecommons.org/licenses/by-nc-sa/4.0/
// (元の atfornes/Hydra-strudel-extension の P/value 実装を踏襲)

import { Pattern, State, TimeSpan } from '@strudel.cycles/core'
import { mini, miniAllStrings } from '@strudel.cycles/mini'

// stack("0","1") 等、関数に渡した素の文字列を mini でパターン化する(reify 経由)。
miniAllStrings()

// "0 1".slow(2) のように文字列リテラルへ直接 Pattern メソッドを生やす(元実装 line 67 と同等)。
// String.prototype を全域改変する侵襲的な手法だが、文字列チェーン記法のために踏襲。
// (配列リテラル [0,1].fast(.5) は strudel core が Array.prototype に生やすため別途不要)
Object.setPrototypeOf(String.prototype, Pattern.prototype)

// --- クロック(cycles 単位) ---------------------------------------------------
// 元実装は strudel の webaudioScheduler.now() を使っていた(オーディオ解錠後に進む)。
// ここでは hydra のグローバル time(秒)/bpm に連動させ、hydra ネイティブの配列シーケンサと
// 速度を揃える。hydra 配列は array-utils.js で index = time*speed*(bpm/60)、つまり
// 「1要素=1ビート」(1要素あたり 60/bpm 秒)で進む。
//
// 2ステップ校正: cps = bpm/120 とすると 1サイクル = 2ビートになり、
//   P("0 1")        ≡ [0,1]              (各ステップ/要素が 60/bpm 秒ごとに切替)
//   P("0 1".slow(2)) ≡ [0,1].fast(.5)
// が一致する(time も共有するので位相も揃う)。
// 注: strudel は全ステップを1サイクルに詰めるため、正確に一致するのは2ステップのみ。
//   "0 1 2 3" は [0,1,2,3] の2倍速、"0@7 1" は8要素配列とは一致しない(設計上の制約)。
//
// hydra 未初期化時(window.time 未定義)のフォールバックは performance.now()。
const startMs = performance.now()

function nowCycles() {
  const bpm = (typeof window.bpm === 'number' && window.bpm > 0) ? window.bpm : 30
  const tSec = (typeof window.time === 'number')
    ? window.time
    : (performance.now() - startMs) / 1000
  return tSec * bpm / 120
}

// --- Pattern.value(): 現在時刻でパターンを query して値を返す --------------------
Pattern.prototype.value = function () {
  const t = nowCycles()
  const haps = this.query(new State(new TimeSpan(t, t)))
  // 空 query (境界など) でも throw しないよう ?. + 0 フォールバック
  return haps[0]?.value ?? 0
}

// --- hydra コード内で使うグローバル -------------------------------------------
window.mini = mini
window.P = (pattern) => {
  const p = pattern instanceof Pattern ? pattern : mini(pattern)
  return () => p.value()
}

// gallery-store / preload の readiness ガード互換。バンドル同梱なので即 ready。
window._hydraStrudelReady = true
window.dispatchEvent(new Event('hydra-strudel-ready'))
