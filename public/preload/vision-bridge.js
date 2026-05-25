// VisionBridge hub preload
// Usage: http://<MBP>:5173/?preload=vision-bridge[&signaling=ws://<MBP>:8080]
//
// HMD タブ (?id=hmd1 / ?id=hmd2) からの映像を hydra の s0 / s1 に流し込み、
// 「このブラウザタブの表示内容そのもの」(エディタのコード文字を含む) を getDisplayMedia で
// キャプチャして各 HMD に送り返す hub。
// graph (o0 への出力) はユーザーのライブコーディングに任せる。s0/s1 を参照すれば
// HMD 映像が使える。例: src(s0).blend(s1).out(o0)
//
// 送出映像は getDisplayMedia (画面共有) で取得する。これはユーザージェスチャ必須なので、
// 画面右上に出る「画面共有を開始」ボタンのクリックで取得し、現在タブに固定する
// (preferCurrentTab)。それまでは黒プレースホルダを送り、取得後に replaceTrack で差し替える。
//
// 前提:
//   - index.html が visionBridge UMD をロード済み (window.visionBridge)
//   - VisionBridge signaling server が起動 (pnpm --dir server start, ws://0.0.0.0:8080)
//   - (HMD を繋ぐ場合) styly-netsync-server が LAN 内で起動
//
// このファイルは gallery-store の window.eval で async IIFE として実行されるため、
// hydra のグローバル (s0, s1, o0, src) と top-level await が使える。ESM import は不可。

// gallery / performance ストアは ?preload を複数回 eval しうるので二重起動を防ぐ。
if (window.__vbHubStarted) {
  console.log('[vb-hydra] hub は既に起動済み — スキップ')
  return
}

const VB = window.visionBridge && window.visionBridge.VisionBridge
if (!VB) {
  console.error('[vb-hydra] window.visionBridge.VisionBridge が見つかりません。index.html の script タグと public/libs/vision-bridge.js (symlink) を確認してください。')
  return
}

const hydra = window.hydraSynth
const canvas = (hydra && hydra.canvas) || document.getElementById('hydra-canvas')
if (!canvas) {
  console.error('[vb-hydra] hydra canvas が見つかりません。')
  return
}

const params = new URLSearchParams(location.search)
const id = params.get('vbId') || 'host'
const signalingUrl = params.get('signaling') || `ws://${location.hostname || 'localhost'}:8080`
// 画面共有の送出解像度の高さ上限。Retina タブは 3600x1964 (約7MP) でキャプチャされ、
// MBP は HW H264 で 30fps 送出できるが Quest のデコード/描画が追いつかず受信側 fps が落ちる。
// 高解像度ほど Quest のデコード負荷が増え受信側 fps が落ちる。720p で fps が出やすく、
// コード文字も概ね読める。?vbMaxH=1080 等で調整可（くっきり寄り↔fps寄り）。
const maxHeight = parseInt(params.get('vbMaxH') || '720', 10)
// 解像度を落としてデコード余力ができたので、hydra アニメーションの滑らかさ優先で 60fps を狙う。
// タブキャプチャ/Quest が出せなければ実測はこれ未満になる。?vbFps=30 等で調整可。
const maxFps = parseInt(params.get('vbFps') || '60', 10)
// 送出ビットレート上限(kbps)。LAN は帯域余裕なので大きめ。低いとエンコーダが fps を削る。?vbKbps= で調整可。
const maxKbps = parseInt(params.get('vbKbps') || '25000', 10)
// 詰まった時の劣化方針。maintain-framerate=fps死守(解像度犠牲) / maintain-resolution=解像度死守(fps犠牲)
// / balanced=両方ほどよく。?vbDegrade= で調整可。
const degradePref = params.get('vbDegrade') || 'maintain-resolution'
// リレー(相手 HMD の生カメラ)を HMD へ再送する際の格下げ設定。アップリンク(peer→hub)には影響しない。
// 相手カメラは副次情報なので解像度・fps を落として hydra 合成に帯域/デコードを回す。
const relayScale = parseFloat(params.get('vbRelayScale') || '8') // scaleResolutionDownBy (例 1280x960→640x480)
const relayFps = parseInt(params.get('vbRelayFps') || '12', 10)
const relayKbps = parseInt(params.get('vbRelayKbps') || '2000', 10)

