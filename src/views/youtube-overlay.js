/**
 * YouTube Overlay Component
 * 画面右上に表示されるYouTubeプレーヤーオーバーレイ
 */

import html from 'choo/html'

export default function youtubeOverlay(state, emit) {
  const yt = state.youtube

  // 動画がなく、URL入力も非表示の場合は何も表示しない
  if (!yt?.videoId && !yt?.showUrlInput) {
    return html`<div id="youtube-overlay-placeholder"></div>`
  }

  const handleUrlSubmit = (e) => {
    e.preventDefault()
    const input = e.target.querySelector('input')
    if (input.value.trim()) {
      emit('youtube: load video', input.value.trim())
    }
  }

  const handleClear = (e) => {
    e.stopPropagation()
    emit('youtube: clear')
  }

  const handleClose = (e) => {
    e.stopPropagation()
    emit('youtube: clear')
  }

  // URL入力モード（動画が設定されていない場合）
  if (!yt.videoId) {
    return html`
      <div id="youtube-overlay" class="youtube-input-mode">
        <div class="youtube-header">
          <span>YouTube</span>
          <button class="youtube-close-btn" onclick=${handleClose} title="Close">×</button>
        </div>
        <form class="youtube-url-form" onsubmit=${handleUrlSubmit}>
          <input
            type="text"
            placeholder="YouTube URL or Video ID"
            class="youtube-url-input"
          />
          <button type="submit" class="youtube-load-btn">Load</button>
        </form>
      </div>
    `
  }

  // プレーヤー表示モード
  // YouTube IFrameプレーヤーはコンテナをiframeに置き換えるため、
  // Chooの再レンダリングで上書きされないようにisSameNodeを使用
  const playerContainer = html`<div id="youtube-player-container" style="width: ${yt.size.width}px; height: ${yt.size.height}px;"></div>`
  playerContainer.isSameNode = (target) => target.id === 'youtube-player-container'

  return html`
    <div id="youtube-overlay">
      <div class="youtube-header">
        <span>YouTube ${yt.syncMode === 'recording' ? '● REC' : yt.syncMode === 'playback' ? '▶ SYNC' : ''}</span>
        <button class="youtube-close-btn" onclick=${handleClear} title="Close">×</button>
      </div>
      ${playerContainer}
    </div>
  `
}
