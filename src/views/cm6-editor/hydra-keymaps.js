const keymap = {
    // 'Ctrl-Enter': 'editor: eval line',
    'Ctrl-/': 'editor:toggleComment',
    // 'Alt-Enter': 'editor:evalBlock',
    // 'Shift-Ctrl-Enter': 'editor: eval all',
    'Shift-Ctrl-f': 'editor: format code',
    'Shift-Ctrl-h': 'ui: hide all',
    // Performance recording
    'Shift-Ctrl-r': 'performance: toggle recording',
    'Shift-Ctrl-p': 'performance: toggle playback',
    'Shift-Ctrl-m': 'performance: toggle session list'
}

export default (emit) => {
    const keymapsArray = Object.entries(keymap).map(([key, val]) => {
        return {
        key: key,
        run: () => { emit(val) }
      }})
    return keymapsArray
}