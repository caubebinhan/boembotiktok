import { storageService } from './StorageService'

export type CampaignStatus =
    | 'active'
    | 'paused'
    | 'scanning'
    | 'monitoring'
    | 'scan_completed'
    | 'needs_captcha'
    | 'needs_review'
    | 'finished'
    | 'archived'

export type CampaignEvent =
    | 'SCAN_STARTED'
    | 'SCAN_COMPLETED_HISTORY'
    | 'SCAN_COMPLETED_CONTINUOUS'
    | 'MONITOR_STARTED'
    | 'ALL_JOBS_DONE'
    | 'CAPTCHA_DETECTED'
    | 'CAPTCHA_RESOLVED'
    | 'MANUAL_PAUSE'
    | 'APP_STARTUP'
    | 'MANUAL_RESUME'
    | 'NEEDS_REVIEW'
    | 'REVIEW_RESOLVED'

const transitions: Record<CampaignStatus, Partial<Record<CampaignEvent, CampaignStatus>>> = {
    active: {
        SCAN_STARTED: 'scanning',
        MONITOR_STARTED: 'monitoring',
        APP_STARTUP: 'paused',
        MANUAL_PAUSE: 'paused',
        CAPTCHA_DETECTED: 'needs_captcha',
        NEEDS_REVIEW: 'needs_review',
        ALL_JOBS_DONE: 'finished',
    },
    scanning: {
        SCAN_COMPLETED_HISTORY: 'active',
        SCAN_COMPLETED_CONTINUOUS: 'monitoring',
        CAPTCHA_DETECTED: 'needs_captcha',
        APP_STARTUP: 'paused',
    },
    monitoring: {
        APP_STARTUP: 'paused',
        MANUAL_PAUSE: 'paused',
        CAPTCHA_DETECTED: 'needs_captcha',
        NEEDS_REVIEW: 'needs_review',
    },
    paused: {
        MANUAL_RESUME: 'active',
    },
    needs_captcha: {
        CAPTCHA_RESOLVED: 'active',
    },
    needs_review: {
        REVIEW_RESOLVED: 'active',
    },
    scan_completed: {
        MANUAL_RESUME: 'active',
    },
    finished: {},
    archived: {},
}

export function transition(current: CampaignStatus, event: CampaignEvent): CampaignStatus {
    return transitions[current]?.[event] ?? current
}

export function applyCampaignEvent(campaignId: number, event: CampaignEvent): CampaignStatus | null {
    const row = storageService.get("SELECT status FROM campaigns WHERE id = ?", [campaignId])
    if (!row) return null

    const currentStatus = row.status as CampaignStatus
    const nextStatus = transition(currentStatus, event)

    if (nextStatus !== currentStatus) {
        storageService.run("UPDATE campaigns SET status = ? WHERE id = ?", [nextStatus, campaignId])
    }
    return nextStatus
}
