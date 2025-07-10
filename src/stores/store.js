import repl from './repl-v2.js'
// console.log('ENVIRONMENT IS', process.env.NODE_ENV)

// MIDI Input class for handling MIDI devices
class MidiInput {
  constructor() {
    this.note = new Array(128).fill(0) // MIDI note values (0-127)
    this.cc = new Array(128).fill(0)   // Control Change values (0-127)
    this.pitch = 0                     // Pitch bend value (-1 to 1)
    this.velocity = new Array(128).fill(0) // Note velocity values (0-127)
    this.isConnected = false
    this.devices = []
    this.inputs = []
    this.outputs = []
    this.activeNotes = new Set()
    
    // Initialize WebMIDI if available
    this.init()
  }
  
  async init() {
    try {
      if (navigator.requestMIDIAccess) {
        const midiAccess = await navigator.requestMIDIAccess()
        this.midiAccess = midiAccess
        this.setupMIDIDevices()
        this.isConnected = true
        
        // Listen for device connection/disconnection
        midiAccess.addEventListener('statechange', (e) => {
          this.setupMIDIDevices()
        })
        
        console.log('MIDI initialized successfully')
      } else {
        console.warn('WebMIDI API not supported in this browser')
      }
    } catch (error) {
      console.error('Failed to initialize MIDI:', error)
    }
  }
  
  setupMIDIDevices() {
    if (!this.midiAccess) return
    
    this.inputs = Array.from(this.midiAccess.inputs.values())
    this.outputs = Array.from(this.midiAccess.outputs.values())
    this.devices = [...this.inputs, ...this.outputs]
    
    // Setup input listeners
    this.inputs.forEach(input => {
      input.addEventListener('midimessage', (e) => {
        this.handleMIDIMessage(e)
      })
    })
    
    console.log(`MIDI devices: ${this.inputs.length} inputs, ${this.outputs.length} outputs`)
  }
  
  handleMIDIMessage(event) {
    const [status, note, velocity] = event.data
    const command = status >> 4
    const channel = status & 0x0f
    
    switch (command) {
      case 9: // Note On
        if (velocity > 0) {
          this.note[note] = velocity / 127
          this.velocity[note] = velocity / 127
          this.activeNotes.add(note)
        } else {
          // Note on with velocity 0 is note off
          this.note[note] = 0
          this.velocity[note] = 0
          this.activeNotes.delete(note)
        }
        break
        
      case 8: // Note Off
        this.note[note] = 0
        this.velocity[note] = 0
        this.activeNotes.delete(note)
        break
        
      case 11: // Control Change
        this.cc[note] = velocity / 127
        break
        
      case 14: // Pitch Bend
        // Pitch bend combines note and velocity bytes
        const pitchValue = (velocity << 7) | note
        this.pitch = (pitchValue - 8192) / 8192 // Normalize to -1 to 1
        break
        
      default:
        // Handle other MIDI messages if needed
        break
    }
  }
  
  // Get currently active notes
  getActiveNotes() {
    return Array.from(this.activeNotes)
  }
  
  // Get note value by number
  getNote(noteNumber) {
    return this.note[noteNumber] || 0
  }
  
  // Get CC value by number
  getCC(ccNumber) {
    return this.cc[ccNumber] || 0
  }
  
  // Reset all MIDI values
  reset() {
    this.note.fill(0)
    this.cc.fill(0)
    this.velocity.fill(0)
    this.pitch = 0
    this.activeNotes.clear()
  }
}

// TapTempo class for BPM calculation
class TapTempo {
  constructor() {
    this.taps = []
    this.maxTaps = 8
    this.timeout = 3000 // 3 seconds
    this.bpm = 120
    this.isVisible = false
    this.lastTap = 0
    this.fadeTimeout = null
    this.isFading = false
    this.fadeDelay = 500 // .5 second delay before fade
  }

  addTap() {
    const now = Date.now()
    this.taps.push(now)
    this.lastTap = now
    
    // Remove old taps outside timeout window
    this.taps = this.taps.filter(tap => now - tap < this.timeout)
    
    // Keep only maxTaps recent taps
    if (this.taps.length > this.maxTaps) {
      this.taps = this.taps.slice(-this.maxTaps)
    }
    
    if (this.taps.length >= 2) {
      this.calculateBPM()
    }
    
    this.isVisible = true
    this.isFading = false
  }

