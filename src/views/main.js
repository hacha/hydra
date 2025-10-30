import html from 'choo/html'
import info from './info.js'
import Hydra from './Hydra.js'
import Editor from './EditorComponent.js'
import bpmDisplay from './bpm-display.js'
import outputPreview from './output-preview.js'
// import Editor from './EditorCm6.js'


export default function mainView(state, emit) {
  return html`
  <body>
    <div id="hydra-ui">
      ${state.cache(Hydra, 'hydra-canvas').render(state, emit)}
      <!---<canvas id="audio-canvas">
      </canvas>--->
    </div>
  ${info(state, emit)}
  ${state.cache(Editor, 'editor').render(state, emit)}
  ${bpmDisplay(state, emit)}
  ${outputPreview(state, emit)}
  </body>
 `
}