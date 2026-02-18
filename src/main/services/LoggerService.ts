import { BrowserWindow, ipcMain } from 'electron'
import { storageService } from './StorageService'

export type LogLevel = 'info' | 'warn' | 'error' | 'debug'

export interface LogEntry {
    id?: number
    level: LogLevel
    message: string
    timestamp: string
    context?: string
}

class LoggerService {
    private debugMode = false

    async init() {
        // Load debug mode setting
        const setting = storageService.get("SELECT value FROM settings WHERE key = 'app.debugMode'")
        this.debugMode = setting?.value === 'true'

        // Listen for setting changes
        ipcMain.handle('logger:set-debug-mode', (_event, enabled: boolean) => {
            this.debugMode = enabled
            this.info('System', `Debug Mode set to ${enabled}`)
            storageService.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('app.debugMode', ?, datetime('now'))", [String(enabled)])
            return true
        })

        // Listen for logs from Renderer
        ipcMain.on('logger:log', (_event, level: LogLevel, message: string, context?: string) => {
            this.log(level, message, context || 'Renderer')
        })
    }

    private log(level: LogLevel, message: string, context?: string) {
        const entry: LogEntry = {
            level,
            message,
            context,
            timestamp: new Date().toISOString()
        }

        // 1. Console Output (Terminal)
        const color = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : '\x1b[36m'
        console.log(`${color}[${level.toUpperCase()}] [${context || 'System'}] ${message}\x1b[0m`)

        // 2. Broadcast to Debug Console (if enabled)
        if (this.debugMode) {
            BrowserWindow.getAllWindows().forEach(win => {
                win.webContents.send('logger:new-entry', entry)
            })
        }

        // 3. Persist to DB (Optional, maybe for errors only or rotating log)
        // For now, we skip heavy DB writing to avoid performance hit, 
        // unless it's an error or we implements a dedicated logs table later.
        if (level === 'error') {
            try {
                // storageService.run(...) 
            } catch { }
        }
    }

    info(message: string, context?: string) { this.log('info', message, context) }
    warn(message: string, context?: string) { this.log('warn', message, context) }
    error(message: string, context?: string) { this.log('error', message, context) }
    debug(message: string, context?: string) {
        if (this.debugMode) this.log('debug', message, context)
    }

    isDebugEnabled() { return this.debugMode }
}

export const logger = new LoggerService()
