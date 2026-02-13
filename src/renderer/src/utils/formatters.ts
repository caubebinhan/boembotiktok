export const formatFrequency = (campaign: any): string => {
    try {
        if (campaign.type !== 'scheduled') return 'Manual Trigger'
        // Handle both parsed object (if pre-processed) or raw string
        let config = campaign.config_json
        if (typeof config === 'string') {
            config = JSON.parse(config || '{}')
        } else if (!config) {
            config = {}
        }

        const schedule = config.schedule || {}
        const interval = parseInt(schedule.interval) || 15
        const jitter = !!schedule.jitter

        let text = `Every ${interval}m`
        if (interval >= 60) {
            text = `Every ${Math.round(interval / 60 * 10) / 10}h`
        }

        if (jitter) {
            const variance = Math.round(interval * 0.5)
            // If variance is 0 (e.g. 1 min interval -> 0.5 -> 1?), strictly 0.5m = 30s.
            if (interval === 1) text += ` (±30s)`
            else text += ` (±${variance}m)`
        }
        return text
    } catch {
        return 'Every 15m'
    }
}

export const formatDateTime = (isoString?: string): string => {
    if (!isoString) return 'N/A'
    const date = new Date(isoString)
    if (isNaN(date.getTime())) return isoString
    // Format: "Feb 12, 17:23"
    return new Intl.DateTimeFormat('default', {
        month: 'short', day: 'numeric',
        hour: '2-digit', minute: '2-digit',
        hour12: false
    }).format(date)
}
