const keymap = {
    // 'Ctrl-Enter': 'editor: eval line',
    'Ctrl-/': 'editor:toggleComment',
    // 'Alt-Enter': 'editor:evalBlock',
    // 'Shift-Ctrl-Enter': 'editor: eval all',
    'Shift-Ctrl-f': 'editor: format code',
    'Shift-Ctrl-h': 'ui: hide all',
    // Performance recording
    'Shift-Ctrl-p': 'performance: toggle recording',
    'Shift-Ctrl-m': 'performance: toggle session list'
}

export default (emit) => {
    console.log('[hydra-keymaps] Registering keymaps:', Object.keys(keymap))
    const keymapsArray = Object.entries(keymap).map(([key, val]) => {
        return {
        key: key,
        run: () => {
          console.log(`[hydra-keymaps] Key pressed: ${key} -> ${val}`)
          emit(val)
          return true
        }
      }})
    return keymapsArray
}