// リレー sender を格下げ (解像度↓・fps↓・bitrate↓)。受信した track を再エンコードして送るので効く。
async function tuneRelaySender(sender) {
  try {
    const p = sender.getParameters()
    if (!p.encodings || !p.encodings.length) p.encodings = [{}]
    p.encodings[0].scaleResolutionDownBy = relayScale
    p.encodings[0].maxFramerate = relayFps
    p.encodings[0].maxBitrate = relayKbps * 1000
    await sender.setParameters(p)
  } catch (e) {
    console.warn('[vb-hydra] relay setParameters 失敗', e)
  }
}

// 合成 track の送出 sender をチューニングする。bitrate/framerate 上限に加え degradationPreference を設定。
// 既定 maintain-resolution の狙い: 複数 HMD が1つの getDisplayMedia ソースを共有するため、帯域の弱い peer
// (低バッテリー等) が「ソース解像度を下げてくれ」と要求すると、共有ソースが縮小し帯域のある peer まで
// 道連れになる。maintain-resolution なら各 encoder は解像度を保ち fps を犠牲にするので、弱い peer が
// ソースを引き下げず、強い peer は高解像度を維持できる。
async function tuneSender(sender) {
  try {
    const p = sender.getParameters()
    if (!p.encodings || !p.encodings.length) p.encodings = [{}]
    p.encodings[0].maxBitrate = maxKbps * 1000
    p.encodings[0].maxFramerate = maxFps
    p.degradationPreference = degradePref
    await sender.setParameters(p)
  } catch (e) {
    console.warn('[vb-hydra] setParameters 失敗', e)
  }
}

const log = (...args) => console.log('[vb-hydra]', ...args)

// 受信した HMD の <video> を置く隠しコンテナ。display:none だと Chromium が
// フレームデコードを止めるため画面外に逃がす。
// choo は body を再 morph して後から足した要素を剥がすので、<html> 直下 (管理対象外) に置く。
let hiddenVideos = document.getElementById('vb-hidden-videos')
if (!hiddenVideos) {
  hiddenVideos = document.createElement('div')
  hiddenVideos.id = 'vb-hidden-videos'
  hiddenVideos.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;overflow:hidden;'
  document.documentElement.appendChild(hiddenVideos)
}

// s0/s1 がまだ texture を持たないうちにユーザーのスケッチが src(s0) を描画すると
// texImage2D が空の <video> に対して発火して例外になる。黒プレースホルダで防ぐ。
// (出力 graph 自体はセットしない — ユーザーのライブコーディングに委ねる)
const placeholder = document.createElement('canvas')
placeholder.width = 64; placeholder.height = 36
const pctx = placeholder.getContext('2d')
pctx.fillStyle = 'black'
pctx.fillRect(0, 0, placeholder.width, placeholder.height)
s0.init({ src: placeholder })
s1.init({ src: placeholder })

window.__vbHubStarted = true

const slotFor = (name) => (name === 'hmd1' ? s0 : name === 'hmd2' ? s1 : null)

// --- HMD への送出映像 (画面共有) ---
// 黒プレースホルダを初期 track にしておき、各 peer には常にこれで answer する
// (合成 track の m-line を確保するため)。画面共有開始後に sender.replaceTrack で
// 実映像に差し替える (track の種別が同じなので再ネゴ不要)。
const makePlaceholderTrack = () => {
  const c = document.createElement('canvas')
  c.width = 320; c.height = 180
  const cx = c.getContext('2d')
  cx.fillStyle = 'black'; cx.fillRect(0, 0, c.width, c.height)
  return c.captureStream(5).getVideoTracks()[0]
}
let outputTrack = makePlaceholderTrack()       // 現在 HMD に送っている合成 video track
const outputSenders = new Map()                // peerId -> 合成 track の RTCRtpSender

