import { defineConfig } from 'vite'

export default defineConfig(({ mode }) => {
    const isDevelopment = mode === 'development'
    
    // Default URLs based on environment
    const defaultHydraSynthUrl = isDevelopment 
        ? '/libs/hydra-synth.js' 
        : 'https://cdn.jsdelivr.net/npm/hydra-synth/dist/hydra-synth.js'
    
    const defaultP5Url = isDevelopment
        ? '/libs/p5.min.js'
        : 'https://cdnjs.cloudflare.com/ajax/libs/p5.js/1.4.0/p5.min.js'
    
    const defaultHydraStrudelUrl = isDevelopment
        ? '/libs/hydra-strudel.js'
        : 'https://cdn.jsdelivr.net/gh/atfornes/Hydra-strudel-extension@latest/hydra-strudel.js'
    
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
        base: '',
        define: {
            'process.env': {},
            // Library URLs - can be overridden in .env files
            'VITE_HYDRA_SYNTH_URL': JSON.stringify(process.env.VITE_HYDRA_SYNTH_URL || defaultHydraSynthUrl),
            'VITE_P5_URL': JSON.stringify(process.env.VITE_P5_URL || defaultP5Url),
            'VITE_HYDRA_STRUDEL_URL': JSON.stringify(process.env.VITE_HYDRA_STRUDEL_URL || defaultHydraStrudelUrl),
            'VITE_FONT_URL': JSON.stringify(process.env.VITE_FONT_URL || defaultFontUrl),
            'VITE_FAVICON_URL': JSON.stringify(process.env.VITE_FAVICON_URL || defaultFaviconUrl),
            // Resolution settings
            'VITE_DEFAULT_WIDTH': JSON.stringify(process.env.VITE_DEFAULT_WIDTH || defaultWidth),
            'VITE_DEFAULT_HEIGHT': JSON.stringify(process.env.VITE_DEFAULT_HEIGHT || defaultHeight),
        },
        optimizeDeps: {
            esbuildOptions: {
                define: {
                    global: 'globalThis'
                }
            }
        }
    }
})