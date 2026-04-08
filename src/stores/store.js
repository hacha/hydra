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

    // Looper state
    this._buffer = []              // Ring buffer of timestamped MIDI events
    this._bufferMaxMs = 60000      // 60 seconds max
    this._loops = new Map()        // id → { events, durationMs, timers, interval, quantizeTimer }
    this._lastLoops = new Map()    // id → { events, durationMs } for re-trigger
    this._tapTempo = null          // Reference set after construction

    // Bind handler for proper removal later
    this.boundHandleMIDIMessage = this.handleMIDIMessage.bind(this)

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

    // Clean up existing listeners before setting up new ones
    this.inputs.forEach(input => {
      input.removeEventListener('midimessage', this.boundHandleMIDIMessage)
    })

    this.inputs = Array.from(this.midiAccess.inputs.values())
    this.outputs = Array.from(this.midiAccess.outputs.values())
    this.devices = [...this.inputs, ...this.outputs]

    // Setup input listeners with bound handler
    this.inputs.forEach(input => {
      input.addEventListener('midimessage', this.boundHandleMIDIMessage)
    })

    console.log(`MIDI devices: ${this.inputs.length} inputs, ${this.outputs.length} outputs`)
  }
  
  handleMIDIMessage(event) {
    const [status, note, velocity] = event.data

    // Record to ring buffer
    const now = performance.now()
    this._buffer.push({ t: now, status, d1: note, d2: velocity })
    // Trim buffer to max duration
    const cutoff = now - this._bufferMaxMs
    while (this._buffer.length > 0 && this._buffer[0].t < cutoff) {
      this._buffer.shift()
    }

    // Validate MIDI message data
    if (status === undefined || note === undefined || velocity === undefined) {
      console.warn('Invalid MIDI message: missing data')
      return
    }

    // Validate note and velocity are within valid MIDI range (0-127)
    if (note < 0 || note > 127) {
      console.warn(`Invalid MIDI note value: ${note} (must be 0-127)`)
      return
    }

    if (velocity < 0 || velocity > 127) {
      console.warn(`Invalid MIDI velocity value: ${velocity} (must be 0-127)`)
      return
    }

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
  
  // --- Looper (multi-track) ---

  get looping() { return this._loops.size > 0 }

  // Start a named loop track
  // id: track identifier (e.g. 'ch1', or any string/number)
  // opts: { bars, beatsPerBar, bpm, includeCCs, includeNotes, excludeNotes, quantize }
  loop(id, opts = {}) {
    const {
      bars = 1,
      playBars = null,      // actual loop length in bars (null = same as bars)
      beatsPerBar = 4,
      bpm = null,
      includeCCs = null,    // array of CC numbers to include (null = all)
      includeNotes = null,  // array of note numbers to include (null = all)
      excludeNotes = null,  // array of note numbers to exclude
      quantize = false
    } = opts

    this.stopLoop(id)

    const effectiveBpm = bpm || (this._tapTempo && this._tapTempo.bpm) || 120
    const beatMs = 60000 / effectiveBpm
    const barMs = beatMs * beatsPerBar
    const captureDurationMs = barMs * bars
    let durationMs = barMs * (playBars || bars)

    const ccSet = includeCCs ? new Set(includeCCs) : null
    const noteSet = includeNotes ? new Set(includeNotes) : null
    const excludeSet = excludeNotes ? new Set(excludeNotes) : null

    const now = performance.now()
    const windowStart = now - captureDurationMs
    let events = this._buffer
      .filter(e => {
        if (e.t < windowStart) return false
        const cmd = e.status >> 4
        if (cmd === 11) {
          if (ccSet && !ccSet.has(e.d1)) return false
        }
        if (cmd === 8 || cmd === 9) {
          if (excludeSet && excludeSet.has(e.d1)) return false
          if (noteSet && !noteSet.has(e.d1)) return false
        }
        return true
      })
      .map(e => ({
        offset: e.t - windowStart,
        status: e.status,
        d1: e.d1,
        d2: e.d2
      }))

    let fullEvents = events
    let fullDurationMs = captureDurationMs
    if (events.length === 0) {
      const saved = this._lastLoops.get(id)
      if (saved) {
        fullEvents = saved.fullEvents || saved.events
        fullDurationMs = saved.fullDurationMs || saved.durationMs
        console.log(`midi.loop(${id}): re-trigger (${fullEvents.length} events, ${Math.round(fullDurationMs)}ms)`)
      } else {
        console.log(`midi.loop(${id}): empty loop (${Math.round(durationMs)}ms)`)
      }
    } else {
      console.log(`midi.loop(${id}): capture ${bars} bar(s), play ${playBars || bars} bar(s) @ ${effectiveBpm} BPM, ${events.length} events`)
    }

    // Trim fullEvents to playback duration (tail portion)
    const trimOffset = fullDurationMs - durationMs
    if (trimOffset > 0 && fullEvents.length > 0) {
      events = fullEvents
        .filter(e => e.offset >= trimOffset)
        .map(e => ({ ...e, offset: e.offset - trimOffset }))
    } else {
      events = fullEvents
    }

    const loop = {
      fullEvents, fullDurationMs,
      events, durationMs,
      timers: [], interval: null, quantizeTimer: null
    }
    this._loops.set(id, loop)

    if (quantize && this._tapTempo && this._tapTempo.lastTap) {
      const anchor = this._tapTempo.lastTap
      const elapsed = Date.now() - anchor
      const timeIntoBeat = ((elapsed % beatMs) + beatMs) % beatMs
      let delay = beatMs - timeIntoBeat
      if (delay < 50) delay += beatMs
      console.log(`midi.loop(${id}): quantize wait ${Math.round(delay)}ms`)
      loop.quantizeTimer = setTimeout(() => {
        loop.quantizeTimer = null
        this._startLoop(loop)
      }, delay)
    } else {
      this._startLoop(loop)
    }
  }

  _startLoop(loop) {
    loop.startTime = performance.now()
    this._runCycle(loop)
    loop.interval = setInterval(() => this._runCycle(loop), loop.durationMs)
  }

  _runCycle(loop) {
    loop.timers.forEach(id => clearTimeout(id))
    loop.timers = []
    for (const evt of loop.events) {
      const id = setTimeout(() => {
        this._replayEvent(evt.status, evt.d1, evt.d2)
      }, evt.offset)
      loop.timers.push(id)
    }
  }

  _replayEvent(status, d1, d2) {
    // バッファにも記録（セッション録画がループ再生もキャプチャできるように）
    // ただし再生中は二重記録を防ぐためスキップ
    if (!this._isPlayback) {
      const now = performance.now()
      this._buffer.push({ t: now, status, d1, d2 })
      // バッファのtrimming（handleMIDIMessage以外からも肥大化を防ぐ）
      const cutoff = now - this._bufferMaxMs
      while (this._buffer.length > 0 && this._buffer[0].t < cutoff) {
        this._buffer.shift()
      }
    }

    const command = status >> 4
    switch (command) {
      case 9: // Note On
        if (d2 > 0) {
          this.note[d1] = d2 / 127
          this.velocity[d1] = d2 / 127
          this.activeNotes.add(d1)
        } else {
          this.note[d1] = 0
          this.velocity[d1] = 0
          this.activeNotes.delete(d1)
        }
        break
      case 8: // Note Off
        this.note[d1] = 0
        this.velocity[d1] = 0
        this.activeNotes.delete(d1)
        break
      case 11: // CC
        this.cc[d1] = d2 / 127
        break
      case 14: // Pitch Bend
        const pitchValue = (d2 << 7) | d1
        this.pitch = (pitchValue - 8192) / 8192
        break
    }
  }

  // Change loop length on a running loop (uses tail of fullEvents)
  setLoopLength(id, newDurationMs) {
    const loop = this._loops.get(id)
    if (!loop || !loop.fullEvents) return
    if (!loop.startTime) return // quantize待ち中は触らない
    if (Math.abs(loop.durationMs - newDurationMs) < 1) return // no change

    // Take the tail portion of fullEvents
    const offset = loop.fullDurationMs - newDurationMs
    if (offset >= 0) {
      loop.events = loop.fullEvents
        .filter(e => e.offset >= offset)
        .map(e => ({ ...e, offset: e.offset - offset }))
    } else {
      loop.events = loop.fullEvents.map(e => ({ ...e, offset: e.offset - offset }))
    }
    loop.durationMs = newDurationMs

    // Restart cycle with new timing
    loop.timers.forEach(t => clearTimeout(t))
    if (loop.interval) clearInterval(loop.interval)
    this._startLoop(loop)
  }

  // Stop a specific loop track, or all if no id
  stopLoop(id) {
    if (id === undefined) {
      for (const [key] of this._loops) this.stopLoop(key)
      return
    }
    const loop = this._loops.get(id)
    if (!loop) return
    if (loop.quantizeTimer) clearTimeout(loop.quantizeTimer)
    loop.timers.forEach(t => clearTimeout(t))
    if (loop.interval) clearInterval(loop.interval)
    // Save for re-trigger (full capture preserved)
    if (loop.fullEvents && loop.fullEvents.length > 0) {
      this._lastLoops.set(id, {
        events: loop.events, durationMs: loop.durationMs,
        fullEvents: loop.fullEvents, fullDurationMs: loop.fullDurationMs
      })
    } else if (loop.events && loop.events.length > 0) {
      this._lastLoops.set(id, { events: loop.events, durationMs: loop.durationMs })
    }
    this._loops.delete(id)
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
    this.stopLoop()
    this._buffer = []
    this._lastLoops.clear()
  }

  // Clean up event listeners to prevent memory leaks
  cleanup() {
    this.stopLoop()
    // Remove all MIDI input event listeners
    this.inputs.forEach(input => {
      input.removeEventListener('midimessage', this.boundHandleMIDIMessage)
    })
    console.log('MIDI event listeners cleaned up')
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
    this.manualToggle = false // Track if visibility was manually toggled
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

    // If not manually toggled, show temporarily with auto-fade
    if (!this.manualToggle) {
      this.isVisible = true
      this.isFading = false
    }
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
    // Don't auto-fade if manually toggled
    if (this.manualToggle) {
      return
    }

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
    this.isFading = false
    this.manualToggle = this.isVisible // Set manual toggle mode when visible
    // Clear any pending fade timeout when manually toggling
    if (this.fadeTimeout) {
      clearTimeout(this.fadeTimeout)
      this.fadeTimeout = null
    }
  }
}

