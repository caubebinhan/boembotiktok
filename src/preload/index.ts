import { contextBridge, ipcRenderer } from 'electron'

// Custom APIs for renderer
const api = {
    invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
    openScannerWindow: () => ipcRenderer.invoke('open-scanner-window'),
    openCampaignDetails: (id: number) => ipcRenderer.invoke('open-campaign-details', id),
    log: (level: string, message: string, context?: string) => ipcRenderer.send('logger:log', level, message, context),
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
