# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Hydra is a browser-based livecoding environment for creating networked visuals, inspired by analog modular synthesizers. It uses multiple framebuffers to allow dynamic mixing, compositing, and collaboration between connected browser-visual-streams.

## Build Commands

```bash
# Development server with hot-reload (runs on http://localhost:5173)
npm run dev

# Production build
npm run build

# Deploy to GitHub Pages
npm run publish
```

## Architecture

### Frontend Framework
- **Choo.js**: Lightweight framework for the main application structure
- State management through stores pattern in `/src/stores/`
- Component-based UI structure in `/src/views/`

### Key Components
- **CodeMirror 6**: Code editor with custom keybindings and themes (`/src/views/cm6-editor/`)
- **hydra-synth**: Core visual synthesis engine (npm module)
- **rtc-patch-bay**: WebRTC networking for collaborative features (`/src/lib/patch-bay/`)
- **P5.js integration**: Available through P5 wrapper (`/src/lib/p5-wrapper.js`)

### State Management
The application uses Choo stores for state management:
- `store.js`: Main application state
- `editor-store.js`: Editor state and code management
- `gallery-store.js`: Gallery and sketch sharing functionality
- `language-store.js`: i18n internationalization support

### Build System
- **Vite**: Modern build tool for development and production builds
- Configuration in `vite.config.js`

## Docker Support

The project includes Docker configurations for both development and production:

```bash
# Development with hot-reload
docker-compose up -d

# Production build
docker-compose --profile prod up -d

# Production with HTTPS
docker-compose --profile prod-https up -d
```

## Key Technologies

- **Visual Synthesis**: hydra-synth library
- **Networking**: WebRTC via rtc-patch-bay, Socket.io for signaling
- **Editor**: CodeMirror 6 with custom extensions
- **Internationalization**: i18next
- **Additional Libraries**: P5.js, acorn (JS parsing), js-beautify (code formatting)

## License

AGPL-3.0