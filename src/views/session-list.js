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

  const closeList = () => {
    emit('performance: hide session list')
  }

  const playSession = (sessionId) => {
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
              <div class="session-item" onclick=${() => playSession(session.id)}>
                <div class="session-info">
                  <div class="session-name">${session.name}</div>
                  <div class="session-meta">
                    ${formatDate(session.createdAt)} ·
                    ${session.snapshotCount || 0} snapshots ·
                    ${formatDuration(session.duration)}
                  </div>
                  <div class="session-id" onclick=${e => e.stopPropagation()}>${session.id}</div>
                </div>
                <div class="session-actions">
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
}
