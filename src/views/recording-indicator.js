import html from 'choo/html'

export default function recordingIndicator(state, emit) {
  const perf = state.performance

  if (!perf?.isRecording && !perf?.isPlaying) return html``

  if (perf.isRecording) {
    return html`
      <div id="recording-indicator" class="recording">
        <span class="rec-dot"></span>
        REC ${perf.snapshotCount}
      </div>
    `
  }

  if (perf.isPlaying) {
    return html`
      <div id="recording-indicator" class="playing">
        <span class="play-icon"></span>
        PLAY
      </div>
    `
  }

  return html``
}
