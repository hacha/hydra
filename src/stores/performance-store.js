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

    // セッション一覧
    sessions: {}
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
      // メタデータを更新
      const meta = storage.getMeta()
      if (meta.sessions[sessionId]) {
        meta.sessions[sessionId].snapshotCount = session.snapshots.length
        meta.sessions[sessionId].duration = Date.now() - state.performance.recordingStartTime
        storage.saveMeta(meta)
        state.performance.sessions = meta.sessions
      }
    }

    state.performance.isRecording = false
    state.performance.currentSessionId = null
    state.performance.recordingStartTime = null

    console.log(`[Performance] Recording stopped: ${sessionId}`)
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

    // startOffsetに基づいて開始インデックスを決定
    let startIndex = 0
    for (let i = 0; i < session.snapshots.length; i++) {
      if (session.snapshots[i].timestamp >= startOffset) {
        startIndex = i
        break
      }
      startIndex = i + 1
    }
    state.performance.playbackIndex = startIndex

    console.log(`[Performance] Playback started: ${sessionId}, from index ${startIndex}`)
    emitter.emit('render')

    // 再生を開始
    scheduleNextSnapshot(session, emitter, state)
  })

  // 再生停止
  emitter.on('performance: stop playback', () => {
    if (!state.performance.isPlaying) return

    if (state.performance.playbackTimerId) {
      clearTimeout(state.performance.playbackTimerId)
      state.performance.playbackTimerId = null
    }

    state.performance.isPlaying = false
    state.performance.playbackSessionId = null
    state.performance.playbackIndex = 0

    console.log('[Performance] Playback stopped')
    emitter.emit('render')
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
