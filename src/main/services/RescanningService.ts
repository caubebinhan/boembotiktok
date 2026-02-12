import { TikTokModule } from '../modules/tiktok/TikTokModule'
import { moduleManager } from './ModuleManager'
import { storageService } from './StorageService'

class RescanningService {
    private intervalId: NodeJS.Timeout | null = null
    private isRunning = false
    private readonly SCAN_INTERVAL = 60 * 1000 // 1 minute (for verification)

    start() {
        if (this.intervalId) return
        console.log('RescanningService started')
        // Run immediately on start (with a small delay to let app settle)
        setTimeout(() => this.runScanCycle(), 10000)

        this.intervalId = setInterval(() => this.runScanCycle(), this.SCAN_INTERVAL)
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId)
            this.intervalId = null
        }
        this.isRunning = false
    }

    async runScanCycle() {
        if (this.isRunning) return
        this.isRunning = true
        console.log('Starting background scan cycle...')

        try {
            const tiktok = moduleManager.getModule('tiktok') as TikTokModule
            if (!tiktok) {
                console.warn('TikTok module not loaded, skipping scan')
                return
            }

            // 1. Get all sources
            const sources = await tiktok.getSources()

            // 2. Scan Channels
            for (const channel of sources.channels) {
                console.log(`Background scanning channel: ${channel.username}`)
                try {
                    await tiktok.scanProfile(channel.username, true) // true = background mode (auto-scroll, filter, download)

                    // Update history
                    storageService.run(
                        'INSERT INTO scan_history (source_type, source_id, videos_found) VALUES (?, ?, ?)',
                        ['channel', channel.id, 0] // TODO: Return count from scanProfile
                    )
                } catch (err) {
                    console.error(`Failed to scan channel ${channel.username}:`, err)
                }
            }

            // 3. Scan Keywords
            for (const kw of sources.keywords) {
                console.log(`Background scanning keyword: ${kw.keyword}`)
                try {
                    // TODO: Implement scanKeyword in TikTokModule
                    // await tiktok.scanKeyword(kw.keyword, true) 
                } catch (err) {
                    console.error(`Failed to scan keyword ${kw.keyword}:`, err)
                }
            }

        } catch (error) {
            console.error('Error in scan cycle:', error)
        } finally {
            this.isRunning = false
            console.log('Background scan cycle completed')
        }
    }
}

export const rescanningService = new RescanningService()
