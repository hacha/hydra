/**
 * YouTube Store
 * YouTube連携の状態管理を行うChoo store
 */

import youtubePlayer from '../lib/youtube-player.js'

/**
 * YouTube URLからVideo IDを抽出
 * @param {string} url - YouTube URL または Video ID
 * @returns {string|null} Video ID または null
 */
function extractVideoId(url) {
  if (!url) return null

  const patterns = [
    // 標準的なURL: https://www.youtube.com/watch?v=VIDEO_ID
    /(?:youtube\.com\/watch\?v=)([a-zA-Z0-9_-]{11})/,
    // 短縮URL: https://youtu.be/VIDEO_ID
    /(?:youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    // 埋め込みURL: https://www.youtube.com/embed/VIDEO_ID
    /(?:youtube\.com\/embed\/)([a-zA-Z0-9_-]{11})/,
    // Video ID直接入力
    /^([a-zA-Z0-9_-]{11})$/
  ]

  for (const pattern of patterns) {
    const match = url.match(pattern)
    if (match) return match[1]
  }

  return null
}

export default function youtubeStore(state, emitter) {
  // YouTube状態変更ハンドラ（双方向同期用）
  const handleStateChange = (event) => {
    const prevState = state.youtube.playerState
    state.youtube.playerState = event.data

    // 無限ループ防止: セッション側からの操作時は無視
    if (state.youtube.ignoringStateChange) {
      return
    }

    // 再生モード中のみ双方向同期
    if (state.youtube.syncMode !== 'playback') {
      return
    }

    // 広告による一時停止中はユーザー操作のpause/resumeを無視
    if (state.youtube.pausedByAd) {
      return
    }

    // YouTube側で一時停止された場合 → セッション再生も一時停止
    if (event.data === 2 && prevState === 1) {
      console.log('[YouTube] Paused by user, pausing session playback')
      emitter.emit('performance: pause playback')
    }

    // YouTube側で再生再開された場合 → セッション再生も再開
    if (event.data === 1 && prevState === 2) {
      console.log('[YouTube] Resumed by user, resuming session playback')
      emitter.emit('performance: resume playback')
    }
  }

  // 状態初期化
  state.youtube = {
    // プレーヤー状態
    isReady: false,
    isVisible: false,
    videoId: null,
    playerState: -1,
    currentTime: 0,

    // UI設定
    position: { top: 10, right: 10 },
    size: { width: 200, height: 200 },

    // 同期用
    syncMode: 'none', // 'none' | 'recording' | 'playback'
    baseTime: null,
    baseYoutubeTime: null,

    // URL入力
    showUrlInput: false,

    // 双方向同期用（無限ループ防止）
    ignoringStateChange: false,

    // YouTube側seekの検知用
    seekDetectionTimerId: null,
    lastPolledTime: null,
    lastPollTimestamp: null,
    ignoringSeek: false,
    videoDuration: 0,

    // 広告による一時停止中フラグ
    pausedByAd: false
  }

  // YouTube側seekの検知ポーリングを開始
  const SEEK_POLL_INTERVAL = 300 // ms
  const SEEK_THRESHOLD = 2.0 // 秒: この差以上ならseekと判定

  function startSeekDetection() {
    stopSeekDetection()
    state.youtube.lastPolledTime = youtubePlayer.getCurrentTime()
    state.youtube.lastPollTimestamp = Date.now()
    // 動画本編のdurationを記録（広告検知用）
    state.youtube.videoDuration = youtubePlayer.getDuration()

    state.youtube.seekDetectionTimerId = setInterval(() => {
      if (!state.youtube.isReady) return
      if (state.youtube.ignoringSeek) return

      // 広告検知: getDuration()が本編と大きく異なる場合は広告再生中
      const currentDuration = youtubePlayer.getDuration()
      const isAdPlaying = state.youtube.videoDuration > 0 && currentDuration > 0 &&
          Math.abs(currentDuration - state.youtube.videoDuration) > 5

      if (isAdPlaying) {
        // 広告開始 → セッション一時停止
        if (!state.youtube.pausedByAd) {
          state.youtube.pausedByAd = true
          console.log(`[YouTube] Ad started (duration: ${state.youtube.videoDuration.toFixed(0)}s → ${currentDuration.toFixed(0)}s), pausing session`)
          state.youtube.ignoringStateChange = true
          emitter.emit('performance: pause playback')
          setTimeout(() => { state.youtube.ignoringStateChange = false }, 100)
        }
        state.youtube.lastPollTimestamp = Date.now()
        return
      }

      // 広告終了 → セッション再開
      if (state.youtube.pausedByAd) {
        state.youtube.pausedByAd = false
        console.log('[YouTube] Ad ended, resuming session')
        // ポーリング基準をリセットしてからセッション再開
        state.youtube.lastPolledTime = youtubePlayer.getCurrentTime()
        state.youtube.lastPollTimestamp = Date.now()
        state.youtube.ignoringStateChange = true
        emitter.emit('performance: resume playback')
        setTimeout(() => { state.youtube.ignoringStateChange = false }, 100)
        return
      }

      // 広告終了後にdurationが戻った場合、記録を更新
      if (currentDuration > 0 && state.youtube.videoDuration === 0) {
        state.youtube.videoDuration = currentDuration
      }

      const currentTime = youtubePlayer.getCurrentTime()
      const now = Date.now()
      const elapsedSec = (now - state.youtube.lastPollTimestamp) / 1000

      // 再生中の場合: 期待される時刻との差でseekを検知
      // 一時停止中の場合: 前回の時刻との差でseekを検知
      const playerState = youtubePlayer.getPlayerState()
      const isPlaying = playerState === 1
      const expectedTime = isPlaying
        ? state.youtube.lastPolledTime + elapsedSec
        : state.youtube.lastPolledTime

      const timeDiff = Math.abs(currentTime - expectedTime)

      if (timeDiff > SEEK_THRESHOLD) {
        // 追加ガード: currentTimeが動画本編の範囲外なら広告の可能性が高い
        if (state.youtube.videoDuration > 0 && currentTime > state.youtube.videoDuration) {
          state.youtube.lastPolledTime = currentTime
          state.youtube.lastPollTimestamp = now
          return
        }
        console.log(`[YouTube] Seek detected: ${expectedTime.toFixed(1)}s → ${currentTime.toFixed(1)}s (diff: ${timeDiff.toFixed(1)}s)`)
        emitter.emit('youtube: on user seek', currentTime)
      }

      state.youtube.lastPolledTime = currentTime
      state.youtube.lastPollTimestamp = now
    }, SEEK_POLL_INTERVAL)
  }

  function stopSeekDetection() {
    if (state.youtube.seekDetectionTimerId) {
      clearInterval(state.youtube.seekDetectionTimerId)
      state.youtube.seekDetectionTimerId = null
    }
    state.youtube.lastPolledTime = null
    state.youtube.lastPollTimestamp = null
  }

  // YouTube側でユーザーがseekした場合 → Hydra側をseek
  emitter.on('youtube: on user seek', (youtubeTime) => {
    if (state.youtube.syncMode !== 'playback') return

    console.log(`[YouTube] Syncing Hydra to YouTube time: ${youtubeTime.toFixed(1)}s`)
    emitter.emit('performance: seek to youtube time', youtubeTime)
  })

  // YouTube URLを設定して動画を読み込み
  emitter.on('youtube: load video', async (url) => {
    const videoId = extractVideoId(url)
    if (!videoId) {
      console.warn('[YouTube] Invalid URL:', url)
      return
    }

    state.youtube.videoId = videoId
    state.youtube.isVisible = true
    state.youtube.showUrlInput = false

    emitter.emit('render')

    // レンダリング後にプレーヤーを初期化（DOMにコンテナが必要）
    const initPlayer = async () => {
      const container = document.getElementById('youtube-player-container')
      if (!container) {
        // コンテナがまだない場合は再試行
        setTimeout(initPlayer, 100)
        return
      }

      try {
        await youtubePlayer.init('youtube-player-container', videoId, {
          width: state.youtube.size.width,
          height: state.youtube.size.height
        })
        state.youtube.isReady = true

        youtubePlayer.onStateChange(handleStateChange)

        console.log('[YouTube] Player initialized')
      } catch (e) {
        console.error('[YouTube] Failed to initialize player:', e)
      }
    }

    setTimeout(initPlayer, 100)
  })

  // 表示トグル（Ctrl+Shift+Y）
  emitter.on('youtube: toggle visibility', () => {
    if (state.youtube.videoId) {
      // 動画がある場合は何もしない（クリアは×ボタンで）
      return
    }
    // 動画がない場合はURL入力を表示/非表示
    state.youtube.showUrlInput = !state.youtube.showUrlInput
    emitter.emit('render')
  })

  // URL入力表示をトグル
  emitter.on('youtube: toggle url input', () => {
    state.youtube.showUrlInput = !state.youtube.showUrlInput
    state.youtube.isVisible = state.youtube.showUrlInput || state.youtube.videoId
    emitter.emit('render')
  })

  // 再生
  emitter.on('youtube: play', () => {
    youtubePlayer.play()
  })

  // 一時停止
  emitter.on('youtube: pause', () => {
    youtubePlayer.pause()
  })

  // シーク
  emitter.on('youtube: seek', (seconds) => {
    youtubePlayer.seekTo(seconds)
  })

  // 現在の再生位置を取得（同期的に返す）
  emitter.on('youtube: get current time', (callback) => {
    if (typeof callback === 'function') {
      callback(youtubePlayer.getCurrentTime())
    }
  })

  // 記録開始時にYouTube状態を同期
  emitter.on('youtube: start sync recording', () => {
    if (!state.youtube.videoId || !state.youtube.isReady) return

    state.youtube.syncMode = 'recording'
    state.youtube.baseTime = Date.now()
    state.youtube.baseYoutubeTime = youtubePlayer.getCurrentTime()
  })

  // 同期停止
  emitter.on('youtube: stop sync', () => {
    state.youtube.syncMode = 'none'
    state.youtube.baseTime = null
    state.youtube.baseYoutubeTime = null
    stopSeekDetection()
  })

  // 再生開始時にYouTube状態を同期
  emitter.on('youtube: start sync playback', async (youtubeInfo) => {
    if (!youtubeInfo?.videoId) return

    state.youtube.videoId = youtubeInfo.videoId
    state.youtube.isVisible = true
    state.youtube.syncMode = 'playback'

    const startTime = youtubeInfo.startTime || 0

    emitter.emit('render')

    // プレーヤーの初期化または動画読み込み
    const initPlayback = async () => {
      const container = document.getElementById('youtube-player-container')
      if (!container && !state.youtube.isReady) {
        // コンテナがまだない場合は再試行
        setTimeout(initPlayback, 100)
        return
      }

      try {
        if (!state.youtube.isReady) {
          await youtubePlayer.init('youtube-player-container', youtubeInfo.videoId, {
            width: state.youtube.size.width,
            height: state.youtube.size.height
          })
          state.youtube.isReady = true

          youtubePlayer.onStateChange(handleStateChange)
        } else {
          youtubePlayer.loadVideoById(youtubeInfo.videoId, startTime)
        }

        youtubePlayer.seekTo(startTime)
        youtubePlayer.play()
        console.log('[YouTube] Playback started at', startTime)

        // seek検知ポーリングを開始
        // 少し待ってから開始（seekTo直後の時刻変動を避ける）
        setTimeout(() => {
          startSeekDetection()
        }, 1000)
      } catch (e) {
        console.error('[YouTube] Failed to start playback:', e)
      }
    }

    setTimeout(initPlayback, 100)
  })

  // 一時停止時の同期（セッション側 → YouTube）
  emitter.on('youtube: sync pause', () => {
    if (state.youtube.syncMode === 'playback') {
      // 無限ループ防止フラグを立てる
      state.youtube.ignoringStateChange = true
      youtubePlayer.pause()
      // 一時停止中もseek検知は継続（一時停止中にユーザーがseekする可能性がある）
      // ただしlastPolledTimeを更新してfalse positiveを防ぐ
      state.youtube.lastPolledTime = youtubePlayer.getCurrentTime()
      state.youtube.lastPollTimestamp = Date.now()
      // 少し待ってからフラグを解除
      setTimeout(() => {
        state.youtube.ignoringStateChange = false
      }, 100)
    }
  })

  // 再開時の同期（セッション側 → YouTube）
  emitter.on('youtube: sync resume', () => {
    if (state.youtube.syncMode === 'playback') {
      // 無限ループ防止フラグを立てる
      state.youtube.ignoringStateChange = true
      youtubePlayer.play()
      // ポーリングのタイミング情報をリセット
      setTimeout(() => {
        state.youtube.lastPolledTime = youtubePlayer.getCurrentTime()
        state.youtube.lastPollTimestamp = Date.now()
        state.youtube.ignoringStateChange = false
      }, 100)
    }
  })

  // シーク時の同期（Hydra側 → YouTube）
  emitter.on('youtube: sync seek', (youtubeTime) => {
    if (state.youtube.syncMode === 'playback' && youtubeTime !== undefined && youtubeTime !== null) {
      // 無限ループ防止: Hydra→YouTube seekをポーリングが検知しないようにする
      state.youtube.ignoringSeek = true
      youtubePlayer.seekTo(youtubeTime)
      youtubePlayer.play()
      // ポーリングのタイミング情報もリセット
      setTimeout(() => {
        state.youtube.lastPolledTime = youtubePlayer.getCurrentTime()
        state.youtube.lastPollTimestamp = Date.now()
        state.youtube.ignoringSeek = false
      }, 500)
    }
  })

  // サイズ変更
  emitter.on('youtube: resize', ({ width, height }) => {
    // 最小サイズ制約（YouTube規約: 200x200）
    state.youtube.size.width = Math.max(200, width)
    state.youtube.size.height = Math.max(200, height)
    emitter.emit('render')
  })

  // 動画をクリア
  emitter.on('youtube: clear', () => {
    stopSeekDetection()
    youtubePlayer.destroy()
    state.youtube.isReady = false
    state.youtube.videoId = null
    state.youtube.isVisible = false
    state.youtube.syncMode = 'none'
    state.youtube.showUrlInput = false
    emitter.emit('render')
  })

  // 破棄
  emitter.on('youtube: destroy', () => {
    stopSeekDetection()
    youtubePlayer.destroy()
    state.youtube.isReady = false
    state.youtube.videoId = null
    state.youtube.isVisible = false
    state.youtube.syncMode = 'none'
    emitter.emit('render')
  })
}
