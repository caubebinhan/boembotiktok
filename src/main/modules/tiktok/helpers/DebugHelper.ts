import { Page } from 'playwright-core'
import path from 'path'
import fs from 'fs-extra'
import { app } from 'electron'

// ─── Page debug dump helper ───────────────────────────────────────────────────

export class DebugHelper {
    /**
     * Dump a screenshot + HTML file to the given dir (defaults to 'debug_artifacts').
     * Returns the paths of saved files.
     */
    static async dumpPageState(
        page: Page,
        label: string,
        dir?: string
    ): Promise<{ screenshot: string; html: string }> {
        const ts = Date.now()
        const debugDir = dir || path.join(app.getPath('userData'), 'debug_artifacts')
        await fs.ensureDir(debugDir)

        const safeName = label.replace(/[^a-zA-Z0-9_-]/g, '_')
        const screenshotPath = path.join(debugDir, `${safeName}_${ts}.png`)
        const htmlPath = path.join(debugDir, `${safeName}_${ts}.html`)

        try {
            if (!page.isClosed()) {
                await page.screenshot({ path: screenshotPath, fullPage: true })
                const html = await page.content()
                await fs.writeFile(htmlPath, html, 'utf8')
                console.log(`[DebugHelper] Saved: ${screenshotPath}`)
            }
        } catch (e) {
            console.error('[DebugHelper] Failed to dump page state:', e)
        }

        return { screenshot: screenshotPath, html: htmlPath }
    }

    /**
     * Dump a scan-specific debug snapshot (scan_debug folder).
     */
    static async dumpScanState(
        page: Page,
        username: string
    ): Promise<{ screenshot: string; html: string; log: string }> {
        const debugDir = path.join(app.getPath('userData'), 'scan_debug')
        await fs.ensureDir(debugDir)
        const ts = new Date().toISOString().replace(/[:.]/g, '-')

        const screenshotPath = path.join(debugDir, `scan_${username}_${ts}.png`)
        const htmlPath = path.join(debugDir, `scan_${username}_${ts}.html`)
        const logPath = path.join(debugDir, `scan_${username}_${ts}.log`)

        try {
            await page.screenshot({ path: screenshotPath, fullPage: true })
            const html = await page.content()
            await fs.writeFile(htmlPath, html, 'utf8')

            const logContent = [
                `[${new Date().toISOString()}] scanProfile: @${username}`,
                `URL: ${page.url()}`,
                `Screenshot: ${screenshotPath}`,
                `HTML: ${htmlPath}`,
            ].join('\n')
            await fs.writeFile(logPath, logContent, 'utf8')
            console.log(`[DebugHelper] Scan debug dump saved: ${debugDir}/scan_${username}_${ts}.*`)
        } catch (e) {
            console.warn('[DebugHelper] Scan debug dump failed:', e)
        }

        return { screenshot: screenshotPath, html: htmlPath, log: logPath }
    }
}
