import * as fs from 'fs-extra'
import * as path from 'path'
import { app } from 'electron'

class FileLogger {
    private logPath: string

    constructor() {
        this.logPath = path.join(app.getPath('userData'), 'scan_debug.log')
        // Clear log on startup
        fs.writeFileSync(this.logPath, `[${new Date().toISOString()}] Logger initialized\n`)
    }

    log(message: string, data?: any) {
        const timestamp = new Date().toISOString()
        let logLine = `[${timestamp}] ${message}`
        if (data) {
            try {
                logLine += `\n${JSON.stringify(data, null, 2)}`
            } catch (e) {
                logLine += `\n[Data serialization failed]`
            }
        }
        logLine += '\n'

        try {
            fs.appendFileSync(this.logPath, logLine)
        } catch (e) {
            console.error('Failed to write to file log:', e)
        }
    }
}

export const fileLogger = new FileLogger()
