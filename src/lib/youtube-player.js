/**
 * YouTube IFrame Player API Wrapper
 * YouTubeプレーヤーの初期化、制御、状態管理を行うラッパークラス
 */

class YouTubePlayerWrapper {
  constructor() {
    this.player = null
    this.isReady = false
    this.isAPILoaded = false
    this.onReadyCallbacks = []
    this.onStateChangeCallbacks = []
    this.pendingInit = null
  }

  /**
   * YouTube IFrame APIを非同期で読み込む
   * @returns {Promise<void>}
   */
  loadAPI() {
    return new Promise((resolve) => {
      // 既に読み込み済みの場合
      if (window.YT && window.YT.Player) {
        this.isAPILoaded = true
        resolve()
        return
      }

      // 既に読み込み中の場合
      if (this.pendingInit) {
        this.pendingInit.then(resolve)
        return
      }

      this.pendingInit = new Promise((resolveAPI) => {
        const tag = document.createElement('script')
        tag.src = 'https://www.youtube.com/iframe_api'
        const firstScriptTag = document.getElementsByTagName('script')[0]
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag)

        window.onYouTubeIframeAPIReady = () => {
          this.isAPILoaded = true
          resolveAPI()
          resolve()
        }
      })
    })
  }

  /**
   * プレーヤーを初期化する
   * @param {string} containerId - プレーヤーを埋め込むコンテナのID
   * @param {string} videoId - YouTube動画ID
   * @param {Object} options - オプション設定
   * @returns {Promise<YT.Player>}
   */
  async init(containerId, videoId, options = {}) {
    await this.loadAPI()

    // 既存のプレーヤーがあれば破棄
    if (this.player) {
      this.destroy()
    }

    return new Promise((resolve) => {
      this.player = new window.YT.Player(containerId, {
        height: options.height || '200',
        width: options.width || '200',
        videoId: videoId,
        playerVars: {
          autoplay: 0,
          controls: 1,
          modestbranding: 1,
          rel: 0,
          fs: 0, // フルスクリーンボタンを非表示（小さいオーバーレイ用）
          ...options.playerVars
        },
        events: {
          onReady: (event) => {
            this.isReady = true
            this.onReadyCallbacks.forEach(cb => cb(event))
            resolve(this.player)
          },
          onStateChange: (event) => {
            this.onStateChangeCallbacks.forEach(cb => cb(event))
          },
          onError: (event) => {
            console.warn('[YouTube] Player error:', event.data)
          }
        }
      })
    })
  }

  /**
   * 動画を再生
   */
  play() {
    if (this.player && this.isReady) {
      this.player.playVideo()
    }
  }

  /**
   * 動画を一時停止
   */
  pause() {
    if (this.player && this.isReady) {
      this.player.pauseVideo()
    }
  }

  /**
   * 指定位置にシーク
   * @param {number} seconds - シーク先の秒数
   */
  seekTo(seconds) {
    if (this.player && this.isReady) {
      this.player.seekTo(seconds, true)
    }
  }

  /**
   * 現在の再生位置を取得
   * @returns {number} 現在の再生位置（秒）
   */
  getCurrentTime() {
    if (this.player && this.isReady) {
      return this.player.getCurrentTime()
    }
    return 0
  }

  /**
   * 動画の長さを取得
   * @returns {number} 動画の長さ（秒）。広告再生中は広告の長さを返す可能性がある
   */
  getDuration() {
    if (this.player && this.isReady) {
      return this.player.getDuration()
    }
    return 0
  }

  /**
   * プレーヤーの状態を取得
   * @returns {number} PlayerState (-1:未開始, 0:終了, 1:再生中, 2:一時停止, 3:バッファリング, 5:キュー済み)
   */
  getPlayerState() {
    if (this.player && this.isReady) {
      return this.player.getPlayerState()
    }
    return -1
  }

  /**
   * 新しい動画を読み込んで再生
   * @param {string} videoId - YouTube動画ID
   * @param {number} startSeconds - 開始位置（秒）
   */
  loadVideoById(videoId, startSeconds = 0) {
    if (this.player && this.isReady) {
      this.player.loadVideoById(videoId, startSeconds)
    }
  }

  /**
   * 新しい動画を読み込む（再生しない）
   * @param {string} videoId - YouTube動画ID
   * @param {number} startSeconds - 開始位置（秒）
   */
  cueVideoById(videoId, startSeconds = 0) {
    if (this.player && this.isReady) {
      this.player.cueVideoById(videoId, startSeconds)
    }
  }

  /**
   * 準備完了時のコールバックを登録
   * @param {Function} callback
   */
  onReady(callback) {
    this.onReadyCallbacks.push(callback)
    // 既に準備完了の場合は即座に呼び出す
    if (this.isReady) {
      callback({ target: this.player })
    }
  }

  /**
   * 状態変更時のコールバックを登録
   * @param {Function} callback
   */
  onStateChange(callback) {
    this.onStateChangeCallbacks.push(callback)
  }

  /**
   * プレーヤーを破棄
   */
  destroy() {
    if (this.player) {
      try {
        this.player.destroy()
      } catch (e) {
        // プレーヤーが既に破棄されている場合のエラーを無視
      }
      this.player = null
      this.isReady = false
      this.onReadyCallbacks = []
      this.onStateChangeCallbacks = []
    }
  }
}

export default new YouTubePlayerWrapper()
