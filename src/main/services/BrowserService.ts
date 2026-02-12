import { chromium, Browser, BrowserContext, Page } from 'playwright-core'
import { app } from 'electron'
import path from 'path'
import fs from 'fs-extra'

class BrowserService {
    private browser: Browser | null = null
    private context: BrowserContext | null = null
    private isHeadless: boolean = false

    constructor() { }

    async init(headless: boolean = false): Promise<void> {
        this.isHeadless = headless
        console.log('Initializing BrowserService...')

        try {
            // Try to find executable path or use channel
            // For MVP, we'll try to use the bundled chromium if installed, or system chrome
            // We can iterate on this detection logic later.

            const launchOptions = {
                headless: this.isHeadless,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-infobars',
                    '--window-position=0,0',
                    '--ignore-certificate-errors',
                    '--ignore-certificate-errors-spki-list',
                ]
            }

            try {
                console.log('Attempting to launch Chrome...')
                this.browser = await chromium.launch({
                    ...launchOptions,
                    channel: 'chrome' // Try system Chrome first
                })
            } catch (err) {
                console.warn('Chrome launch failed, trying Edge...', err)
                try {
                    this.browser = await chromium.launch({
                        ...launchOptions,
                        channel: 'msedge' // Fallback to Edge
                    })
                } catch (edgeErr) {
                    console.error('Edge launch failed as well.', edgeErr)
                    throw new Error('No compatible browser found. Please install Chrome or Edge.')
                }
            }

            console.log('Browser launched successfully')

            // Create a persistent context
            const userDataDir = path.join(app.getPath('userData'), 'browser_session')
            await fs.ensureDir(userDataDir)

            this.context = await this.browser.newContext({
                viewport: { width: 1280, height: 800 },
                userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                recordVideo: {
                    dir: path.join(app.getPath('userData'), 'recordings'),
                    size: { width: 1280, height: 800 }
                }
            })

        } catch (error) {
            console.error('Failed to launch browser:', error)
            // TODO: Handle missing browser (prompt user to install or download)
        }
    }

    async newPage(): Promise<Page | null> {
        if (!this.context) {
            console.error('Browser context not initialized')
            return null
        }
        return this.context.newPage()
    }

    async close(): Promise<void> {
        if (this.context) {
            await this.context.close()
            this.context = null
        }
        if (this.browser) {
            await this.browser.close()
            this.browser = null
        }
    }

    isConnected(): boolean {
        return this.browser !== null && this.browser.isConnected()
    }
}

export const browserService = new BrowserService()
