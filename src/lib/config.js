// Configuration utility for Hydra
// Provides centralized access to configuration values

// Use import.meta.env which is the standard Vite way
const width = import.meta.env.VITE_DEFAULT_WIDTH ? parseInt(import.meta.env.VITE_DEFAULT_WIDTH, 10) : 1920;
const height = import.meta.env.VITE_DEFAULT_HEIGHT ? parseInt(import.meta.env.VITE_DEFAULT_HEIGHT, 10) : 1080;

export const config = {
  // Resolution configuration
  resolution: {
    width: width,
    height: height
  },
  
  // Helper method to get resolution object
  getResolution() {
    return {
      width: this.resolution.width,
      height: this.resolution.height
    }
  },
  
  // Helper method to get resolution as separate values
  getResolutionValues() {
    return [this.resolution.width, this.resolution.height]
  }
}

export default config