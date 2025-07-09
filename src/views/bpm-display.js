import html from 'choo/html'

export default function bpmDisplay(state, emit) {
  if (!state.tapTempo.isVisible) return html``
  
  return html`
    <div id="bpm-display">
      BPM: ${state.tapTempo.bpm}
    </div>
  `
}