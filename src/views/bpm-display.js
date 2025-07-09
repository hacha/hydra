import html from 'choo/html'

export default function bpmDisplay(state, emit) {
  if (!state.tapTempo?.isVisible) return html``
  
  const className = state.tapTempo.isFading ? 'fade-out' : ''
  
  return html`
    <div id="bpm-display" class="${className}">
      ${state.tapTempo.bpm} bpm
    </div>
  `
}