// getDisplayMedia はユーザージェスチャからしか呼べないため開始ボタンを出す。
// choo の body 再 morph で剥がされないよう <html> 直下 (管理対象外) に置く。
const shareBtn = document.createElement('button')
shareBtn.textContent = '▶ HMD へ画面共有を開始'
shareBtn.style.cssText = 'position:fixed;z-index:2147483647;top:8px;right:8px;padding:8px 12px;font:14px system-ui;background:#1a73e8;color:#fff;border:0;border-radius:6px;cursor:pointer;box-shadow:0 2px 6px rgba(0,0,0,.4);'
document.documentElement.appendChild(shareBtn)

async function startScreenShare() {
  // getDisplayMedia は secure context (HTTPS か localhost) 限定。LAN の IP+HTTP で開くと
  // 使えない。hub は MBP 自身のタブなので localhost で開けば解決する。
  if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
    throw new Error('getDisplayMedia 不可 — secure context が必要です。MBP では http://localhost:5173/ で開いてください (IP+HTTP は不可)')
  }
  const videoConstraints = {
    frameRate: { ideal: maxFps, max: maxFps },
    width: { max: Math.round((maxHeight * 16) / 9) },
    height: { max: maxHeight },
  }
  const stream = await navigator.mediaDevices.getDisplayMedia({
    video: videoConstraints,
    audio: false,
    preferCurrentTab: true, // Chrome: ピッカーを現在タブに固定
  })
  outputTrack = stream.getVideoTracks()[0]
  // スクリーン共有 track の既定は detail(精細優先・fps犠牲)。render の滑らかさ優先なので motion に。
  outputTrack.contentHint = 'motion'
  // タブ/画面キャプチャは getDisplayMedia 初期呼び出しで解像度制約を無視することがあるので
  // applyConstraints でも明示的に上限を効かせる (Retina の過大解像度をデコード可能な範囲へ)。
  try {
    await outputTrack.applyConstraints(videoConstraints)
  } catch (e) {
    console.warn('[vb-hydra] applyConstraints 失敗', e)
  }
  const st = outputTrack.getSettings()
  log('画面共有 解像度', st.width + 'x' + st.height, '@', st.frameRate, 'fps (上限', maxHeight + 'p)')
  for (const sender of outputSenders.values()) {
    try { await sender.replaceTrack(outputTrack) } catch (e) { console.warn('[vb-hydra] replaceTrack 失敗', e) }
  }
  log('画面共有を開始 — 送出 track を', outputSenders.size, 'peer に差し替え')
  shareBtn.style.display = 'none'
  // ユーザーがブラウザ UI で共有を停止したら黒プレースホルダに戻し、再共有できるようボタンを復帰。
  outputTrack.addEventListener('ended', () => {
    log('画面共有が停止されました — プレースホルダに戻す')
    outputTrack = makePlaceholderTrack()
    for (const sender of outputSenders.values()) sender.replaceTrack(outputTrack).catch(() => { })
    shareBtn.disabled = false
    shareBtn.style.display = ''
  })
}

shareBtn.addEventListener('click', () => {
  shareBtn.disabled = true
  startScreenShare().catch((e) => {
    shareBtn.disabled = false
    log('画面共有の開始に失敗/キャンセル:', e && e.message)
  })
})

// signaling 接続。失敗してもボタン (画面共有 UI) は既に出ているが、HMD との
// やりとりはできないのでフラグを戻して再 preload を許す。
let vb
try {
  vb = await VB.connect({ signaling: signalingUrl, id })
} catch (e) {
  window.__vbHubStarted = false
  console.error('[vb-hydra] signaling 接続に失敗:', signalingUrl, e && e.message,
    '— signaling server (pnpm --dir server start) が起動しているか確認してください。')
  return
}
log('connected as', id, 'via', signalingUrl)

// --- cross-forwarding ---
// 各 HMD は「もう一方の HMD の生映像」も受け取りたい。host は両方受信済みなので、
// 各 peer の incoming track を他の全 peer に再送する。合成 (hydra) track は各 peer が
// 最初に受け取る track (初回 answer で送出)、生映像は常に後から renegotiation で届く。
// この到着順で受信側は両者を区別できる。
const connectedPeers = new Map()      // peerId -> Peer
const rawTracks = new Map()           // peerId -> incoming video track
const ready = new Set()               // 初回 answer 完了済み = addTrack 安全
const forwarded = new Set()           // "to<-from" 配線済みペア
const relaySenders = new Map()        // "to<-from" -> その track の sender

