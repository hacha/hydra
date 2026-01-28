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
    ignoringStateChange: false
  }

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
      // 少し待ってからフラグを解除
      setTimeout(() => {
        state.youtube.ignoringStateChange = false
      }, 100)
    }
  })

  // シーク時の同期
  emitter.on('youtube: sync seek', (youtubeTime) => {
    if (state.youtube.syncMode === 'playback' && youtubeTime !== undefined && youtubeTime !== null) {
      youtubePlayer.seekTo(youtubeTime)
      youtubePlayer.play()
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
    youtubePlayer.destroy()
    state.youtube.isReady = false
    state.youtube.videoId = null
    state.youtube.isVisible = false
    state.youtube.syncMode = 'none'
    emitter.emit('render')
  })
}
