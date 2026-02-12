// Debug: where does require('electron') resolve to?
const electronPath = require.resolve('electron')
console.log('electron resolves to:', electronPath)

// Try getting the electron module directly  
const electron = require('electron')
console.log('electron type:', typeof electron)
console.log('electron value:', String(electron).substring(0, 200))

// Check if we're in the main process
console.log('process.type:', process.type)
console.log('process.versions.electron:', process.versions.electron)