  calculateBPM() {
    if (this.taps.length < 2) return
    
    const intervals = []
    for (let i = 1; i < this.taps.length; i++) {
      intervals.push(this.taps[i] - this.taps[i - 1])
    }
    
    const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length
    
    // Ignore unrealistic intervals (< 100ms = 600+ BPM)
    if (avgInterval < 100) return
    
    const calculatedBPM = 60000 / avgInterval
    
    // Clamp BPM to reasonable range
    this.bpm = Math.max(30, Math.min(300, Math.round(calculatedBPM)))
  }

  resetFadeTimeout(emitter) {
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout)
    }
    this.fadeTimeout = setTimeout(() => {
      this.isFading = true
      // Trigger re-render to apply fade class
      if (emitter) emitter.emit('render')
      
      // Hide completely after fade animation
      setTimeout(() => {
        this.isVisible = false
        this.isFading = false
        if (emitter) emitter.emit('render')
      }, 300) // Match CSS transition duration
    }, this.fadeDelay)
  }

  reset() {
    this.taps = []
    this.bpm = 120
    this.isVisible = false
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout)
    }
  }

  toggleVisibility() {
    this.isVisible = !this.isVisible
    if (this.isVisible) {
      this.resetFadeTimeout()
    }
  }
}

export default function store(state, emitter) {
  state.showInfo = false
  state.showUI = true
  state.showExtensions = false
  state.errorMessage = ''
  state.isError = false
  
  // Initialize tap tempo
  state.tapTempo = new TapTempo()
  
  // Initialize MIDI input
  state.midiInput = new MidiInput()

  // if backend gallery endpoint supplied, then enable gallery functionality
  const SERVER_URL = import.meta.env.VITE_SERVER_URL
  state.serverURL = SERVER_URL !== undefined ? SERVER_URL : null

  window._reportError = (err) => {
    state.errorMessage = err.message
    state.isError = true
    emitter.emit('render')
  }

  emitter.on('load and eval code', (code, shouldUpdateURL = true) => {
    emitter.emit('editor: load code', code)
    emitter.emit('repl: eval', code)
    if(shouldUpdateURL) emitter.emit('gallery: save to URL', code)
  })

  emitter.on('repl: eval', (code = '', callback) => {
    repl.eval(code, (info) => {
      state.errorMessage = info.errorMessage
      state.isError = info.isError
      if(callback) callback(info.codeString, info.isError)
      emitter.emit('render')
    })

  })

  emitter.on('screencap', () => {
    screencap()
    const editor = state.editor.editor
    const text = editor.getValue()
    const data = new Blob([text], { type: 'text/plain' });
    const a = document.createElement('a')
    a.style.display = 'none'
    let d = new Date()
    a.download = `hydra-${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}-${d.getHours()}.${d.getMinutes()}.${d.getSeconds()}.js`
    a.href = URL.createObjectURL(data)
    a.click()

    setTimeout(() => {
      window.URL.revokeObjectURL(a.href);
    }, 300);
  })

  function clearAll() {
    const editor = state.editor.editor
    hush()
    speed = 1
    emitter.emit('gallery: clear')
    editor.clear()
  }

  emitter.on('clear all', () => {
    clearAll()
  })


  emitter.on('ui: hide all', function () {
    state.showUI = !state.showUI
    emitter.emit('render')
  })

  emitter.on('ui: toggle info', function (count) {
    if (state.showInfo) {
      // state.showInfo = false
      // state.showExtensions = false
      emitter.emit('ui: hide info')
    } else {
      emitter.emit('ui: show info')
    }
    // state.showInfo = !state.showInfo
    //emitter.emit('render')
  })

  emitter.on('ui: show info', () => {
    state.showInfo = true
    emitter.emit('render')
  })

  emitter.on('ui: hide info', () => {
    state.showInfo = false
    state.showExtensions = false
    emitter.emit('render')
  })

  // emitter.on('hide info', function (count) {
  //   state.showInfo = false
  //   state.showExtensions = false
  //   emitter.emit('render')
  // })

  emitter.on('ui: show extensions', () => {
    state.showExtensions = true
    state.showInfo = true
    emitter.emit('extensions: select category')
    emitter.emit('render')
  })

  emitter.on('ui: hide extensions', () => {
    state.showExtensions = false
    emitter.emit('render')
  })

  // Tap tempo event handlers
  emitter.on('tap-tempo:tap', () => {
    state.tapTempo.addTap()
    state.tapTempo.resetFadeTimeout(emitter)
    emitter.emit('render')
  })

  emitter.on('tap-tempo:toggle', () => {
    state.tapTempo.toggleVisibility()
    emitter.emit('render')
  })

  // emitter.on('mutate sketch', function () {

  // })
}

