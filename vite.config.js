import { defineConfig } from 'vite'

export default defineConfig({
    //define: { global: {} },
    base: '',
    define: {
        'process.env': {},
        // Default to CDN for production, can be overridden in .env files
        'VITE_HYDRA_SYNTH_URL': JSON.stringify(process.env.VITE_HYDRA_SYNTH_URL || 'https://cdn.jsdelivr.net/npm/hydra-synth/dist/hydra-synth.js'),
        // 'global.window': 'window'
        // global: {}
    },
    optimizeDeps: {
        esbuildOptions: {
            define: {
                global: 'globalThis'
            }
        }
    }
})