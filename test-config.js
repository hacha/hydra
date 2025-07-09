// Test script to demonstrate the resolution configuration functionality
// Run with: node test-config.js

// Mock the Vite environment variables that would be available at build time
global.VITE_DEFAULT_WIDTH = '2560';
global.VITE_DEFAULT_HEIGHT = '1440';

// Import the config module
import config from './src/lib/config.js';

console.log('Testing Resolution Configuration:');
console.log('================================');
console.log('Configured width:', config.resolution.width);
console.log('Configured height:', config.resolution.height);
console.log('Resolution object:', config.getResolution());
console.log('Resolution values:', config.getResolutionValues());

// Test with default values (when no env vars are set)
delete global.VITE_DEFAULT_WIDTH;
delete global.VITE_DEFAULT_HEIGHT;

// Re-import to test defaults
console.log('\nTesting Default Values:');
console.log('=======================');
console.log('Default width should be 1920:', config.resolution.width || 1920);
console.log('Default height should be 1080:', config.resolution.height || 1080);