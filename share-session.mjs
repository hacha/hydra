// エクスポート済みのパフォーマンスセッション JSON を public gist に上げ、
// そのまま SNS に貼れる共有リンクを組み立てて出力するスクリプト。
//
// 手作業でやっていた以下を 1 コマンドにまとめたもの:
//   1. session を export した JSON を用意
//   2. gist に追加して public 化
//   3. raw の URL を URL エンコード
//   4. https://hacha.github.io/hydra/?session=<3の文字列> を SNS 投稿
//
// リンクだけを stdout に出す(進捗は stderr)ので、パイプでそのまま渡せる:
//   node share-session.mjs hydra-session-foo.json | pbcopy
//
// 前提: gh CLI が 'gist' スコープ付きで認証済みであること (gh auth status)
import { readFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

const DEFAULT_BASE = 'https://hacha.github.io/hydra/'

const USAGE = `usage: node share-session.mjs <session.json> [options]

options:
  -d, --desc <text>   gist の説明 (デフォルト: セッション名から自動生成)
  -n, --name <file>   gist 上でのファイル名 (デフォルト: 入力ファイル名)
  -b, --base <url>    公開先のベース URL (デフォルト: ${DEFAULT_BASE})
      --latest        コミット SHA 固定ではなく最新追従の raw URL を使う
                      (gist を後から編集してもリンクが古いままにならない代わりに、
                       共有後の編集が視聴者側にも反映される)
      --dry-run       gist を作らず、検証だけ行う
  -h, --help          このヘルプを表示`

function fail(msg) {
  console.error(msg)
  process.exit(1)
}

// --- 引数パース ---
const opts = { desc: null, name: null, base: DEFAULT_BASE, latest: false, dryRun: false }
let inPath = null

const argv = process.argv.slice(2)
for (let i = 0; i < argv.length; i++) {
  const a = argv[i]
  const next = () => {
    const v = argv[++i]
    if (v === undefined) fail(`${a} には値が必要です\n\n${USAGE}`)
    return v
  }
  switch (a) {
    case '-h': case '--help': console.log(USAGE); process.exit(0)
    case '-d': case '--desc': opts.desc = next(); break
    case '-n': case '--name': opts.name = next(); break
    case '-b': case '--base': opts.base = next(); break
    case '--latest': opts.latest = true; break
    case '--dry-run': opts.dryRun = true; break
    default:
      if (a.startsWith('-')) fail(`不明なオプション: ${a}\n\n${USAGE}`)
      if (inPath) fail(`JSON ファイルは 1 つだけ指定してください\n\n${USAGE}`)
      inPath = a
  }
}
if (!inPath) fail(USAGE)

// --- gist に上げる前に中身を検証する ---
// 再生側 (src/stores/performance-store.js の 'performance: import session') は
// id と snapshots が無いセッションを黙って捨てるため、公開してから気づくのを防ぐ。
let session
try {
  session = JSON.parse(readFileSync(inPath, 'utf8'))
} catch (e) {
  fail(`JSON として読めませんでした: ${inPath}\n${e.message}`)
}
if (!session || typeof session !== 'object') fail('セッション JSON がオブジェクトではありません')
if (!session.id) fail('セッション JSON に id がありません (再生側が読み込みを拒否します)')
if (!Array.isArray(session.snapshots)) fail('セッション JSON に snapshots 配列がありません (再生側が読み込みを拒否します)')
if (session.snapshots.length === 0) console.error('警告: snapshots が空です')

const gistFileName = opts.name || basename(inPath)
const desc = opts.desc || `hydra session: ${session.name || session.id} (${session.snapshots.length} snapshots)`

console.error(`セッション: ${session.name || '(no name)'} / ${session.snapshots.length} snapshots`)

if (opts.dryRun) {
  console.error(`--dry-run のため gist は作成しません (file: ${gistFileName}, desc: ${desc})`)
  process.exit(0)
}

// --- gist を public で作成 ---
function gh(args) {
  try {
    // stderr は gh の進捗表示なのでそのまま親に流し、stdout だけを受け取る
    return execFileSync('gh', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
  } catch (e) {
    if (e.code === 'ENOENT') fail('gh コマンドが見つかりません (https://cli.github.com/)')
    fail(`gh ${args.join(' ')} に失敗しました\n認証は済んでいますか? -> gh auth status (gist スコープが必要)`)
  }
}

// gist のファイル名 = ローカルのファイル名になるため、--name 指定時は一時ディレクトリに複製する
let uploadPath = inPath
let tmpDir = null
if (gistFileName !== basename(inPath)) {
  tmpDir = mkdtempSync(join(tmpdir(), 'hydra-share-'))
  uploadPath = join(tmpDir, gistFileName)
  copyFileSync(inPath, uploadPath)
}

let gistUrl
try {
  gistUrl = gh(['gist', 'create', '--public', '--desc', desc, uploadPath])
    .split('\n').map(s => s.trim()).filter(Boolean).pop()
} finally {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
}

if (!gistUrl || !gistUrl.startsWith('http')) fail(`gist の URL を取得できませんでした: ${gistUrl}`)
const gistId = gistUrl.split('/').pop()
console.error(`gist: ${gistUrl}`)

// --- raw URL を取得 ---
// API が返す raw_url は .../raw/<blob sha>/<file> という SHA 固定形式(gist ページの Raw ボタンと同じ)
let rawUrl = gh(['api', `gists/${gistId}`, '--jq', `.files["${gistFileName}"].raw_url`]).trim()
if (!rawUrl || rawUrl === 'null') fail(`raw URL を取得できませんでした (${gistFileName})`)

if (opts.latest) {
  // .../raw/<sha>/<file> -> .../raw/<file> (常に最新リビジョンを指す)
  const stripped = rawUrl.replace(/\/raw\/[0-9a-f]{40}\//, '/raw/')
  // 形式が変わって置換できなかった場合、SHA 固定のまま黙って返すと
  // --latest を指定したつもりのリンクが実際には固定リンクになってしまうので落とす
  if (stripped === rawUrl) fail(`--latest: raw URL から SHA を取り除けませんでした: ${rawUrl}`)
  rawUrl = stripped
}
console.error(`raw: ${rawUrl}`)

// --- 共有リンクを組み立てて stdout へ ---
const base = opts.base.replace(/[?&]$/, '')
const sep = base.includes('?') ? '&' : '?'
console.log(`${base}${sep}session=${encodeURIComponent(rawUrl)}`)
