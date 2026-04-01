import html from 'choo/html'

export default function recordingIndicator(state, emit) {
  const perf = state.performance

  // 保存確認メッセージ表示
  if (perf?.savedMessage) {
    return html`
      <div id="recording-indicator" class="saved">
        <span class="saved-message">${perf.savedMessage}</span>
      </div>
    `
  }

  if (!perf?.isPlaying && !perf?.isPaused) return html``

  const prevSnapshot = () => emit('performance: prev snapshot')
  const nextSnapshot = () => emit('performance: next snapshot')

  // スナップショット間進捗（元の進捗バー用）
  const snapshotProgress = perf.playbackProgress || 0

  // 全体進捗（シークバー用）
  const baseProgress = (perf.playbackIndex - 1) / (perf.playbackTotal || 1)
  const intraProgress = (snapshotProgress / 100) / (perf.playbackTotal || 1)
  const overallProgress = (baseProgress + intraProgress) * 100

  const handleSeek = (e) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const ratio = (e.clientX - rect.left) / rect.width
    const targetIndex = Math.floor(ratio * perf.playbackTotal)
    emit('performance: seek to snapshot', targetIndex)
  }

  if (perf.isPlaying) {
    const togglePause = () => emit('performance: pause playback')

    return html`
      <div id="recording-indicator" class="playback">
        <div class="seekbar" onclick=${handleSeek}>
          <div class="seekbar-progress" style="width: ${overallProgress}%"></div>
        </div>
        <div class="ctrl-btn" onclick=${prevSnapshot}>
          <span class="prev-icon"></span>
        </div>
        <div class="ctrl-main" onclick=${togglePause}>
          <div class="progress-bg" style="width: ${snapshotProgress}%"></div>
          <span class="pause-icon"></span>
          <span class="count">${perf.playbackIndex}/${perf.playbackTotal || '?'}</span>
        </div>
        <div class="ctrl-btn" onclick=${nextSnapshot}>
          <span class="next-icon"></span>
        </div>
      </div>
    `
  }

  if (perf.isPaused) {
    const toggleResume = () => emit('performance: resume playback')

    return html`
      <div id="recording-indicator" class="playback">
        <div class="seekbar" onclick=${handleSeek}>
          <div class="seekbar-progress" style="width: ${overallProgress}%"></div>
        </div>
        <div class="ctrl-btn" onclick=${prevSnapshot}>
          <span class="prev-icon"></span>
        </div>
        <div class="ctrl-main" onclick=${toggleResume}>
          <div class="progress-bg" style="width: ${snapshotProgress}%"></div>
          <span class="play-icon"></span>
          <span class="count">${perf.playbackIndex}/${perf.playbackTotal || '?'}</span>
        </div>
        <div class="ctrl-btn" onclick=${nextSnapshot}>
          <span class="next-icon"></span>
        </div>
      </div>
    `
  }

  return html``
}
