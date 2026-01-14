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

  if (perf.isPlaying) {
    const togglePause = () => emit('performance: pause playback')
    return html`
      <div id="recording-indicator" class="playing clickable" onclick=${togglePause}>
        <span class="pause-icon"></span>
        <span class="count">${perf.playbackIndex}/${perf.playbackTotal || '?'}</span>
      </div>
    `
  }

  if (perf.isPaused) {
    const toggleResume = () => emit('performance: resume playback')
    return html`
      <div id="recording-indicator" class="paused clickable" onclick=${toggleResume}>
        <span class="play-icon"></span>
        <span class="count">${perf.playbackIndex}/${perf.playbackTotal || '?'}</span>
      </div>
    `
  }

  return html``
}
