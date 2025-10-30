import html from 'choo/html'

let animationFrame = null

function updatePreviewCanvases() {
  // Get hydra-synth instance from global scope
  if (typeof window !== 'undefined' && window.hydraSynth) {
    const hydra = window.hydraSynth
    
    // Get output buffers from hydra-synth
    for (let i = 0; i < 4; i++) {
      const canvasId = `preview-o${i}`
      const canvas = document.getElementById(canvasId)
      
      if (canvas && hydra.o && hydra.o[i] && hydra.regl) {
        canvas.width = 160
        canvas.height = 120
        
        const ctx = canvas.getContext('2d')
        
        try {
          // Get the framebuffer from the output
          const fbo = hydra.o[i].getCurrent()
          
          if (fbo) {
            // Read pixels from the framebuffer using regl
            const pixels = hydra.regl.read({
              framebuffer: fbo,
              x: 0,
              y: 0,
              width: fbo.width,
              height: fbo.height
            })
            
            // Create ImageData from the pixels
            const imageData = ctx.createImageData(fbo.width, fbo.height)
            imageData.data.set(pixels)
            
            // Create a temporary canvas
            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = fbo.width
            tempCanvas.height = fbo.height
            const tempCtx = tempCanvas.getContext('2d')
            tempCtx.putImageData(imageData, 0, 0)
            
            // Draw directly without any flipping - regl.read() provides correctly oriented pixels
            ctx.drawImage(tempCanvas, 0, 0, canvas.width, canvas.height)
            
          } else {
            // Fallback: draw a placeholder
            ctx.fillStyle = '#222'
            ctx.fillRect(0, 0, canvas.width, canvas.height)
            ctx.fillStyle = '#666'
            ctx.font = '12px monospace'
            ctx.textAlign = 'center'
            ctx.fillText(`o${i}`, canvas.width/2, canvas.height/2)
          }
        } catch (error) {
          // Fallback: just clear the canvas with a dark color
          ctx.fillStyle = '#111'
          ctx.fillRect(0, 0, canvas.width, canvas.height)
          ctx.fillStyle = '#666'
          ctx.font = '12px monospace'
          ctx.textAlign = 'center'
          ctx.fillText(`o${i}`, canvas.width/2, canvas.height/2)
          console.error('Error rendering preview:', error)
        }
      }
    }
  }
}

function startPreviewUpdate() {
  if (animationFrame) return
  
  function update() {
    updatePreviewCanvases()
    animationFrame = requestAnimationFrame(update)
  }
  
  update()
}

function stopPreviewUpdate() {
  if (animationFrame) {
    cancelAnimationFrame(animationFrame)
    animationFrame = null
  }
}

export default function outputPreview(state, emit) {
  if (!state.showOutputPreview) {
    stopPreviewUpdate()
    return html``
  }

  // Start animation loop when preview is shown
  setTimeout(startPreviewUpdate, 0)

  return html`
    <div id="output-preview" style="
      position: fixed;
      bottom: 20px;
      right: 20px;
      width: 320px;
      height: 240px;
      background: rgba(0, 0, 0, 0.9);
      border: 1px solid #333;
      border-radius: 4px;
      z-index: 1000;
      display: grid;
      grid-template-columns: 1fr 1fr;
      grid-template-rows: 1fr 1fr;
      gap: 2px;
      padding: 4px;
    ">
      <div class="preview-output" style="
        background: #000;
        border: 1px solid #444;
        position: relative;
        overflow: hidden;
      ">
        <canvas id="preview-o0" style="
          width: 100%;
          height: 100%;
          object-fit: contain;
        "></canvas>
        <div style="
          position: absolute;
          top: 2px;
          left: 2px;
          color: white;
          font-size: 10px;
          font-family: monospace;
          background: rgba(0,0,0,0.7);
          padding: 1px 3px;
        ">o0</div>
      </div>

      <div class="preview-output" style="
        background: #000;
        border: 1px solid #444;
        position: relative;
        overflow: hidden;
      ">
        <canvas id="preview-o2" style="
          width: 100%;
          height: 100%;
          object-fit: contain;
        "></canvas>
        <div style="
          position: absolute;
          top: 2px;
          left: 2px;
          color: white;
          font-size: 10px;
          font-family: monospace;
          background: rgba(0,0,0,0.7);
          padding: 1px 3px;
        ">o2</div>
      </div>

      <div class="preview-output" style="
        background: #000;
        border: 1px solid #444;
        position: relative;
        overflow: hidden;
      ">
        <canvas id="preview-o1" style="
          width: 100%;
          height: 100%;
          object-fit: contain;
        "></canvas>
        <div style="
          position: absolute;
          top: 2px;
          left: 2px;
          color: white;
          font-size: 10px;
          font-family: monospace;
          background: rgba(0,0,0,0.7);
          padding: 1px 3px;
        ">o1</div>
      </div>
      
      <div class="preview-output" style="
        background: #000;
        border: 1px solid #444;
        position: relative;
        overflow: hidden;
      ">
        <canvas id="preview-o3" style="
          width: 100%;
          height: 100%;
          object-fit: contain;
        "></canvas>
        <div style="
          position: absolute;
          top: 2px;
          left: 2px;
          color: white;
          font-size: 10px;
          font-family: monospace;
          background: rgba(0,0,0,0.7);
          padding: 1px 3px;
        ">o3</div>
      </div>
    </div>
  `
}