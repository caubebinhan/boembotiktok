import { Page } from 'playwright-core'
import path from 'path'
import fs from 'fs-extra'
import { app } from 'electron'
import { TIKTOK_SELECTORS } from '../constants/selectors'
import { OverlayHelper } from '../helpers/OverlayHelper'

// ─── Caption setter for TikTok upload form ────────────────────────────────────

export class CaptionSetter {
    private overlayHelper: OverlayHelper

    constructor(private page: Page, private onProgress?: (msg: string) => void) {
        this.overlayHelper = new OverlayHelper(page, onProgress)
    }

    async setCaption(caption: string): Promise<void> {
        console.log('[CaptionSetter] Setting caption...')
        if (this.onProgress) this.onProgress('Setting video caption...')

        for (const sel of TIKTOK_SELECTORS.UPLOAD.CAPTION_INPUTS) {
            try {
                const editor = await this.page.$(sel)
                if (editor && await editor.isVisible()) {
                    console.log(`[CaptionSetter] Found editor: ${sel}`)
                    if (this.onProgress) this.onProgress('Typing caption...')

                    await this.overlayHelper.interactWithRetry(async () => {
                        await editor!.click()
                        await this.page.waitForTimeout(300)
                        await this.page.keyboard.press('Control+a')
                        await this.page.keyboard.press('Backspace')
                        await this.page.waitForTimeout(200)
                        await this.page.keyboard.type(caption, { delay: 20 })
                    }, sel)

                    console.log(`[CaptionSetter] Caption set via: ${sel}`)
                    return
                }
            } catch (e: any) {
                console.log(`[CaptionSetter] Failed with ${sel}: ${e.message}`)
            }
        }

        // Caption failed — dump debug info
        console.warn('[CaptionSetter] Could not find caption editor. Dumping debug info...')
        try {
            const ts = Date.now()
            const debugDir = path.join(app.getPath('userData'), 'debug_artifacts')
            await fs.ensureDir(debugDir)
            if (!this.page.isClosed()) {
                await fs.writeFile(path.join(debugDir, `caption_fail_${ts}.html`), await this.page.content())
                await this.page.screenshot({ path: path.join(debugDir, `caption_fail_${ts}.png`) })
                console.log(`[CaptionSetter] Debug saved: caption_fail_${ts}`)
            }
        } catch { }
        // Non-fatal: continue without caption
    }
}
