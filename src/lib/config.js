// Configuration utility for Hydra
// Provides centralized access to configuration values

export const config = {
  // Resolution configuration
  resolution: {
    width: parseInt(VITE_DEFAULT_WIDTH, 10) || 1920,
    height: parseInt(VITE_DEFAULT_HEIGHT, 10) || 1080
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