const keymap = {
    // 'Ctrl-Enter': 'editor: eval line',
    'Ctrl-/': 'editor:toggleComment',
    // 'Alt-Enter': 'editor:evalBlock',
    // 'Shift-Ctrl-Enter': 'editor: eval all',
    'Shift-Ctrl-f': 'editor: format code',
    'Shift-Ctrl-h': 'ui: hide all'
}

export default (emit) => {
    const keymapsArray = Object.entries(keymap).map(([key, val]) => {
        return {
        key: key,
        run: () => { emit(val) }
      }})
    return keymapsArray
}