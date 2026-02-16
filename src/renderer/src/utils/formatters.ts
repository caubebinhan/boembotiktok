export const formatFrequency = (campaign: any): string => {
    if (!campaign?.config_json) return 'Manual'
    const config = JSON.parse(campaign.config_json)
    if (!config.schedule) return 'Manual'

    const { interval } = config.schedule
    if (!interval) return 'One-time'

    // Simple formatter, can be expanded
    return `Every ${interval}m`
}

export const formatDateTime = (dateStr: string, timeOnly: boolean = false): string => {
    if (!dateStr) return '-'

    // SQLite returns "YYYY-MM-DD HH:MM:SS" which is UTC but parsed as Local by JS if no 'Z'
    // If it looks like SQLite format, append 'Z'
    const isSQLite = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(dateStr)
    const safeDateStr = isSQLite ? dateStr.replace(' ', 'T') + 'Z' : dateStr

    const date = new Date(safeDateStr)
    if (isNaN(date.getTime())) return '-'

    if (timeOnly) {
        return date.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
    }
    return date.toLocaleTimeString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}
