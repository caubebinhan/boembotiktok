import { Page } from 'playwright-core'
import path from 'path'
import fs from 'fs-extra'
import { app } from 'electron'
import { TIKTOK_SELECTORS } from '../constants/selectors'

// ─── Smart Overlay/Modal Cleaner ─────────────────────────────────────────────

export class OverlayHelper {
    constructor(
        private page: Page,
        private onProgress?: (msg: string) => void
    ) { }

    /** Close all visible overlays, modals, and cookie banners */
    async clean(targetSelector?: string): Promise<void> {
        if (this.onProgress) this.onProgress('Checking for overlays...')
        console.log(`[OverlayHelper] Start (Target: ${targetSelector || 'None'})`)

        const safetyTimer = setTimeout(async () => {
            console.log('[OverlayHelper] [WARNING] Timeout reached (10s)! Dumping state...')
            try {
                const ts = Date.now()
                const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
                await fs.ensureDir(debugDir)
                await this.page?.screenshot({ path: path.join(debugDir, `overlay_stuck_${ts}.png`) })
                const html = await this.page?.content() || ''
                await fs.writeFile(path.join(debugDir, `overlay_stuck_${ts}.html`), html)
            } catch { }
        }, 10000)

        try {
            await Promise.race([
                this.closeAllOverlays(),
                new Promise(resolve => setTimeout(resolve, 15000))
            ])
        } catch (e: any) {
            console.log(`[OverlayHelper] Fatal error during cleanup: ${e.message}`)
        } finally {
            clearTimeout(safetyTimer)
            console.log('[OverlayHelper] Finished.')
            if (this.onProgress) this.onProgress('Overlays cleared.')
        }
    }

    private async closeAllOverlays(): Promise<void> {
        for (const sel of TIKTOK_SELECTORS.OVERLAYS) {
            try {
                const btn = await this.page.$(sel)
                if (btn) {
                    const visible = await btn.isVisible()
                    if (visible) {
                        console.log(`[OverlayHelper] Clicking: ${sel}`)
                        await btn.click({ force: true, timeout: 500 }).catch(() => { })
                        await this.page.waitForTimeout(300)
                    }
                }
            } catch { }
        }
        console.log('[OverlayHelper] Sending [Escape] as final fallback.')
        await this.page.keyboard.press('Escape')
    }

    /** Retry an action up to 5 times, cleaning overlays between each attempt */
    async interactWithRetry(action: () => Promise<any>, targetSel: string): Promise<void> {
        for (let i = 0; i < 5; i++) {
            try {
                await this.clean(targetSel)
                await action()
                return
            } catch (e: any) {
                if (i === 4) throw e
                console.log(`[OverlayHelper] Action failed (attempt ${i + 1}), retrying...`)
                await this.page.waitForTimeout(1000)
            }
        }
    }
}
