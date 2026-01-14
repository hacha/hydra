/**
 * Performance Recording Store
 * VJパフォーマンスのコード実行履歴を記録・再生する機能
 */

// ローカルストレージのキー
const STORAGE_META_KEY = 'hydra_performance_meta'
const STORAGE_SESSION_PREFIX = 'hydra_perf_'

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

  saveMeta(meta) {
    try {
      localStorage.setItem(STORAGE_META_KEY, JSON.stringify(meta))
    } catch (e) {
      console.error('Failed to save performance meta:', e)
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
    } catch (e) {
      console.error('Failed to save session:', e)
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

export default function performanceStore(state, emitter) {
  // 状態初期化
  state.performance = {
    // 記録状態
    isRecording: false,
    currentSessionId: null,
    recordingStartTime: null,
    snapshotCount: 0,

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
    showSessionList: false
  }

  // 初期化時にメタデータを読み込み
  emitter.on('DOMContentLoaded', () => {
    const meta = storage.getMeta()
    state.performance.sessions = meta.sessions

    // URLパラメータをチェック
    const params = new URLSearchParams(window.location.search)

    if (params.has('record') && params.get('record') === 'true') {
      emitter.emit('performance: start recording')
    }

    if (params.has('playback')) {
      const sessionId = params.get('playback')
      const start = parseInt(params.get('start') || '0', 10)
      const speed = parseFloat(params.get('speed') || '1')
      emitter.emit('performance: start playback', sessionId, start, speed)
    }

    // /sessions/ パスでセッション一覧を表示
    if (window.location.pathname.endsWith('/sessions') || window.location.pathname.endsWith('/sessions/')) {
      emitter.emit('performance: show session list')
    }
  })

  // 記録開始
  emitter.on('performance: start recording', () => {
    if (state.performance.isRecording) return

    const sessionId = generateUUID()
    const now = Date.now()

    state.performance.isRecording = true
    state.performance.currentSessionId = sessionId
    state.performance.recordingStartTime = now
    state.performance.snapshotCount = 0

    // 新しいセッションを作成
    const session = {
      id: sessionId,
      name: `Session ${formatDateTime(now)}`,
      createdAt: now,
      snapshots: []
    }

    storage.saveSession(session)

    // メタデータを更新
    const meta = storage.getMeta()
    meta.sessions[sessionId] = {
      id: sessionId,
      name: session.name,
      createdAt: now,
      snapshotCount: 0
    }
    meta.lastSessionId = sessionId
    storage.saveMeta(meta)

    state.performance.sessions = meta.sessions

    console.log(`[Performance] Recording started: ${sessionId}`)
    emitter.emit('render')
  })

  // 記録停止
  emitter.on('performance: stop recording', () => {
    if (!state.performance.isRecording) return

    const sessionId = state.performance.currentSessionId
    const session = storage.getSession(sessionId)

    if (session) {
      if (session.snapshots.length === 0) {
        // スナップショットが0件なら削除
        storage.deleteSession(sessionId)
        const meta = storage.getMeta()
        delete meta.sessions[sessionId]
        if (meta.lastSessionId === sessionId) {
          meta.lastSessionId = null
        }
        storage.saveMeta(meta)
        state.performance.sessions = meta.sessions
        console.log(`[Performance] Recording cancelled (no snapshots): ${sessionId}`)
      } else {
        // メタデータを更新
        const meta = storage.getMeta()
        if (meta.sessions[sessionId]) {
          meta.sessions[sessionId].snapshotCount = session.snapshots.length
          meta.sessions[sessionId].duration = Date.now() - state.performance.recordingStartTime
          storage.saveMeta(meta)
          state.performance.sessions = meta.sessions
        }
        console.log(`[Performance] Recording stopped: ${sessionId}`)
      }
    }

    state.performance.isRecording = false
    state.performance.currentSessionId = null
    state.performance.recordingStartTime = null

    emitter.emit('render')
  })

  // 記録トグル
  emitter.on('performance: toggle recording', () => {
    if (state.performance.isRecording) {
      emitter.emit('performance: stop recording')
    } else {
      emitter.emit('performance: start recording')
    }
  })

  // スナップショット追加（repl: evalから呼ばれる）
  emitter.on('performance: snapshot', (code) => {
    if (!state.performance.isRecording || !code) return

    const sessionId = state.performance.currentSessionId
    const session = storage.getSession(sessionId)

    if (!session) return

    const timestamp = Date.now() - state.performance.recordingStartTime

    session.snapshots.push({
      timestamp,
      code,
      absoluteTime: Date.now()
    })

    storage.saveSession(session)
    state.performance.snapshotCount = session.snapshots.length

    // メタデータもリアルタイム更新
    const meta = storage.getMeta()
    if (meta.sessions[sessionId]) {
      meta.sessions[sessionId].snapshotCount = session.snapshots.length
      meta.sessions[sessionId].duration = Date.now() - state.performance.recordingStartTime
      storage.saveMeta(meta)
    }

    console.log(`[Performance] Snapshot added: ${timestamp}ms, total: ${session.snapshots.length}`)
  })

  // 再生開始
  emitter.on('performance: start playback', (sessionId, startOffset = 0, speed = 1.0) => {
    if (state.performance.isPlaying) {
      emitter.emit('performance: stop playback')
    }

    const session = storage.getSession(sessionId)
    if (!session || session.snapshots.length === 0) {
      console.warn(`[Performance] Session not found or empty: ${sessionId}`)
      return
    }

    state.performance.isPlaying = true
    state.performance.playbackSessionId = sessionId
    state.performance.playbackSpeed = speed
    state.performance.playbackStartTime = Date.now() - startOffset
    state.performance.playbackTotal = session.snapshots.length

    // startOffsetに基づいて開始インデックスを決定
    let startIndex = 0
    for (let i = 0; i < session.snapshots.length; i++) {
      if (session.snapshots[i].timestamp >= startOffset) {
        startIndex = i
        break
      }
      startIndex = i + 1
    }

    // 開始時に直前のスナップショット（またはsnapshot[0]）を即座に適用
    const initialIndex = startIndex > 0 ? startIndex - 1 : 0
    const initialSnapshot = session.snapshots[initialIndex]
    emitter.emit('editor: load code', initialSnapshot.code)
    emitter.emit('repl: eval', initialSnapshot.code)

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

    if (state.performance.progressIntervalId) {
      clearInterval(state.performance.progressIntervalId)
      state.performance.progressIntervalId = null
    }

    state.performance.isPlaying = false
    state.performance.isPaused = false
    state.performance.playbackSessionId = null
    state.performance.playbackIndex = 0
    state.performance.playbackProgress = 0

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

    if (state.performance.progressIntervalId) {
      clearInterval(state.performance.progressIntervalId)
      state.performance.progressIntervalId = null
    }

    state.performance.isPlaying = false
    state.performance.isPaused = true
    state.performance.pausedAt = Date.now()

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

    // コードを適用
    emitter.emit('editor: load code', snapshot.code)
    emitter.emit('repl: eval', snapshot.code)

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

    // コードを適用
    emitter.emit('editor: load code', snapshot.code)
    emitter.emit('repl: eval', snapshot.code)

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
      return
    }

    const data = JSON.stringify(session, null, 2)
    const blob = new Blob([data], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `hydra-session-${session.name.replace(/[^a-zA-Z0-9]/g, '-')}.json`
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

    // 新しいIDを割り当て（既存セッションとの衝突を避ける）
    const newId = generateUUID()
    const importedSession = {
      ...sessionData,
      id: newId,
      name: sessionData.name + ' (imported)'
    }

    storage.saveSession(importedSession)

    // メタデータを更新
    const meta = storage.getMeta()
    meta.sessions[newId] = {
      id: newId,
      name: importedSession.name,
      createdAt: importedSession.createdAt,
      snapshotCount: importedSession.snapshots.length,
      duration: importedSession.duration || 0
    }
    storage.saveMeta(meta)

    state.performance.sessions = meta.sessions
    console.log(`[Performance] Session imported: ${newId}`)
    emitter.emit('render')
  })
}

// 次のスナップショットをスケジュール
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

  state.performance.playbackTimerId = setTimeout(() => {
    if (!state.performance.isPlaying) return

    // コードをエディタに設定して実行
    emitter.emit('editor: load code', snapshot.code)
    emitter.emit('repl: eval', snapshot.code)

    state.performance.playbackIndex++
    scheduleNextSnapshot(session, emitter, state)
  }, delay)
}
