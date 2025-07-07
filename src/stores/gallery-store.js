import Gallery from './gallery.js'
let sketches

export default function galleryStore(state, emitter) {
    emitter.on('DOMContentLoaded', function () {
   
        sketches = new Gallery((code, sketchFromURL) => {
          // Check if hydra-strudel is ready before evaluating code
          const evalCode = () => {
            emitter.emit('load and eval code', code, false)
            if(sketchFromURL) {
              emitter.emit('ui: hide info')
            } else {
              // emitter.emit('ui: show info')  // モーダルを表示しない
              emitter.emit('ui: hide info')
            }
            emitter.emit('render')
          };
          
          // If code contains strudel functions, wait for initialization
          if (code && (code.includes('strudel') || code.includes('mini') || code.includes('P('))) {
            if (window._hydraStrudelReady) {
              evalCode();
            } else {
              // Wait for hydra-strudel to be ready
              window.addEventListener('hydra-strudel-ready', evalCode, { once: true });
              // Also set a timeout fallback
              setTimeout(() => {
                if (!window._hydraStrudelReady) {
                  console.warn('hydra-strudel initialization timeout, executing code anyway');
                  evalCode();
                }
              }, 3000);
            }
          } else {
            // No strudel functions, execute immediately
            evalCode();
          }
        }, state, emitter)
    
        state.gallery = sketches
        // save to url
        emitter.on('gallery: save to URL', function (code) {
          // let editor = state.editor.editor
          // const editorText = editor.getValue()
          sketches.saveLocally(code)
        })
      })

      // redundant with below
      // emitter.on('gallery:saveToURL', function () {
      //   let editor = state.editor.editor
      //   const editorText = editor.getValue()
      //   sketches.saveLocally(editorText)
      // }) 

      emitter.on('gallery: clear', () => {
        sketches.clear()
      })

      emitter.on('gallery:shareSketch', function () {
        let editor = state.editor.editor
        const editorText = editor.getValue()
        emitter.emit('repl: eval', editorText, (code, error) => {
            if (!error) {
                showConfirmation((name) => {
                  sketches.shareSketch(editorText, state.hydra.hydra, name)
                }, () => { })
              } else {
                console.warn(error)
              }
        })
        // repl.eval(editor.getValue(), (code, error) => {
        //   //  console.log('evaluated', code, error)
         
        // })
      })

      emitter.on('gallery:showExample', () => {
        const editor = state.editor.editor
        emitter.emit('clear all')
        sketches.setRandomSketch()
        emitter.emit('repl: eval', sketches.code)
        editor.setValue(sketches.code)
       // repl.eval(editor.getValue())
      })
}

function showConfirmation(successCallback, terminateCallback) {
  var c = prompt(`

HYDRA SKETCH GALLERY
///////////////////////////////////////

🎨 Add your sketch to the gallery of hydra sketches at https://botsin.space/@hydra. 

✍️ Type your name, mastodon handle, or a short description below, and then press 'OK' to share.

‼️ Make sure you are ready to share - there is no undo button!

💖 Thank you for sharing! You are also warmly invited to join the the live coding server on the fediverse at https://social.toplap.org/.
` 
, '')

  //  console.log('confirm value', c)
  if (c !== null) {
    successCallback(c)
  } else {
    terminateCallback()
  }
}