// Audio object extension for independent temp show state
function extendAudioObject(audioObj) {
  if (audioObj._isExtended) return // prevent double extension
  audioObj._isExtended = true
  audioObj._isShownByUser = audioObj.isDrawing || false
  audioObj._isTempShown = false

  const originalShow = audioObj.show.bind(audioObj)
  const originalHide = audioObj.hide.bind(audioObj)

  audioObj.show = function() {
    this._isShownByUser = true
    originalShow()
  }

  audioObj.hide = function() {
    this._isShownByUser = false
    if (!this._isTempShown) {
      originalHide()
    }
  }

  audioObj.tempShow = function() {
    this._isTempShown = true
    originalShow()
  }

  audioObj.tempHide = function() {
    this._isTempShown = false
    if (!this._isShownByUser) {
      originalHide()
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
  state.midiInput._tapTempo = state.tapTempo
  
  // Initialize output preview state
  state.showOutputPreview = false

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
    // パフォーマンス記録用スナップショット
    emitter.emit('performance: snapshot', code)

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

  // Keyboard event handlers for Ctrl-V output preview
  let isCtrlPressed = false
  let isVPressed = false
  let isAPressed = false

  function updatePreviewState() {
    const shouldShow = isCtrlPressed && isVPressed
    if (state.showOutputPreview !== shouldShow) {
      state.showOutputPreview = shouldShow
      emitter.emit('render')
    }
  }

  function updateAudioVisualizerState() {
    const shouldTempShow = isCtrlPressed && isAPressed
    const audioObj = window.a || (window.hydraSynth && window.hydraSynth.synth && window.hydraSynth.synth.a)
    if (typeof window !== 'undefined' && audioObj) {
      extendAudioObject(audioObj)
      if (shouldTempShow) {
        audioObj.tempShow()
      } else {
        audioObj.tempHide()
      }
    }
  }

  // Set up global keyboard event listeners
  if (typeof window !== 'undefined') {
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Control') {
        isCtrlPressed = true
        updatePreviewState()
        updateAudioVisualizerState()
      } else if (event.key === 'v' || event.key === 'V') {
        isVPressed = true
        updatePreviewState()
      } else if (event.key === 'a' || event.key === 'A') {
        isAPressed = true
        updateAudioVisualizerState()
        // Prevent default "select all" behavior when Ctrl+A is pressed
        if (isCtrlPressed) {
          event.preventDefault()
        }
      }
    })

    window.addEventListener('keyup', (event) => {
      if (event.key === 'Control') {
        isCtrlPressed = false
        isVPressed = false
        isAPressed = false
        updatePreviewState()
        updateAudioVisualizerState()
      } else if (event.key === 'v' || event.key === 'V') {
        isVPressed = false
        updatePreviewState()
      } else if (event.key === 'a' || event.key === 'A') {
        isAPressed = false
        updateAudioVisualizerState()
      }
    })

    // Reset key states when window loses focus (prevents stuck keys)
    window.addEventListener('blur', () => {
      isCtrlPressed = false
      isVPressed = false
      isAPressed = false
      updatePreviewState()
      updateAudioVisualizerState()
    })

    // Reset key states when page becomes hidden (tab switch, etc.)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        isCtrlPressed = false
        isVPressed = false
        isAPressed = false
        updatePreviewState()
        updateAudioVisualizerState()
      }
    })
  }

  // emitter.on('mutate sketch', function () {

  // })
}

