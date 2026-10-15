// ../hydra-synth/dist/hydra-synth.js を public/libs/ にコピーして同梱版を更新する
// 使い方: (hydra-synth 側で npm run build した後) npm run sync-hydra-synth
// --optional: ../hydra-synth が無ければ警告のみで正常終了する (prebuild 用)
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const root = path.dirname(fileURLToPath(import.meta.url))
const src = path.resolve(root, '../hydra-synth/dist/hydra-synth.js')
const dest = path.join(root, 'public/libs/hydra-synth.js')

if (!fs.existsSync(src)) {
  if (process.argv.includes('--optional')) {
    console.warn(`skip: ${src} が無いため同梱版の public/libs/hydra-synth.js をそのまま使います`)
    process.exit(0)
  }
  console.error(`not found: ${src}\nhydra-synth を ../hydra-synth に置いてビルドしてください`)
  process.exit(1)
}

fs.copyFileSync(src, dest)
console.log(`copied ${src} -> ${path.relative(root, dest)} (${fs.statSync(dest).size} bytes)`)
