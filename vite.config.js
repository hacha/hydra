import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { defineConfig, loadEnv, searchForWorkspaceRoot } from 'vite'
import { createHtmlPlugin } from 'vite-plugin-html'

const projectRoot = path.dirname(fileURLToPath(import.meta.url))
// sibling hydra-synth checkout (../hydra-synth). dev ではあればこちらを優先し、
// 無ければ同梱の public/libs/hydra-synth.js (npm run sync-hydra-synth で更新) を使う。
const localHydraSynthDir = path.resolve(projectRoot, '../hydra-synth/dist')
const localHydraSynthFile = path.join(localHydraSynthDir, 'hydra-synth.js')
const hasLocalHydraSynth = fs.existsSync(localHydraSynthFile)

export default defineConfig(({ mode }) => {
    const isDevelopment = mode === 'development'

    // Default URLs based on environment
    const cdnHydraSynthUrl = 'https://cdn.jsdelivr.net/npm/hydra-synth/dist/hydra-synth.js'
    const defaultHydraSynthUrl = isDevelopment
        ? (hasLocalHydraSynth ? '/@fs/' + localHydraSynthFile.replace(/\\/g, '/').replace(/^\//, '') : '/libs/hydra-synth.js')
        : cdnHydraSynthUrl

    // index.html の %VITE_HYDRA_SYNTH_URL% は Vite が env から置換するので、
    // .env.* で未指定なら上の既定値を env に流し込む (process.env は .env より優先される)
    if (isDevelopment && !process.env.VITE_HYDRA_SYNTH_URL && !loadEnv(mode, projectRoot, 'VITE_').VITE_HYDRA_SYNTH_URL) {
        process.env.VITE_HYDRA_SYNTH_URL = defaultHydraSynthUrl
    }

    const defaultP5Url = isDevelopment
        ? '/libs/p5.min.js'
        : 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.4.0/p5.min.js'

    // VisionBridge は LAN/dev 用途。dev では public/libs の symlink (→ VisionBridge/dist) を参照。
    const defaultVisionBridgeUrl = '/libs/vision-bridge.js'

    const defaultFontUrl = isDevelopment
        ? '/fonts/chivo.css'
        : 'https://fonts.googleapis.com/css?family=Chivo:300,400,700'

    const defaultFaviconUrl = isDevelopment
        ? '/favicon.png'
        : 'https://cdn.glitch.com/597fe374-3d18-46a5-b99c-ceff1f8ffd79%2Ffavicon.png?1530891352785'

    // Default resolution settings
    const defaultWidth = '1920'
    const defaultHeight = '1080'

    return {
        base: isDevelopment ? '' : '/hydra/',
        server: {
            port: parseInt(process.env.VITE_PORT || '5173'),
            strictPort: true,
            host: true,
            fs: {
                allow: [searchForWorkspaceRoot(projectRoot), localHydraSynthDir]
            }
        },
        plugins: [
            createHtmlPlugin({
                minify: true,
                inject: {
                    data: {
                        VITE_HYDRA_SYNTH_URL: process.env.VITE_HYDRA_SYNTH_URL || defaultHydraSynthUrl,
                        VITE_P5_URL: process.env.VITE_P5_URL || defaultP5Url,
                        VITE_VISION_BRIDGE_URL: process.env.VITE_VISION_BRIDGE_URL || defaultVisionBridgeUrl,
                        VITE_FONT_URL: process.env.VITE_FONT_URL || defaultFontUrl,
                        VITE_FAVICON_URL: process.env.VITE_FAVICON_URL || defaultFaviconUrl
                    }
                }
            })
        ],
        define: {
            'process.env': {},
            // Library URLs - can be overridden in .env files
            'VITE_HYDRA_SYNTH_URL': JSON.stringify(process.env.VITE_HYDRA_SYNTH_URL || defaultHydraSynthUrl),
            'VITE_P5_URL': JSON.stringify(process.env.VITE_P5_URL || defaultP5Url),
            'VITE_VISION_BRIDGE_URL': JSON.stringify(process.env.VITE_VISION_BRIDGE_URL || defaultVisionBridgeUrl),
            'VITE_FONT_URL': JSON.stringify(process.env.VITE_FONT_URL || defaultFontUrl),
            'VITE_FAVICON_URL': JSON.stringify(process.env.VITE_FAVICON_URL || defaultFaviconUrl),
            // Resolution settings are now handled by import.meta.env
            // Removing these to avoid confusion with the actual values from .env files
        },
        optimizeDeps: {
            esbuildOptions: {
                define: {
                    global: 'globalThis'
                }
            }
        },
        build: {
            rollupOptions: {
                output: {
                    manualChunks(id) {
                        if (id.includes('node_modules')) {
                            if (id.includes('@codemirror') || id.includes('@lezer') || id.includes('codemirror')) {
                                return 'codemirror'
                            }
                            if (id.includes('i18next')) {
                                return 'i18n'
                            }
                            if (id.includes('socket.io') || id.includes('simple-peer')) {
                                return 'networking'
                            }
                            if (id.includes('js-beautify') || id.includes('acorn')) {
                                return 'utilities'
                            }
                        }
                    }
                }
            }
        }
    }
})