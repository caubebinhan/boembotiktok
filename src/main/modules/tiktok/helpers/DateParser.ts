// ─── Date parsing utilities for TikTok ───────────────────────────────────────

export class DateParser {
    /**
     * Extract posting date from TikTok Snowflake video ID.
     * ID >> 32 = Unix Timestamp (seconds)
     */
    static fromVideoId(id: string): Date {
        try {
            const bin = BigInt(id).toString(2)
            const timeBin = bin.slice(0, 32)
            const unixSeconds = parseInt(timeBin, 2)
            return new Date(unixSeconds * 1000)
        } catch (e) {
            console.error('[DateParser] Error parsing date from ID:', id, e)
            return new Date()
        }
    }

    /**
     * Parse relative date text like "2d ago", "3h ago", "5m ago"
     * Used in keyword scan results.
     */
    static parseRelative(text: string): Date {
        const now = new Date()
        if (text.includes('m ago')) now.setMinutes(now.getMinutes() - parseInt(text))
        else if (text.includes('h ago')) now.setHours(now.getHours() - parseInt(text))
        else if (text.includes('d ago')) now.setDate(now.getDate() - parseInt(text))
        else if (text.match(/\d{4}-\d{1,2}-\d{1,2}/)) return new Date(text)
        return now
    }

    /**
     * Parse date strings from TikTok video cards:
     * - "2d ago" / "3h ago" / "5m ago" / "2w ago"
     * - "5-20" (month-day, current year)
     * - ISO date strings
     */
    static parseVideoDate(str: string): Date {
        if (!str) return new Date()
        const now = new Date()

        if (str.includes('ago')) {
            const num = parseInt(str)
            if (str.includes('m')) now.setMinutes(now.getMinutes() - num)
            if (str.includes('h')) now.setHours(now.getHours() - num)
            if (str.includes('d')) now.setDate(now.getDate() - num)
            if (str.includes('w')) now.setDate(now.getDate() - (num * 7))
            return now
        }

        if (str.match(/^\d{1,2}-\d{1,2}$/)) {
            return new Date(`${now.getFullYear()}-${str}`)
        }

        return new Date(str)
    }

    /**
     * Returns true if the date falls within the given range (inclusive).
     * Ignores time component of endDate (matches full day).
     */
    static isInRange(date: Date, startDate: Date | null, endDate: Date | null): boolean {
        if (startDate && date < startDate) return false
        if (endDate) {
            const end = new Date(endDate)
            end.setHours(23, 59, 59, 999)
            if (date > end) return false
        }
        return true
    }
}
