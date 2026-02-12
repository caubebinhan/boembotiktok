console.log("Process Type:", process.type);
console.log("Process Versions:", process.versions);

try {
    const e = require("electron");
    console.log("Require electron type:", typeof e);
} catch (err) {
    console.log("Require electron failed:", err.message);
}

// Check for internal bindings
try {
    console.log("process.electronBinding:", typeof process.electronBinding);
} catch (e) { }

try {
    console.log("process._linkedBinding:", typeof process._linkedBinding);
} catch (e) { }

// Check if 'electron' module is in cache and what it is
try {
    const cleanCache = Object.keys(require.cache).filter(k => k.includes('electron'));
    console.log("Electron relevant cache keys:", cleanCache);
} catch (e) { }
