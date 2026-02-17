export interface FilterCriteria {
    minViews: number
    minLikes: number
    minComments: number
    dateFrom: string
    dateTo: string
}

export interface ScannedVideo {
    id: string
    url: string
    description: string
    thumbnail: string
    stats: {
        views: number
        likes: number
        comments: number
        date?: string
    }
    selected: boolean
    exists?: boolean
}

export interface SavedVideo {
    id: number
    platform: string
    platform_id: string
    url: string
    description: string
    status: 'discovered' | 'downloaded' | 'published'
    created_at: string
    metadata?: string
}

export interface DownloadItem {
    id: number
    video_id: number
    platform_id: string
    title?: string
    status: 'pending' | 'downloading' | 'completed' | 'failed'
    progress: number
    file_path?: string
    error?: string
    created_at: string
    metadata?: string
    url: string
}

export interface FollowedChannel {
    id: number
    platform: string
    username: string
    filterCriteria: FilterCriteria
    created_at: string
}

export interface FollowedKeyword {
    id: number
    platform: string
    keyword: string
    filterCriteria: FilterCriteria
    created_at: string
}

export interface Campaign {
    id: number
    name: string
    type: 'scan_all' | 'scan_new'
    status: 'active' | 'paused'
    schedule_cron: string
    config_json: string
    created_at: string
    pending_count?: number
    queued_count?: number
    preparing_count?: number
    uploading_count?: number
    scanned_count?: number
    published_count?: number
    downloaded_count?: number
    failed_count?: number
    skipped_count?: number
    total_recent?: number
}


export interface TargetedChannel {
    name: string
    avatar?: string
    nickname?: string
    stats?: { followers: string, likes: string }
}

export interface TargetedKeyword {
    keyword: string
}

export interface CartState {
    channels: TargetedChannel[]
    keywords: TargetedKeyword[]
    videos: ScannedVideo[]
}

export type RightPanelTab = 'scanned' | 'collection' | 'sources' | 'downloads' | 'campaigns' | 'targets'