// peer の初回 PeerConnection が connected になってからのみ forward する。理由:
// (1) forward track は必ず初回 answer の *後の* renegotiation で届かせ、受信側の
//     「最初=合成 / 後=生映像」前提を守るため。
// (2) 初回接続確立中に renegotiate すると in-flight の初回 answer と衝突して
//     silently fail する (signaling は直列化されない)。connected を待てば peer は
//     idle で安定しているので安全に re-offer できる。
async function crossForward() {
  for (const [toId, toPeer] of connectedPeers) {
    if (!ready.has(toId)) continue
    let added = false
    for (const [fromId, track] of rawTracks) {
      if (fromId === toId) continue
      const key = `${toId}<-${fromId}`
      if (forwarded.has(key)) continue
      forwarded.add(key)
      const relaySender = toPeer.addTrack(track)
      relaySenders.set(key, relaySender)
      void tuneRelaySender(relaySender) // 480p/24fps 程度に格下げ
      added = true
      log('forwarding raw', fromId, '→', toId)
    }
    if (added) await toPeer.renegotiate()
  }
}

// peer が離脱 (アプリ再起動等)。VisionBridge は既に接続を閉じて忘れている。ここでは
// cross-forwarding の記録をクリアし、死んだ track の他 HMD への送出を止める。
// 再接続時は onIncoming + crossForward でクリーンに再配線される。
vb.onPeerLeft((goneId) => {
  log('peer-left', goneId)
  connectedPeers.delete(goneId)
  rawTracks.delete(goneId)
  ready.delete(goneId)
  outputSenders.delete(goneId)
  for (const key of [...forwarded]) {
    const [toId, fromId] = key.split('<-')
    if (toId !== goneId && fromId !== goneId) continue
    forwarded.delete(key)
    const sender = relaySenders.get(key)
    relaySenders.delete(key)
    // 生き残っている方の peer から stale な relay sender を外すだけでよい
    // (離脱した peer 自身の接続は既に閉じている)。
    const toPeer = toId !== goneId ? connectedPeers.get(toId) : undefined
    if (toPeer && sender) {
      toPeer.removeTrack(sender)
      void toPeer.renegotiate()
      log('removed stale relay', fromId, '→', toId)
    }
  }
})

vb.onIncoming(async (peer, offer) => {
  log('incoming offer from', peer.remoteId)
  connectedPeers.set(peer.remoteId, peer)

  // この peer の生映像 track を覚えて他 HMD に cross-forward する。acceptOffer の前に
  // 登録するのは setRemoteDescription 中に発火する track event を取りこぼさないため。
  // ready ゲートが自分自身の初回 negotiation を壊さないようにしている。
  peer.onTrack((incoming) => {
    if (incoming.kind !== 'video') return
    rawTracks.set(peer.remoteId, incoming)
    void crossForward()
  })

  // 初回接続が確立してからのみ ready 化 (= forward 対象に)。新規 join した HMD で
  // relay の renegotiation が初回 answer とレースしないように。
  peer.pc.addEventListener('connectionstatechange', () => {
    if (peer.pc.connectionState === 'connected' && !ready.has(peer.remoteId)) {
      ready.add(peer.remoteId)
      log('connected', peer.remoteId, '— eligible for relay')
      void crossForward()
    }
  })

  await peer.acceptOffer(offer, [outputTrack])
  // 初回 answer で追加した唯一の video sender = 合成 track の sender。覚えておき、
  // 画面共有の開始/停止時に replaceTrack で差し替える。(relay track は connected 後に
  // 追加されるので、この時点の video sender は合成 track のものだけ)
  const outSender = peer.pc.getSenders().find((s) => s.track && s.track.kind === 'video')
  if (outSender) {
    outputSenders.set(peer.remoteId, outSender)
    // この acceptOffer の進行中に画面共有が開始/停止されると、addTrack した track と
    // 現在の outputTrack がズレうる。ズレていたら即 replaceTrack で揃える (happy path では no-op)。
    if (outSender.track !== outputTrack) outSender.replaceTrack(outputTrack).catch(() => { })
    void tuneSender(outSender) // fps 優先 (maintain-framerate + bitrate + maxFramerate)
  }
  log('answered', peer.remoteId, '→ 送出 track をセット')

  const slot = slotFor(peer.remoteId)
  if (!slot) {
    log('no hydra slot for', peer.remoteId, '— ignored')
    return
  }
  const video = vb.inputVideo(peer.remoteId)
  hiddenVideos.appendChild(video)
  video.addEventListener('loadeddata', () => {
    slot.init({ src: video })
    log('routed', peer.remoteId, 'into hydra source')
  }, { once: true })
})

