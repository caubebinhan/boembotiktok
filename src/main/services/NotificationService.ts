import { Notification } from 'electron'
import { join } from 'path'

class NotificationService {

    notify(options: { title: string; body: string; icon?: string; silent?: boolean }) {
        if (!Notification.isSupported()) {
            console.warn('Notifications not supported on this platform')
            return
        }

        const notification = new Notification({
            title: options.title,
            body: options.body,
            icon: options.icon || join(__dirname, '../../renderer/assets/icon.png'), // Adjust path as needed
            silent: options.silent || false
        })

        notification.show()

        notification.on('click', () => {
            // Future: Focus window or open specific view
            console.log('Notification clicked')
        })
    }

    notifyCampaignComplete(campaignName: string, stats: any) {
        this.notify({
            title: 'Campaign Completed',
            body: `"${campaignName}" finished.\nPublished: ${stats.published}, Failed: ${stats.failed}`,
            silent: false
        })
    }

    notifyJobFailed(campaignName: string, error: string) {
        this.notify({
            title: 'Job Failed',
            body: `In "${campaignName}": ${error}`,
            silent: false // Alert user
        })
    }

    notifyScanComplete(source: string, newVideos: number) {
        if (newVideos > 0) {
            this.notify({
                title: 'New Videos Found',
                body: `Found ${newVideos} new videos from ${source}`,
                silent: true
            })
        }
    }
}

export const notificationService = new NotificationService()
