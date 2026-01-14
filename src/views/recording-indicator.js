import html from 'choo/html'

export default function recordingIndicator(state, emit) {
  const perf = state.performance

  if (!perf?.isRecording && !perf?.isPlaying) return html``

  if (perf.isRecording) {
    return html`
      <div id="recording-indicator" class="recording">
        <span class="rec-dot"></span>
        <span class="count">${perf.snapshotCount}</span>
      </div>
    `
  }

  if (perf.isPlaying) {
    return html`
      <div id="recording-indicator" class="playing">
        <span class="play-icon"></span>
        <span class="count">${perf.playbackIndex}/${perf.playbackTotal || '?'}</span>
      </div>
    `
  }

  return html``
}
