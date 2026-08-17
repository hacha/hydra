/**
 * Performance Recording Store
 * VJパフォーマンスのコード実行履歴を自動録画・再生する機能
 * ページロード時に自動で録画を開始し、Shift-Ctrl-Pでセッションとして保存する
 */

// ローカルストレージのキー
const STORAGE_META_KEY = 'hydra_performance_meta'
export const STORAGE_SESSION_PREFIX = 'hydra_perf_'

// セッション本体が実在するか。getItem は存在確認のためだけに値全体（数MBに
// なりうる）を文字列化するので、キーの有無だけ見たい場面ではこちらを使う。
export function hasSessionBody(sessionId) {
  try {
    return Object.prototype.hasOwnProperty.call(localStorage, STORAGE_SESSION_PREFIX + sessionId)
  } catch (e) {
    return false
  }
}
const AUTO_BUFFER_KEY = 'hydra_perf_autobuffer'

// 録画バッファの書き込みが失敗している状態を表す表示文字列
const REC_ERROR = 'Recording stopped: storage full'

// UUID生成
function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

// 日時フォーマット
function formatDateTime(timestamp) {
  const d = new Date(timestamp)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

// ローカルストレージ操作
const storage = {
  getMeta() {
    try {
      const data = localStorage.getItem(STORAGE_META_KEY)
      return data ? JSON.parse(data) : { sessions: {}, lastSessionId: null }
    } catch (e) {
      console.error('Failed to load performance meta:', e)
      return { sessions: {}, lastSessionId: null }
    }
  },

  // 書き込み系は成否を返す。localStorageは容量超過で黙って失敗しうるが、
  // 呼び出し側がそれを知らずに先へ進むと「メタにあるのに本体が無い」壊れた
  // セッションが出来上がるため、例外を握りつぶしたままにしない。
  saveMeta(meta) {
    try {
      localStorage.setItem(STORAGE_META_KEY, JSON.stringify(meta))
      return true
    } catch (e) {
      console.error('Failed to save performance meta:', e)
      return false
    }
  },

  getSession(sessionId) {
    try {
      const data = localStorage.getItem(STORAGE_SESSION_PREFIX + sessionId)
      return data ? JSON.parse(data) : null
    } catch (e) {
      console.error('Failed to load session:', e)
      return null
    }
  },

  saveSession(session) {
    try {
      localStorage.setItem(STORAGE_SESSION_PREFIX + session.id, JSON.stringify(session))
      return true
    } catch (e) {
      console.error('Failed to save session:', e)
      return false
    }
  },

  deleteSession(sessionId) {
    try {
      localStorage.removeItem(STORAGE_SESSION_PREFIX + sessionId)
    } catch (e) {
      console.error('Failed to delete session:', e)
    }
  }
}

// 自動録画バッファ操作（通常セッションとは別のキーで管理）
const autoBuffer = {
  get() {
    try {
      const data = localStorage.getItem(AUTO_BUFFER_KEY)
      return data ? JSON.parse(data) : null
    } catch (e) {
      console.error('Failed to load auto-buffer:', e)
      return null
    }
  },

  save(buffer) {
    try {
      localStorage.setItem(AUTO_BUFFER_KEY, JSON.stringify(buffer))
      return true
    } catch (e) {
      console.error('Failed to save auto-buffer:', e)
      return false
    }
  },

  clear() {
    try {
      localStorage.removeItem(AUTO_BUFFER_KEY)
    } catch (e) {
      console.error('Failed to clear auto-buffer:', e)
    }
  }
}

export default function performanceStore(state, emitter) {
  // 状態初期化
  state.performance = {
    // 自動録画状態
    autoBufferStartTime: null,
    snapshotCount: 0,
    savedMessage: null,

    // 再生状態
    isPlaying: false,
    playbackSessionId: null,
    playbackStartTime: null,
    playbackIndex: 0,
    playbackTimerId: null,
    playbackSpeed: 1.0,
    playbackProgress: 0,
    progressIntervalId: null,
    currentSnapshotTime: 0,
    nextSnapshotTime: 0,

    // セッション一覧
    sessions: {},

    // セッションリストUI
    showSessionList: false,
    editingSessionId: null,

    // localStorage書き込み失敗の表示（false or メッセージ文字列）
    storageError: false
  }

  // 消えない失敗表示。「保存できていない」「録画が止まっている」という継続状態
  // だけに使う。ここに一時的な通知を混ぜると、赤帯が出ている＝録れていない、
  // という意味が薄れて本物の警告に気づけなくなる。
  function showStorageError(message) {
    // 容量超過中は eval のたびに同じ失敗を通るので、変化が無ければ再描画しない
    if (state.performance.storageError === message) return
    state.performance.storageError = message
    // savedMessageは消さない。「保存は成功したが録画の再開に失敗した」のように
    // 両方が同時に真になる場合があり、インジケータは両方を並べて表示する。
    emitter.emit('render')
  }

  // 一時的な通知（3秒で消える）。ボタンが無反応にしか見えないのを防ぐ用。
  function showNotice(message) {
    state.performance.savedMessage = message
    emitter.emit('render')
    setTimeout(() => {
      if (state.performance.savedMessage === message) {
        state.performance.savedMessage = null
        emitter.emit('render')
      }
    }, 3000)
  }

  // 自動録画バッファを新規作成する内部関数
  function startAutoBuffer() {
    autoBuffer.clear()
    const now = Date.now()
    const preload = new URLSearchParams(window.location.search).get('preload') || null
    const buffer = {
      id: generateUUID(),
      name: `Session ${formatDateTime(now)}`,
      createdAt: now,
      snapshots: [],
      preload,
      youtube: state.youtube?.videoId ? {
        videoId: state.youtube.videoId,
        startTime: 0
      } : null
    }
    // ここで書けないと以降のcaptureSnapshotがバッファを読めず即returnするので、
    // 録画が始まっていないことがどこにも出ないまま一晩無記録になる。
    const ok = autoBuffer.save(buffer)
    state.performance.autoBufferStartTime = now
    state.performance.snapshotCount = 0
    // 新規バッファでは最初のeditor全文を必ず記録できるよう重複排除をリセット
    lastEditorText = null
    if (!ok) {
      // 保存失敗の表示が出ているならそれを優先する（captureSnapshot側と同じ方針）。
      // どちらも容量超過を示すが、より具体的な方を残す。
      const cur = state.performance.storageError
      if (!cur || cur === REC_ERROR) showStorageError(REC_ERROR)
      return null
    }
    // 書けたなら録画は復旧している
    if (state.performance.storageError === REC_ERROR) {
      state.performance.storageError = false
      emitter.emit('render')
    }
    return buffer
  }

  // 初期化時にメタデータを読み込み、自動録画を開始（リロード時は前回バッファを引き継ぐ）
  emitter.on('DOMContentLoaded', () => {
    const meta = storage.getMeta()
    state.performance.sessions = meta.sessions

    // 前回バッファにスナップショットがあれば引き継ぐ
    const prevBuffer = autoBuffer.get()
    if (prevBuffer && prevBuffer.snapshots && prevBuffer.snapshots.length > 0) {
      state.performance.autoBufferStartTime = prevBuffer.createdAt
      state.performance.snapshotCount = prevBuffer.snapshots.length
      state.performance._pendingCodeCheck = true
      console.log(`[Performance] Resuming previous buffer (${prevBuffer.snapshots.length} snapshots)`)
    } else {
      startAutoBuffer()
      console.log('[Performance] Auto-recording started')
    }

    // URLパラメータをチェック
    const params = new URLSearchParams(window.location.search)

    if (params.has('playback')) {
      const sessionId = params.get('playback')
      const start = parseInt(params.get('start') || '0', 10)
      const speed = parseFloat(params.get('speed') || '1')
      emitter.emit('performance: start playback', sessionId, start, speed)
    }

    if (params.has('resume')) {
      const sessionId = params.get('resume')
      emitter.emit('performance: resume session', sessionId)
    }

    // 外部URLからセッションをインポート
    if (params.has('session')) {
      const sessionUrl = params.get('session')
      emitter.emit('performance: import session from url', sessionUrl)
    }

    // /sessions/ パスでセッション一覧を表示
    if (window.location.pathname.endsWith('/sessions') || window.location.pathname.endsWith('/sessions/')) {
      emitter.emit('performance: show session list')
    }
  })

  // 保存失敗時の共通処理。従来は失敗しても "Saved" と出して録画バッファを捨てて
  // いたため、セッションが無言で全損していた。失敗は消えない表示で知らせる。
  function failSave(message) {
    showStorageError(message)
    // 「バッファは残っている」等の後始末はケースごとに違うので、messageに含める。
    // ここで一律のサフィックスを付けると、復元に失敗した場合に矛盾したログになる。
    console.error(`[Performance] ${message}`)
  }

  // セッション保存（自動録画バッファを正式セッションに昇格）
  emitter.on('performance: save session', () => {
    const buffer = autoBuffer.get()
    if (!buffer || buffer.snapshots.length === 0) {
      console.log('[Performance] No snapshots to save')
      state.performance.savedMessage = 'No snapshots to save'
      emitter.emit('render')
      setTimeout(() => {
        state.performance.savedMessage = null
        emitter.emit('render')
      }, 2000)
      return
    }

    // durationを設定
    buffer.duration = Date.now() - state.performance.autoBufferStartTime

    // resume したセッションは buffer.id が既存セッションと同じで、この保存は
    // 上書き更新になる。その場合は本体を消してはいけないので先に控えておく。
    const existedBefore = hasSessionBody(buffer.id)

    // 正式セッションとして保存。
    // bufferはautoBufferキーにも同じ内容が入っているので、そのまま書くと保存の
    // 瞬間だけ同じデータが2つ載り、ピーク使用量が倍になって容量超過を自分で
    // 引き起こす。先にautoBuffer側を解放してから書き、失敗したら書き戻す。
    // (bufferはメモリ上にあるので、この間にデータが失われることはない)
    autoBuffer.clear()
    if (!storage.saveSession(buffer)) {
      // clear() で空けた分と同じサイズを書くので通常は復元できるが、失敗すると
      // bufferはこの return で失われる。案内が嘘にならないよう文面を分ける。
      if (autoBuffer.save(buffer)) {
        failSave('Save failed: storage full — buffer kept, free space and retry')
      } else {
        failSave('Save failed: storage full — recording buffer lost')
      }
      return
    }

    // メタデータを更新
    const meta = storage.getMeta()
    meta.sessions[buffer.id] = {
      id: buffer.id,
      name: buffer.name,
      createdAt: buffer.createdAt,
      snapshotCount: buffer.snapshots.length,
      duration: buffer.duration,
      preload: buffer.preload || null
    }
    meta.lastSessionId = buffer.id
    if (!storage.saveMeta(meta)) {
      if (existedBefore) {
        // resume の上書き保存。本体は新しい内容で書けていて meta にも既に載って
        // いるので、本体が正。バッファを書き戻すと同じ内容が2つ載って容量不足を
        // 悪化させるだけなので、新しいバッファで録画を続行する。
        // ただし meta は保存前の古い値のまま残る。一覧の snapshotCount /
        // duration / name が実データと食い違うが、本体は存在するので broken 判定
        // には引っかからない。検知できない不整合なので文面で伝える。
        // (ここで saveMeta を再試行しても無意味。autoBufferは上の clear() で既に
        //  解放済みで、startAutoBuffer は空きを増やさず小さいバッファを足すだけ)
        startAutoBuffer()
        failSave('Save failed (meta) — body saved, list info may be stale')
      } else {
        // 新規セッション。本体だけ残ると一覧に出ないまま容量を食うので巻き戻し、
        // バッファを復元して再保存できる状態に戻す。
        storage.deleteSession(buffer.id)
        if (autoBuffer.save(buffer)) {
          failSave('Save failed (meta) — buffer kept, free space and retry')
        } else {
          failSave('Save failed (meta) — recording buffer lost')
        }
      }
      return
    }

    state.performance.sessions = meta.sessions
    // 録画自体が止まっている表示は消さない（保存の成否とは別の継続状態）
    if (state.performance.storageError !== REC_ERROR) state.performance.storageError = false

    const snapshotCount = buffer.snapshots.length
    console.log(`[Performance] Session saved: ${buffer.id} (${snapshotCount} snapshots)`)

    // 保存確認メッセージ
    state.performance.savedMessage = `Saved: ${snapshotCount} snapshots`
    emitter.emit('render')
    setTimeout(() => {
      state.performance.savedMessage = null
      emitter.emit('render')
    }, 3000)

    // 新しい自動録画バッファを開始
    startAutoBuffer()
    console.log('[Performance] New auto-recording started')
  })

  // 後方互換: toggle recording → save session
  emitter.on('performance: toggle recording', () => {
    emitter.emit('performance: save session')
  })

  // 前回スナップショット時のperformance.now()を記録（MIDIバッファの切り出しに使用）
  let lastSnapshotPerfTime = performance.now()

  // 前回記録したエディタ全文（変化が無いsnapshotでは省略するための重複排除用）
  let lastEditorText = null

  // スナップショット記録の共通処理
  // code: 評価コード（nullならMIDIのみのスナップショット）
  function captureSnapshot(code) {
    if (!state.performance.autoBufferStartTime) return

    // バッファが書けずに失われている状態。ここで作り直さないと、赤い表示を見て
    // 古いセッションを削除し容量を空けても、リロードするまで録画が再開しない
    // （startAutoBufferに至る経路がDOMContentLoaded/保存成功/resumeしかないため）。
    // 空きが戻っていればここで復旧し、まだ駄目ならstartAutoBuffer側が表示を出す。
    const buffer = autoBuffer.get() || startAutoBuffer()
    if (!buffer) return

    const timestamp = Date.now() - state.performance.autoBufferStartTime
    const now = performance.now()

    // 前回スナップショット以降のMIDIイベントを切り出す
    let midiEvents = null
    if (state.midiInput && state.midiInput._buffer.length > 0) {
      const since = lastSnapshotPerfTime
      const events = state.midiInput._buffer
        .filter(e => e.t > since)
        .map(e => [Math.round(e.t - since), e.status, e.d1, e.d2]) // [offset, status, d1, d2] 配列で軽量化
      if (events.length > 0) midiEvents = events
    }
    lastSnapshotPerfTime = now

    // MIDIイベントもコードもなければスキップ
    if (!code && !midiEvents) return

    const snapshot = {
      timestamp,
      absoluteTime: Date.now()
    }
    if (code) {
      snapshot.code = code
      // codeは「評価されたブロック」（ビジュアル再構築用）。
      // editorは「その時点のエディタ全文」（seek時の表示復元用）で別物。
      // 全体評価ではcode===全文だが、ブロック/行評価では両者が異なる。
      try {
        const editorText = state.editor?.editor?.getValue?.()
        if (editorText != null && editorText !== lastEditorText) {
          snapshot.editor = editorText
          lastEditorText = editorText
        }
      } catch (e) { /* エディタ未準備時は無視 */ }
    }
    if (midiEvents) snapshot.midi = midiEvents

    // YouTube再生位置を追加（YouTubeが読み込まれている場合）
    if (state.youtube?.videoId && state.youtube?.isReady) {
      let youtubeTime = null
      emitter.emit('youtube: get current time', (time) => {
        youtubeTime = time
      })
      if (youtubeTime !== null) {
        snapshot.youtubeTime = youtubeTime
      }

      // autoBufferにYouTube情報がまだない場合は追加
      if (!buffer.youtube) {
        buffer.youtube = {
          videoId: state.youtube.videoId,
          startTime: youtubeTime
        }
      }
    }

    buffer.snapshots.push(snapshot)
    // ここが黙って失敗するとライブ中ずっと記録が進んでいないことになるので、
    // 状態を変えたときだけ再描画して表示に出す。
    const saved = autoBuffer.save(buffer)
    // 保存失敗(REC_ERROR以外)の表示は成功時も失敗時も上書きしない。次のeval一発で
    // 消えると、セッションが保存できていないことに気づかないまま演奏を続けてしまう。
    const cur = state.performance.storageError
    const nextError = saved ? (cur === REC_ERROR ? false : cur) : (cur || REC_ERROR)
    if (cur !== nextError) {
      state.performance.storageError = nextError
      emitter.emit('render')
    }
    state.performance.snapshotCount = buffer.snapshots.length

    console.log(`[Performance] Snapshot added: ${timestamp}ms, ${code ? 'code' : 'midi'}${midiEvents ? ` (${midiEvents.length} midi events)` : ''}, total: ${buffer.snapshots.length}`)
  }

  // MIDIデータのロスト防止: リングバッファ(60s)が溢れる前に自動スナップショット
  setInterval(() => {
    captureSnapshot(null)
  }, 50000)

  // コード評価時のスナップショット（repl: evalから呼ばれる）
  emitter.on('performance: snapshot', (code) => {
    if (!code) return
    // 累積リプレイ中の eval はライブ録画バッファに記録しない
    if (state.performance._replaying) return

    // リロード後の最初のeval: 前回バッファの最後のcodeと比較
    if (state.performance._pendingCodeCheck) {
      delete state.performance._pendingCodeCheck
      const buffer = autoBuffer.get()
      const lastCode = buffer?.snapshots?.findLast(s => s.code)?.code
      if (lastCode !== code) {
        // 違うコード → 新しいスケッチ。前回バッファを破棄して新規開始
        startAutoBuffer()
        console.log('[Performance] New sketch detected, starting fresh buffer')
      }
    }

    captureSnapshot(code)
  })

  // MIDIのみのスナップショット（明示的呼び出し）
  emitter.on('performance: midi snapshot', () => {
    captureSnapshot(null)
  })

  // グローバル関数として公開
  window.midiSnapshot = () => emitter.emit('performance: midi snapshot')

  // 再生開始
  // startIndex: 開始するスナップショットのインデックス（0から始まる）
  emitter.on('performance: start playback', async (sessionId, startIndex = 0, speed = 1.0) => {
    if (state.performance.isPlaying) {
      emitter.emit('performance: stop playback')
    }

    const session = storage.getSession(sessionId)
    if (!session || session.snapshots.length === 0) {
      console.warn(`[Performance] Session not found or empty: ${sessionId}`)
      showNotice('⚠ Session data missing — cannot play')
      return
    }

    // startIndexを有効範囲内に収める
    const initialIndex = Math.max(0, Math.min(startIndex, session.snapshots.length - 1))
    const initialSnapshot = session.snapshots[initialIndex]

    // セッションにpreload情報があればロード（完了を待つ）
    if (session.preload) {
      console.log(`[Performance] Loading preload: ${session.preload}`)
      try {
        let preloadPath = session.preload
        if (!preloadPath.startsWith('/') && !preloadPath.includes('.')) preloadPath += '.js'
        const base = preloadPath.startsWith('/') ? preloadPath : `${import.meta.env.BASE_URL}preload/${preloadPath}`
        const res = await fetch(base)
        if (!res.ok) throw new Error(`${res.status}`)
        const code = await res.text()
        await window.eval(`(async() => {\n${code}\n})()`)
        console.log(`[Performance] Preload loaded: ${session.preload}`)
      } catch (err) {
        console.warn(`[Performance] Failed to load preload: ${session.preload}`, err)
      }
    }

    state.performance.isPlaying = true
    state.performance.playbackSessionId = sessionId
    state.performance.playbackSpeed = speed
    state.performance.playbackStartTime = Date.now() - initialSnapshot.timestamp / speed
    state.performance.playbackTotal = session.snapshots.length
    // 再生中フラグ（preloadのloop検知を抑制）
    if (state.midiInput) state.midiInput._isPlayback = true

    // 最初のスナップショットのMIDIイベントを再生
    if (initialSnapshot.midi) {
      replayMidiEvents(state.midiInput, initialSnapshot.midi, speed)
    }

    // コードを累積適用（0..initialIndex を順に eval して全バッファの状態を再構築）
    reconstructStateUpTo(session, emitter, state, initialIndex)

    // YouTube同期再生開始（セッションにYouTube情報がある場合）
    if (session.youtube?.videoId) {
      const youtubeStartTime = initialSnapshot.youtubeTime ?? session.youtube.startTime ?? 0
      emitter.emit('youtube: start sync playback', {
        videoId: session.youtube.videoId,
        startTime: youtubeStartTime
      })
    }

    // playbackIndexは次に再生するスナップショットを指す
    state.performance.playbackIndex = initialIndex + 1

    // timestamp情報を初期化
    const prevSnapshot = initialIndex > 0 ? session.snapshots[initialIndex - 1] : null
    const nextSnapshot = session.snapshots[initialIndex + 1]
    state.performance.currentSnapshotTime = prevSnapshot ? prevSnapshot.timestamp : 0
    state.performance.nextSnapshotTime = nextSnapshot ? nextSnapshot.timestamp : initialSnapshot.timestamp

    console.log(`[Performance] Playback started: ${sessionId}, applied snapshot ${initialIndex}`)
    emitter.emit('render')

    // 再生を開始
    scheduleNextSnapshot(session, emitter, state)

    // 進捗更新インターバルを開始
    state.performance.progressIntervalId = setInterval(() => {
      if (!state.performance.isPlaying) return

      const elapsed = (Date.now() - state.performance.playbackStartTime) * state.performance.playbackSpeed
      const currentTime = state.performance.currentSnapshotTime || 0
      const nextTime = state.performance.nextSnapshotTime || 0
      const interval = nextTime - currentTime

      let progress = 0
      if (interval > 0) {
        const timeIntoInterval = elapsed - currentTime
        progress = Math.min(100, Math.max(0, (timeIntoInterval / interval) * 100))
      }

      state.performance.playbackProgress = progress
      emitter.emit('render')
    }, 50)
  })

  // 再生停止
  emitter.on('performance: stop playback', () => {
    if (!state.performance.isPlaying && !state.performance.isPaused) return

    if (state.performance.playbackTimerId) {
      clearTimeout(state.performance.playbackTimerId)
      state.performance.playbackTimerId = null
    }

    clearMidiPlaybackTimers()

    if (state.performance.progressIntervalId) {
      clearInterval(state.performance.progressIntervalId)
      state.performance.progressIntervalId = null
    }

    state.performance.isPlaying = false
    state.performance.isPaused = false
    state.performance.playbackSessionId = null
    state.performance.playbackIndex = 0
    state.performance.playbackProgress = 0

    // 再生中フラグ解除
    if (state.midiInput) state.midiInput._isPlayback = false

    // YouTube同期停止
    emitter.emit('youtube: stop sync')

    console.log('[Performance] Playback stopped')
    emitter.emit('render')
  })

  // 一時停止
  emitter.on('performance: pause playback', () => {
    if (!state.performance.isPlaying) return

    if (state.performance.playbackTimerId) {
      clearTimeout(state.performance.playbackTimerId)
      state.performance.playbackTimerId = null
    }

    clearMidiPlaybackTimers()

    if (state.performance.progressIntervalId) {
      clearInterval(state.performance.progressIntervalId)
      state.performance.progressIntervalId = null
    }

    state.performance.isPlaying = false
    state.performance.isPaused = true
    state.performance.pausedAt = Date.now()

    // YouTube一時停止
    emitter.emit('youtube: sync pause')

    console.log('[Performance] Playback paused')
    emitter.emit('render')
  })

  // 再開
  emitter.on('performance: resume playback', () => {
    if (!state.performance.isPaused) return

    const sessionId = state.performance.playbackSessionId
    const session = storage.getSession(sessionId)
    if (!session) return

    // 一時停止していた時間分だけ開始時刻を調整
    const pauseDuration = Date.now() - state.performance.pausedAt
    state.performance.playbackStartTime += pauseDuration

    state.performance.isPlaying = true
    state.performance.isPaused = false

    // YouTube再開
    emitter.emit('youtube: sync resume')

    console.log('[Performance] Playback resumed')
    emitter.emit('render')

    scheduleNextSnapshot(session, emitter, state)

    // 進捗更新インターバルを再開
    state.performance.progressIntervalId = setInterval(() => {
      if (!state.performance.isPlaying) return

      const elapsed = (Date.now() - state.performance.playbackStartTime) * state.performance.playbackSpeed
      const currentTime = state.performance.currentSnapshotTime || 0
      const nextTime = state.performance.nextSnapshotTime || 0
      const interval = nextTime - currentTime

      let progress = 0
      if (interval > 0) {
        const timeIntoInterval = elapsed - currentTime
        progress = Math.min(100, Math.max(0, (timeIntoInterval / interval) * 100))
      }

      state.performance.playbackProgress = progress
      emitter.emit('render')
    }, 50)
  })

  // 再生トグル
  emitter.on('performance: toggle playback', () => {
    if (state.performance.isPlaying) {
      emitter.emit('performance: stop playback')
    } else {
      // 最後のセッションを再生
      const meta = storage.getMeta()
      if (meta.lastSessionId) {
        emitter.emit('performance: start playback', meta.lastSessionId)
      } else {
        console.warn('[Performance] No session to play')
      }
    }
  })

  // 前のスナップショットへ
  // playbackIndex は「次に再生するインデックス」なので、
  // 現在表示中は playbackIndex - 1、その1つ前は playbackIndex - 2
  emitter.on('performance: prev snapshot', () => {
    if (!state.performance.isPlaying && !state.performance.isPaused) return

    const sessionId = state.performance.playbackSessionId
    const session = storage.getSession(sessionId)
    if (!session) return

    // 1つ前のスナップショットのインデックス
    const targetIndex = state.performance.playbackIndex - 2
    if (targetIndex < 0) return

    const snapshot = session.snapshots[targetIndex]

    // MIDIイベント再生
    if (snapshot.midi) {
      clearMidiPlaybackTimers()
      replayMidiEvents(state.midiInput, snapshot.midi, state.performance.playbackSpeed)
    }

    // コードを累積適用（後方ジャンプなので0..targetIndexを順にevalして全バッファを再構築）
    reconstructStateUpTo(session, emitter, state, targetIndex)

    // YouTubeシーク
    if (snapshot.youtubeTime !== undefined) {
      emitter.emit('youtube: sync seek', snapshot.youtubeTime)
    }

    // playbackIndex を更新（次に再生するのは targetIndex + 1）
    state.performance.playbackIndex = targetIndex + 1
    state.performance.playbackProgress = 0

    // timestamp情報を更新
    const prevSnapshot = targetIndex > 0 ? session.snapshots[targetIndex - 1] : null
    const nextSnapshot = session.snapshots[targetIndex + 1]
    state.performance.currentSnapshotTime = prevSnapshot ? prevSnapshot.timestamp : 0
    state.performance.nextSnapshotTime = nextSnapshot ? nextSnapshot.timestamp : snapshot.timestamp

    // 再生中の場合、playbackStartTimeを調整して次のスナップショットをスケジュール
    if (state.performance.isPlaying) {
      state.performance.playbackStartTime = Date.now() - snapshot.timestamp / state.performance.playbackSpeed
      if (state.performance.playbackTimerId) {
        clearTimeout(state.performance.playbackTimerId)
      }
      scheduleNextSnapshot(session, emitter, state)
    }

    console.log(`[Performance] Jumped to snapshot ${targetIndex}`)
    emitter.emit('render')
  })

  // 次のスナップショットへ
  // playbackIndex が指すスナップショットを適用する
  emitter.on('performance: next snapshot', () => {
    if (!state.performance.isPlaying && !state.performance.isPaused) return

    const sessionId = state.performance.playbackSessionId
    const session = storage.getSession(sessionId)
    if (!session) return

    const targetIndex = state.performance.playbackIndex
    if (targetIndex >= session.snapshots.length) return

    const snapshot = session.snapshots[targetIndex]

    // MIDIイベント再生
    if (snapshot.midi) {
      clearMidiPlaybackTimers()
      replayMidiEvents(state.midiInput, snapshot.midi, state.performance.playbackSpeed)
    }

    // コードがあれば評価（前進1ステップなので単一ブロックでよい。累積状態は直前まで構築済み）
    // 再生中の eval は録画バッファに記録しない
    if (snapshot.code) {
      state.performance._replaying = true
      try {
        emitter.emit('repl: eval', snapshot.code)
      } finally {
        state.performance._replaying = false
      }
    }
    // エディタ表示は全文(editor)を復元。無ければ評価ブロックにフォールバック。
    const display = snapshot.editor != null ? snapshot.editor : snapshot.code
    if (display != null) emitter.emit('editor: load code', display)

    // YouTubeシーク
    if (snapshot.youtubeTime !== undefined) {
      emitter.emit('youtube: sync seek', snapshot.youtubeTime)
    }

    // playbackIndex を更新
    state.performance.playbackIndex = targetIndex + 1
    state.performance.playbackProgress = 0

    // timestamp情報を更新
    const nextSnapshot = session.snapshots[targetIndex + 1]
    state.performance.currentSnapshotTime = snapshot.timestamp
    state.performance.nextSnapshotTime = nextSnapshot ? nextSnapshot.timestamp : snapshot.timestamp

    // 再生中の場合、playbackStartTimeを調整して次のスナップショットをスケジュール
    if (state.performance.isPlaying) {
      state.performance.playbackStartTime = Date.now() - snapshot.timestamp / state.performance.playbackSpeed
      if (state.performance.playbackTimerId) {
        clearTimeout(state.performance.playbackTimerId)
      }
      scheduleNextSnapshot(session, emitter, state)
    }

    console.log(`[Performance] Jumped to snapshot ${targetIndex}`)
    emitter.emit('render')
  })

  // 任意のスナップショットへジャンプ
  emitter.on('performance: seek to snapshot', (targetIndex) => {
    if (!state.performance.isPlaying && !state.performance.isPaused) return

    const sessionId = state.performance.playbackSessionId
    const session = storage.getSession(sessionId)
    if (!session) return

    const index = Math.max(0, Math.min(targetIndex, session.snapshots.length - 1))
    const snapshot = session.snapshots[index]

    // MIDIイベント再生
    if (snapshot.midi) {
      clearMidiPlaybackTimers()
      replayMidiEvents(state.midiInput, snapshot.midi, state.performance.playbackSpeed)
    }

    // コードを累積適用（0..index を順に eval して全バッファの状態を再構築）
    reconstructStateUpTo(session, emitter, state, index)

    // YouTubeシーク（YouTube側からのseek時は不要 → 無限ループ防止）
    if (snapshot.youtubeTime !== undefined && !state.performance._seekFromYoutube) {
      emitter.emit('youtube: sync seek', snapshot.youtubeTime)
    }

    state.performance.playbackIndex = index + 1
    state.performance.playbackProgress = 0

    const prevSnapshot = index > 0 ? session.snapshots[index - 1] : null
    const nextSnapshot = session.snapshots[index + 1]
    state.performance.currentSnapshotTime = prevSnapshot ? prevSnapshot.timestamp : 0
    state.performance.nextSnapshotTime = nextSnapshot ? nextSnapshot.timestamp : snapshot.timestamp

    if (state.performance.isPlaying) {
      state.performance.playbackStartTime = Date.now() - snapshot.timestamp / state.performance.playbackSpeed
      if (state.performance.playbackTimerId) {
        clearTimeout(state.performance.playbackTimerId)
      }
      scheduleNextSnapshot(session, emitter, state)
    }

    console.log(`[Performance] Seeked to snapshot ${index}`)
    emitter.emit('render')
  })

  // YouTube時刻から最も近いスナップショットへseek
  emitter.on('performance: seek to youtube time', (youtubeTime) => {
    if (!state.performance.isPlaying && !state.performance.isPaused) return

    const sessionId = state.performance.playbackSessionId
    const session = storage.getSession(sessionId)
    if (!session) return

    // youtubeTimeを持つスナップショットから最も近いものを探す
    let bestIndex = -1
    let bestDiff = Infinity

    for (let i = 0; i < session.snapshots.length; i++) {
      const snap = session.snapshots[i]
      if (snap.youtubeTime === undefined || snap.youtubeTime === null) continue
      const diff = Math.abs(snap.youtubeTime - youtubeTime)
      if (diff < bestDiff) {
        bestDiff = diff
        bestIndex = i
      }
    }

    if (bestIndex === -1) {
      console.warn('[Performance] No snapshot with youtubeTime found')
      return
    }

    // 現在と同じスナップショットなら何もしない
    const currentIndex = state.performance.playbackIndex - 1
    if (bestIndex === currentIndex) return

    console.log(`[Performance] YouTube seek → snapshot ${bestIndex} (youtubeTime: ${session.snapshots[bestIndex].youtubeTime.toFixed(1)}s, target: ${youtubeTime.toFixed(1)}s)`)

    // 既存のseek to snapshotを使用（ただしYouTube sync seekは不要なのでフラグで制御）
    state.performance._seekFromYoutube = true
    emitter.emit('performance: seek to snapshot', bestIndex)
    state.performance._seekFromYoutube = false
  })

  // セッション削除
  emitter.on('performance: delete session', (sessionId) => {
    storage.deleteSession(sessionId)

    const meta = storage.getMeta()
    delete meta.sessions[sessionId]
    if (meta.lastSessionId === sessionId) {
      meta.lastSessionId = null
    }
    storage.saveMeta(meta)

    state.performance.sessions = meta.sessions
    console.log(`[Performance] Session deleted: ${sessionId}`)
    emitter.emit('render')
  })

  // セッション名編集開始
  emitter.on('performance: start editing session', (sessionId) => {
    state.performance.editingSessionId = sessionId
    emitter.emit('render')
    // 次のレンダリング後にinputにフォーカス
    setTimeout(() => {
      const input = document.querySelector('.session-name-input')
      if (input) input.focus()
    }, 0)
  })

  // セッション名編集終了
  emitter.on('performance: stop editing session', () => {
    state.performance.editingSessionId = null
    emitter.emit('render')
  })

  // セッション名変更
  emitter.on('performance: rename session', ({ sessionId, newName }) => {
    // メタデータを更新
    const meta = storage.getMeta()
    if (meta.sessions[sessionId]) {
      meta.sessions[sessionId].name = newName
      storage.saveMeta(meta)
    }

    // セッションデータも更新
    const session = storage.getSession(sessionId)
    if (session) {
      session.name = newName
      storage.saveSession(session)
    }

    state.performance.sessions = meta.sessions
    console.log(`[Performance] Session renamed: ${sessionId} -> ${newName}`)
    emitter.emit('render')
  })

  // セッション再開（既存セッションのスナップショットを自動録画バッファに引き継ぎ）
  emitter.on('performance: resume session', (sessionId) => {
    state.performance._resumedSessionId = sessionId
    const session = storage.getSession(sessionId)
    if (!session) {
      console.warn(`[Performance] Session not found: ${sessionId}`)
      showNotice('⚠ Session data missing — cannot resume')
      return
    }

    // 既存セッションのスナップショットを自動録画バッファに引き継ぎ（eval前に行う）
    const existingDuration = session.duration || 0
    const now = Date.now()

    const buffer = {
      id: session.id,
      name: session.name,
      createdAt: session.createdAt,
      snapshots: session.snapshots || [],
      youtube: session.youtube || null
    }
    // 書けないと以降の録画が丸ごと落ちるので、resume でも成否を見る
    if (!autoBuffer.save(buffer)) showStorageError(REC_ERROR)
    state.performance.autoBufferStartTime = now - existingDuration
    state.performance.snapshotCount = buffer.snapshots.length
    delete state.performance._pendingCodeCheck

    // 最新のコード付きスナップショットをエディタに読み込み・実行
    const lastCodeSnapshot = session.snapshots?.findLast(s => s.code)
    if (lastCodeSnapshot) {
      emitter.emit('editor: load code', lastCodeSnapshot.code)
      emitter.emit('repl: eval', lastCodeSnapshot.code)
    }

    // 元のセッションはそのまま残す（保存時に上書き更新される）

    // セッションリストを閉じる
    state.performance.showSessionList = false

    console.log(`[Performance] Session resumed into auto-buffer: ${sessionId} (${state.performance.snapshotCount} existing snapshots)`)
    emitter.emit('render')
  })

  // セッション一覧取得
  emitter.on('performance: list sessions', () => {
    const meta = storage.getMeta()
    state.performance.sessions = meta.sessions
    emitter.emit('render')
  })

  // セッションリスト表示
  emitter.on('performance: show session list', () => {
    const meta = storage.getMeta()
    state.performance.sessions = meta.sessions
    state.performance.showSessionList = true
    emitter.emit('render')
  })

  // セッションリスト非表示
  emitter.on('performance: hide session list', () => {
    state.performance.showSessionList = false
    emitter.emit('render')
  })

  // セッションリストトグル
  emitter.on('performance: toggle session list', () => {
    if (state.performance.showSessionList) {
      emitter.emit('performance: hide session list')
    } else {
      emitter.emit('performance: show session list')
    }
  })

  // セッションエクスポート
  emitter.on('performance: export session', (sessionId) => {
    const session = storage.getSession(sessionId)
    if (!session) {
      console.warn(`[Performance] Session not found: ${sessionId}`)
      showNotice('⚠ Session data missing — cannot export')
      return
    }

    // nullのプロパティを除外してエクスポート
    const exportData = Object.fromEntries(
      Object.entries(session).filter(([_, v]) => v !== null)
    )
    const data = JSON.stringify(exportData, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hydra-session-${session.name.replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')}.json`
    a.click()
    URL.revokeObjectURL(url)

    console.log(`[Performance] Session exported: ${sessionId}`)
  })

  // セッションインポート
  emitter.on('performance: import session', (sessionData) => {
    if (!sessionData || !sessionData.id || !sessionData.snapshots) {
      console.warn('[Performance] Invalid session data')
      return
    }

    const meta = storage.getMeta()
    const existingSession = meta.sessions[sessionData.id]

    // 既存IDがある場合は上書き確認
    if (existingSession) {
      const overwrite = confirm(
        `同じIDのセッション「${existingSession.name}」が既に存在します。\n上書きしますか？`
      )
      if (!overwrite) {
        console.log('[Performance] Import cancelled by user')
        return
      }
    }

    // 元のIDを維持（新規/上書き共通）
    const importedSession = {
      ...sessionData,
      name: sessionData.name + ' (imported)'
    }

    // durationを計算（セッションデータにない場合はスナップショットから算出）
    let duration = importedSession.duration
    if (!duration && importedSession.snapshots.length > 0) {
      const lastSnapshot = importedSession.snapshots[importedSession.snapshots.length - 1]
      duration = lastSnapshot.timestamp || 0
    }
    importedSession.duration = duration

    // セッションを保存
    storage.saveSession(importedSession)

    // メタデータを更新
    meta.sessions[sessionData.id] = {
      id: sessionData.id,
      name: importedSession.name,
      createdAt: importedSession.createdAt,
      snapshotCount: importedSession.snapshots.length,
      duration: duration || 0
    }
    storage.saveMeta(meta)

    state.performance.sessions = meta.sessions
    console.log(`[Performance] Session imported: ${sessionData.id}`)
    emitter.emit('render')
  })

  // URLからセッションをインポート
  emitter.on('performance: import session from url', async (url) => {
    if (!url) {
      console.warn('[Performance] No session URL provided')
      return
    }

    console.log(`[Performance] Fetching session from: ${url}`)

    try {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`)
      }

      const sessionData = await response.json()
      emitter.emit('performance: import session', sessionData)
      emitter.emit('performance: show session list')
    } catch (err) {
      console.error('[Performance] Failed to fetch session:', err)
      alert(`セッションの取得に失敗しました:\n${err.message}`)
    }
  })
}

// 次のスナップショットをスケジュール
// MIDIイベント再生用タイマーID（停止時にクリアするため保持）
let midiPlaybackTimers = []

function replayMidiEvents(midi, events, speed) {
  if (!midi || !events) return
  for (const evt of events) {
    const [offset, status, d1, d2] = evt
    const id = setTimeout(() => {
      midi._replayEvent(status, d1, d2)
    }, offset / speed)
    midiPlaybackTimers.push(id)
  }
}

function clearMidiPlaybackTimers() {
  midiPlaybackTimers.forEach(id => clearTimeout(id))
  midiPlaybackTimers = []
}

function scheduleNextSnapshot(session, emitter, state) {
  if (!state.performance.isPlaying) return

  const index = state.performance.playbackIndex

  if (index >= session.snapshots.length) {
    // 再生完了
    emitter.emit('performance: stop playback')
    console.log('[Performance] Playback completed')
    return
  }

  const snapshot = session.snapshots[index]
  const prevSnapshot = index > 0 ? session.snapshots[index - 1] : null

  // 進捗計算用のtimestamp情報を保存
  state.performance.currentSnapshotTime = prevSnapshot ? prevSnapshot.timestamp : 0
  state.performance.nextSnapshotTime = snapshot.timestamp

  const elapsed = Date.now() - state.performance.playbackStartTime
  const targetTime = snapshot.timestamp / state.performance.playbackSpeed
  const delay = Math.max(0, targetTime - elapsed)

  // 次スナップショットのMIDIイベントを先行再生
  if (snapshot.midi) {
    clearMidiPlaybackTimers()
    replayMidiEvents(state.midiInput, snapshot.midi, state.performance.playbackSpeed)
  }

  state.performance.playbackTimerId = setTimeout(() => {
    if (!state.performance.isPlaying) return

    // コードがあれば評価（ビジュアル）。再生中の eval は録画バッファに記録しない。
    if (snapshot.code) {
      state.performance._replaying = true
      try {
        emitter.emit('repl: eval', snapshot.code)
      } finally {
        state.performance._replaying = false
      }
    }
    // エディタ表示は全文(editor)を復元。無ければ評価ブロックにフォールバック。
    const display = snapshot.editor != null ? snapshot.editor : snapshot.code
    if (display != null) emitter.emit('editor: load code', display)

    state.performance.playbackIndex++
    scheduleNextSnapshot(session, emitter, state)
  }, delay)
}

// seek/再生開始/backで index 時点の状態を復元する。
//
// 前進再生は評価ブロック(code)を順に当てて状態を積み上げるが、ジャンプ時は
// 履歴を replay せず「その時点のエディタ全文(editor)を丸ごと評価し直す」
// （= eval all 相当）。これにより、エディタが定義する全バッファが 1 回の eval で
// 再構築され、長尺セッションでも seek が軽い。
//   ※ トレードオフ: エディタから削除済みだが裏で生きているバッファは復元されない。
//     また、その時点のエディタに未評価/書きかけのブロックがあれば一緒に走る
//     （eval all を押したのと同じ挙動）。
//   ※ editor 全文が無い旧データは最も近い評価ブロックにフォールバック。
//   ※ _replaying フラグで再生中の eval をライブ録画バッファに記録させない。
function reconstructStateUpTo(session, emitter, state, index) {
  // その時点のエディタ全文（無ければ最も近い評価ブロック）
  let fullCode = null
  for (let i = index; i >= 0; i--) {
    if (session.snapshots[i]?.editor != null) { fullCode = session.snapshots[i].editor; break }
  }
  if (fullCode == null) {
    for (let i = index; i >= 0; i--) {
      if (session.snapshots[i]?.code != null) { fullCode = session.snapshots[i].code; break }
    }
  }
  if (fullCode == null) return

  emitter.emit('editor: load code', fullCode)
  state.performance._replaying = true
  try {
    emitter.emit('repl: eval', fullCode) // 全体評価
  } finally {
    state.performance._replaying = false
  }
}
