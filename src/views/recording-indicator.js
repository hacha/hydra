import html from 'choo/html'

export default function recordingIndicator(state, emit) {
  const perf = state.performance

  if (!perf?.isRecording && !perf?.isPlaying && !perf?.isPaused) return html``

  if (perf.isRecording) {
    return html`
      <div id="recording-indicator" class="recording">
        <span class="rec-dot"></span>
        <span class="count">${perf.snapshotCount}</span>
      </div>
    `
  }

  const prevSnapshot = () => emit('performance: prev snapshot')
  const nextSnapshot = () => emit('performance: next snapshot')
  const progress = perf.playbackProgress || 0

  if (perf.isPlaying) {
    const togglePause = () => emit('performance: pause playback')
    return html`
      <div id="recording-indicator" class="playback">
        <div class="ctrl-btn" onclick=${prevSnapshot}>
          <span class="prev-icon"></span>
        </div>
        <div class="ctrl-main" onclick=${togglePause}>
          <div class="progress-bg" style="width: ${progress}%"></div>
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
        <div class="ctrl-btn" onclick=${prevSnapshot}>
          <span class="prev-icon"></span>
        </div>
        <div class="ctrl-main" onclick=${toggleResume}>
          <div class="progress-bg" style="width: ${progress}%"></div>
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
