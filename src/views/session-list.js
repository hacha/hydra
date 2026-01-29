import html from 'choo/html'

// 時間フォーマット (ms -> mm:ss)
function formatDuration(ms) {
  if (!ms) return '--:--'
  const sec = Math.floor(ms / 1000)
  const min = Math.floor(sec / 60)
  const s = sec % 60
  return `${min}:${String(s).padStart(2, '0')}`
}

// 日時フォーマット
function formatDate(timestamp) {
  const d = new Date(timestamp)
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export default function sessionList(state, emit) {
  if (!state.performance?.showSessionList) return html``

  const sessions = state.performance.sessions || {}
  const sessionArray = Object.values(sessions).sort((a, b) => b.createdAt - a.createdAt)
  const editingSessionId = state.performance.editingSessionId

  const closeList = () => {
    emit('performance: hide session list')
  }

  const playSession = (sessionId) => {
    if (editingSessionId === sessionId) return
    const url = new URL(window.location.href)
    url.search = `?playback=${sessionId}&start=0&speed=1`
    window.location.href = url.toString()
  }

  const deleteSession = (sessionId, e) => {
    e.stopPropagation()
    if (confirm('このセッションを削除しますか？')) {
      emit('performance: delete session', sessionId)
    }
  }

  const exportSession = (sessionId, e) => {
    e.stopPropagation()
    emit('performance: export session', sessionId)
  }

  const resumeSession = (sessionId, e) => {
    e.stopPropagation()
    const url = new URL(window.location.href)
    url.search = `?resume=${sessionId}`
    window.location.href = url.toString()
  }

  const startEdit = (sessionId, e) => {
    e.stopPropagation()
    emit('performance: start editing session', sessionId)
  }

  const finishEdit = (sessionId, newName, e) => {
    e.stopPropagation()
    const trimmedName = newName.trim()
    if (trimmedName && trimmedName !== sessions[sessionId]?.name) {
      emit('performance: rename session', { sessionId, newName: trimmedName })
    }
    emit('performance: stop editing session')
  }

  const cancelEdit = (e) => {
    e.stopPropagation()
    emit('performance: stop editing session')
  }

  const handleKeyDown = (sessionId, e) => {
    if (e.key === 'Enter') {
      finishEdit(sessionId, e.target.value, e)
    } else if (e.key === 'Escape') {
      cancelEdit(e)
    }
  }

  const renderSessionName = (session) => {
    if (editingSessionId === session.id) {
      return html`
        <input
          type="text"
          class="session-name-input"
          value=${session.name}
          onclick=${e => e.stopPropagation()}
          onkeydown=${e => handleKeyDown(session.id, e)}
          onblur=${e => finishEdit(session.id, e.target.value, e)}
          onfocus=${e => e.target.select()}
        />
      `
    }
    return html`<div class="session-name">${session.name}</div>`
  }

  return html`
    <div id="session-list-overlay" onclick=${closeList}>
      <div id="session-list-modal" onclick=${e => e.stopPropagation()}>
        <div class="session-list-header">
          <h3>Recorded Sessions</h3>
          <button class="close-btn" onclick=${closeList}>×</button>
        </div>
        <div class="session-list-content">
          ${sessionArray.length === 0
            ? html`<p class="no-sessions">No recorded sessions yet.<br>Press Ctrl+Shift+R to start recording.</p>`
            : sessionArray.map(session => html`
              <div class="session-item">
                <div class="session-info">
                  ${renderSessionName(session)}
                  <div class="session-meta">
                    ${formatDate(session.createdAt)} ·
                    ${session.snapshotCount || 0} snapshots ·
                    ${formatDuration(session.duration)}
                  </div>
                  <div class="session-id">${session.id}</div>
                </div>
                <div class="session-actions">
                  <button class="play-btn" onclick=${() => playSession(session.id)} title="Play">▶</button>
                  <button class="resume-btn" onclick=${(e) => resumeSession(session.id, e)} title="Resume recording">●+</button>
                  <button class="edit-btn" onclick=${(e) => startEdit(session.id, e)} title="Rename">✎</button>
                  <button class="export-btn" onclick=${(e) => exportSession(session.id, e)} title="Export">↓</button>
                  <button class="delete-btn" onclick=${(e) => deleteSession(session.id, e)} title="Delete">×</button>
                </div>
              </div>
            `)
          }
        </div>
        <div class="session-list-footer">
          <label class="import-label">
            <input type="file" accept=".json" onchange=${(e) => handleImport(e, emit)} />
            Import Session
          </label>
        </div>
      </div>
    </div>
  `
}

function handleImport(e, emit) {
  const file = e.target.files[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (event) => {
    try {
      const data = JSON.parse(event.target.result)
      emit('performance: import session', data)
    } catch (err) {
      alert('Invalid session file')
    }
  }
  reader.readAsText(file)

  // 同じファイルを再度選択できるようにinputをリセット
  e.target.value = ''
}
