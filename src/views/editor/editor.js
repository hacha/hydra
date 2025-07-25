/* eslint-disable no-eval */

import CodeMirror from 'codemirror-minified/lib/codemirror'
import 'codemirror-minified/mode/javascript/javascript'
import 'codemirror-minified/addon/hint/javascript-hint'
import 'codemirror-minified/addon/hint/show-hint'
import 'codemirror-minified/addon/selection/mark-selection'
import 'codemirror-minified/addon/comment/comment'

import EventEmitter from 'nanobus'
import keymaps from './keymaps.js'
import Mutator from './randomizer/Mutator.js'
import beautify from 'js-beautify'

var isShowing = true


export default class Editor extends EventEmitter {
  constructor(parent) {
    super()
    console.log("*** Editor class created");
    var self = this

    // var container = document.createElement('div')
    // container.setAttribute('id', 'editor-container')
    // var el = document.createElement('TEXTAREA')
    // document.body.appendChild(container)
    // container.appendChild(el)

    this.mutator = new Mutator(this);

    const extraKeys = {}
    // const evalCode = (code) => {

    // }
    Object.entries(keymaps).forEach(([key, e]) => extraKeys[key] = () => {
      if(e == 'editor: eval block') {
        this.emit('repl: eval', this.getCurrentBlock().text)
      } else if (e == 'editor: eval line') {
        this.emit('repl: eval', this.getLine())
      // } else if (e == 'editor: eval all') {
      //   const code = this.cm.getValue()
      //   this.flashCode()
      //   this.emit('repl: eval', code)
      //   this.emit('gallery: save to URL', code)
      } else if (e == 'editor:toggleComment') {
        this.cm.toggleComment()
      // } else if (e == 'gallery:saveToURL') {
        this.emit(e, this)
      } else if (e === 'editor:formatCode') {
        this.formatCode()
      } else if (e == 'gallery:saveToURL') {
        this.emit('editor: save to URL', this.cm.getValue())
      } else if (e == 'tap-tempo: tap' || e == 'tap-tempo: toggle') {
        this.emit(e)
      } else {
        this.emit(e, this)
      }
    })

    const opts = {
      theme: 'tomorrow-night-eighties',
      value: 'hello',
      mode: { name: 'javascript', globalVars: true },
      lineWrapping: true,
      styleSelectedText: true,
      extraKeys: extraKeys
    }

    this.cm = CodeMirror.fromTextArea(parent, opts)
    window.cm = this.cm
    this.cm.refresh()

    // this.show()
    // // // TO DO: add show code param
    // let searchParams = new URLSearchParams(window.location.search)
    // let showCode = searchParams.get('show-code')

    // if (showCode === "false") {
    //   this.hide()
    // }
  }

  clear() {
    this.cm.setValue('\n \n // Type some code on a new line (such as "osc().out()"), and press CTRL+shift+enter')
  }

  setValue(val) {
    this.cm.setValue(val)
  }

  getValue() {
    return this.cm.getValue()
  }

  formatCode() {
    const formatted = beautify(this.cm.getValue(), { indent_size: 2, "break_chained_methods": true, "indent_with_tabs": true})
    this.cm.setValue(formatted)
  }

  addCodeToTop(code = '') {
    const current = this.cm.getValue()
    const updated = `
${code}

${current}
`
    this.cm.setValue(updated)
  }

  // hide() {
  //   console.log('hiding')
  //   var l = document.getElementsByClassName('CodeMirror')[0]
  //   var m = document.getElementById('modal-header')
  //   l.style.opacity = 0
  //   m.style.opacity = 0
  //   this.isShowing = false
  // }

  // show() {
  //   var l = document.getElementsByClassName('CodeMirror')[0]
  //   var m = document.getElementById('modal-header')
  //   l.style.opacity= 1
  //   m.style.opacity = 1
  //   l.style.pointerEvents = 'all'
  //   this.isShowing = true
  // }

  toggle() {
    if (this.isShowing) {
      this.hide()
    } else {
      this.show()
    }
  }

  getLine() {
    var c = this.cm.getCursor()
    var s = this.cm.getLine(c.line)
    //  this.cm.markText({line: c.line, ch:0}, {line: c.line+1, ch:0}, {className: 'styled-background'})
    this.flashCode({ line: c.line, ch: 0 }, { line: c.line + 1, ch: 0 })
    return s
  }

  flashCode(start, end) {
    if (!start) start = { line: this.cm.firstLine(), ch: 0 }
    if (!end) end = { line: this.cm.lastLine() + 1, ch: 0 }
    var marker = this.cm.markText(start, end, { className: 'styled-background' })
    setTimeout(() => marker.clear(), 300)
  }


  getCurrentBlock() { // thanks to graham wakefield + gibber
    var editor = this.cm
    var pos = editor.getCursor()
    var startline = pos.line
    var endline = pos.line
    while (startline > 0 && editor.getLine(startline) !== '') {
      startline--
    }
    while (endline < editor.lineCount() && editor.getLine(endline) !== '') {
      endline++
    }
    var pos1 = {
      line: startline,
      ch: 0
    }
    var pos2 = {
      line: endline,
      ch: 0
    }
    var str = editor.getRange(pos1, pos2)

    this.flashCode(pos1, pos2)

    return {
      start: pos1,
      end: pos2,
      text: str
    }
  }

}