log('hub ready — 右上のボタンで画面共有を開始してください。s0=hmd1, s1=hmd2。例: src(s0).blend(s1).out(o0)')

// 実 fps 計測ログ (?vbStats=1 で有効化)。capture(媒体源) と各 outbound の実 fps を出す。
// cap が vbFps に届かなければタブキャプチャが上限、cap は高いが send が低ければエンコード/送出側。
if (params.get('vbStats') === '1') {
  const prev = new Map() // outbound-rtp.id -> { bytes, ts } 実ビットレート算出用
  const prevLost = new Map() // remote-inbound-rtp.ssrc -> packetsLost (差分でロス率算出用)
  const sid = Math.random().toString(36).slice(2, 6) // ページロードごとに変わる。古いログとの区別用
  log('stats session', sid)
  setInterval(async () => {
    for (const [pid, peer] of connectedPeers) {
      const parts = [`#${sid}`]
      const stats = await peer.pc.getStats()
      const remoteCands = new Map() // candidate id -> address (相手の接続元 IP 特定用)
      let activeRemoteCandId = null
      stats.forEach((r) => {
        if (r.type === 'remote-candidate') remoteCands.set(r.id, r.address || r.ip)
        if (r.type === 'candidate-pair' && r.availableOutgoingBitrate) activeRemoteCandId = r.remoteCandidateId
        if (r.type === 'media-source' && r.kind === 'video') {
          parts.push(`cap ${r.width}x${r.height}@${Math.round(r.framesPerSecond || 0)}`)
        }
        if (r.type === 'outbound-rtp' && r.kind === 'video') {
          let kbps = '?'
          const p = prev.get(r.id)
          if (p && r.timestamp > p.ts) {
            kbps = Math.round(((r.bytesSent - p.bytes) * 8) / ((r.timestamp - p.ts) / 1000) / 1000)
          }
          prev.set(r.id, { bytes: r.bytesSent, ts: r.timestamp })
          const tgt = r.targetBitrate ? Math.round(r.targetBitrate / 1000) : '?'
          parts.push(`send[${r.contentType || '?'}] ${r.frameWidth}x${r.frameHeight}@${Math.round(r.framesPerSecond || 0)} ${kbps}kbps(tgt ${tgt}, 上限 ${maxKbps}) ql=${r.qualityLimitationReason}`)
        }
        // 受信側(HMD)が報告するパケットロス。BWE 崩壊=WiFi ロスの確証になる。
        if (r.type === 'remote-inbound-rtp' && r.kind === 'video') {
          const lost = r.packetsLost || 0
          const dLost = lost - (prevLost.get(r.ssrc) || 0)
          prevLost.set(r.ssrc, lost)
          parts.push(`loss[${r.ssrc}] +${dLost} (frac ${(r.fractionLost || 0).toFixed(3)})`)
        }
        // 推定利用可能帯域(BWE)と実 RTT。BWE が低く RTT が高ければ遅延ベースで絞られている。
        // availableOutgoingBitrate は使用中の pair にのみ載るので存在チェックで拾う。
        if (r.type === 'candidate-pair' && r.availableOutgoingBitrate) {
          const rtt = r.currentRoundTripTime != null ? Math.round(r.currentRoundTripTime * 1000) + 'ms' : '?'
          parts.push(`BWE ${Math.round(r.availableOutgoingBitrate / 1000)}kbps rtt ${rtt}`)
        }
      })
      const fromAddr = activeRemoteCandId ? remoteCands.get(activeRemoteCandId) : null
      if (fromAddr) parts.push(`from ${fromAddr}`)
      log('fps', pid, parts.join(' | '))
    }
  }, 2000)
}
