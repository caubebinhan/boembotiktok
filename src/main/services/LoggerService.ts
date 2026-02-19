import { BrowserWindow, ipcMain, app, shell } from 'electron'
import * as path from 'path'
import * as fs from 'fs-extra'
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
    private logFilePath: string | null = null

    async init() {
        // 1. Setup session log file
        try {
            const logsDir = path.join(app.getPath('userData'), 'logs')
            await fs.ensureDir(logsDir)

            // Cleanup old logs (keep last 10 sessions)
            const files = await fs.readdir(logsDir)
            if (files.length > 10) {
                const sorted = files.sort()
                for (let i = 0; i < files.length - 10; i++) {
                    await fs.remove(path.join(logsDir, sorted[i]))
                }
            }

            const sessionName = `session_${new Date().toISOString().replace(/[:.]/g, '-')}.log`
            this.logFilePath = path.join(logsDir, sessionName)

            this.info('System', `New log session started: ${sessionName}`)
            this.info('System', `Log file path: ${this.logFilePath}`)
        } catch (e) {
            console.error('Failed to initialize file logger:', e)
        }

        // 2. Load debug mode setting
        const setting = storageService.get("SELECT value FROM settings WHERE key = 'app.debugMode'")
        this.debugMode = setting?.value === 'true'

        // 3. Listen for setting changes
        ipcMain.handle('logger:set-debug-mode', (_event, enabled: boolean) => {
            this.debugMode = enabled
            this.info('System', `Debug Mode set to ${enabled}`)
            storageService.run("INSERT OR REPLACE INTO settings (key, value, updated_at) VALUES ('app.debugMode', ?, datetime('now'))", [String(enabled)])
            return true
        })

        ipcMain.handle('logger:open-folder', () => {
            return this.openLogsFolder()
        })

        // 4. Listen for logs from Renderer
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

        const logString = `[${entry.timestamp}] [${level.toUpperCase()}] [${context || 'System'}] ${message}`

        // 1. Console Output (Terminal)
        const color = level === 'error' ? '\x1b[31m' : level === 'warn' ? '\x1b[33m' : '\x1b[36m'
        process.stdout.write(`${color}${logString}\x1b[0m\n`)

        // 2. File Output
        if (this.logFilePath) {
            try {
                fs.appendFileSync(this.logFilePath, logString + '\n')
            } catch { /* ignore */ }
        }

        // 3. Broadcast to Debug Console (if enabled)
        if (this.debugMode) {
            BrowserWindow.getAllWindows().forEach(win => {
                win.webContents.send('logger:new-entry', entry)
            })
        }
    }

    redirectConsole() {
        const originalLog = console.log.bind(console)
        const originalWarn = console.warn.bind(console)
        const originalError = console.error.bind(console)
        const originalDebug = console.debug.bind(console)

        console.log = (...args: any[]) => {
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
            this.info(msg, 'Console')
            originalLog(...args)
        }
        console.warn = (...args: any[]) => {
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
            this.warn(msg, 'Console')
            originalWarn(...args)
        }
        console.error = (...args: any[]) => {
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
            this.error(msg, 'Console')
            originalError(...args)
        }
        console.debug = (...args: any[]) => {
            const msg = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')
            this.debug(msg, 'Console')
            originalDebug(...args)
        }
    }

    info(message: string, context?: string) { this.log('info', message, context) }
    warn(message: string, context?: string) { this.log('warn', message, context) }
    error(message: string, context?: string) { this.log('error', message, context) }
    debug(message: string, context?: string) {
        if (this.debugMode) this.log('debug', message, context)
    }

    isDebugEnabled() { return this.debugMode }

    async openLogsFolder() {
        const logsDir = path.join(app.getPath('userData'), 'logs')
        await shell.openPath(logsDir)
    }
}

export const logger = new LoggerService()
