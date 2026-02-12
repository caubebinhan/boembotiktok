import { contextBridge, ipcRenderer } from 'electron'

// Custom APIs for renderer
const api = {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
    on: (channel: string, callback: (...args: unknown[]) => void) => {
        const subscription = (_event: Electron.IpcRendererEvent, ...args: unknown[]) => callback(...args)
        ipcRenderer.on(channel, subscription)
        return () => {
            ipcRenderer.removeListener(channel, subscription)
        }
    }
}

if (process.contextIsolated) {
    try {
        contextBridge.exposeInMainWorld('api', api)
    } catch (error) {
        console.error(error)
    }
} else {
    // @ts-ignore
    window.api = api
}
