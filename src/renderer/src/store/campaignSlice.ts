import { createSlice, createAsyncThunk, PayloadAction } from '@reduxjs/toolkit'

// ── Types ────────────────────────────────────────────────────

export interface CampaignData {
    id: number
    name: string
    type: string
    status: string
    schedule_cron: string
    config_json: string
    created_at: string
    queued_count?: number
    preparing_count?: number
    uploading_count?: number
    published_count?: number
    downloaded_count?: number
    failed_count?: number
    skipped_count?: number
    paused_count?: number
    missed_count?: number
    scanning_count?: number
    scan_pending_count?: number
    scanned_count?: number
    total_recent?: number
}

interface CampaignState {
    list: CampaignData[]
    processingIds: number[]
    loading: boolean
    error: string | null
    activeId: number | null
    activeJobs: any[]
    activeAccounts: any[]
}

const initialState: CampaignState = {
    list: [],
    processingIds: [],
    loading: false,
    error: null,
    activeId: null,
    activeJobs: [],
    activeAccounts: []
}

// Selector state shape — avoids circular import with store.ts
type SliceRoot = { campaigns: CampaignState }

// ── Async Thunks ─────────────────────────────────────────────

export const fetchCampaigns = createAsyncThunk(
    'campaigns/fetchAll',
    async () => {
        // @ts-ignore
        const data = await window.api.invoke('get-campaigns')
        return (data || []) as CampaignData[]
    }
)

export const triggerCampaign = createAsyncThunk(
    'campaigns/trigger',
    async ({ id, runNow }: { id: number; runNow?: boolean }, { dispatch }) => {
        // @ts-ignore
        await window.api.invoke('trigger-campaign', id, runNow ?? true)
        await new Promise(r => setTimeout(r, 500))
        dispatch(fetchCampaigns())
        return id
    }
)

export const pauseCampaign = createAsyncThunk(
    'campaigns/pause',
    async (id: number, { dispatch }) => {
        // @ts-ignore
        await window.api.invoke('campaign:pause', id)
        dispatch(fetchCampaigns())
        return id
    }
)

export const deleteCampaign = createAsyncThunk(
    'campaigns/delete',
    async (id: number, { dispatch }) => {
        // @ts-ignore
        await window.api.invoke('delete-campaign', id)
        dispatch(fetchCampaigns())
        return id
    }
)

export const cloneCampaign = createAsyncThunk(
    'campaigns/clone',
    async (id: number) => {
        // @ts-ignore
        const details = await window.api.invoke('get-campaign-details', id)
        return details
    }
)

export const fetchCampaignDetail = createAsyncThunk(
    'campaigns/fetchDetail',
    async (id: number) => {
        // @ts-ignore
        const campaign = await window.api.invoke('get-campaign-details', id)
        // @ts-ignore
        const jobs = await window.api.invoke('get-campaign-jobs', id)
        // @ts-ignore
        const accounts = await window.api.invoke('publish-account:list')
        return { campaign, jobs: jobs || [], accounts: accounts || [] }
    }
)

export const toggleCampaignStatus = createAsyncThunk(
    'campaigns/toggleStatus',
    async ({ id, currentStatus }: { id: number; currentStatus: string }, { dispatch }) => {
        const nextStatus = currentStatus === 'active' ? 'paused' : 'active'
        // @ts-ignore
        await window.api.invoke('update-campaign-status', id, nextStatus)
        dispatch(fetchCampaigns())
        return id
    }
)

// ── Slice ────────────────────────────────────────────────────

const campaignSlice = createSlice({
    name: 'campaigns',
    initialState,
    reducers: {
        setActiveId(state, action: PayloadAction<number | null>) {
            state.activeId = action.payload
        },
        addProcessingId(state, action: PayloadAction<number>) {
            if (!state.processingIds.includes(action.payload)) {
                state.processingIds.push(action.payload)
            }
        },
        removeProcessingId(state, action: PayloadAction<number>) {
            state.processingIds = state.processingIds.filter(id => id !== action.payload)
        }
    },
    extraReducers: (builder) => {
        builder
            .addCase(fetchCampaigns.pending, (state) => {
                state.loading = true
                state.error = null
            })
            .addCase(fetchCampaigns.fulfilled, (state, action) => {
                state.list = action.payload
                state.loading = false
            })
            .addCase(fetchCampaigns.rejected, (state, action) => {
                state.loading = false
                state.error = action.error.message || 'Failed to fetch campaigns'
            })
            .addCase(triggerCampaign.pending, (state, action) => {
                const id = action.meta.arg.id
                if (!state.processingIds.includes(id)) {
                    state.processingIds.push(id)
                }
            })
            .addCase(triggerCampaign.fulfilled, (state, action) => {
                state.processingIds = state.processingIds.filter(id => id !== action.payload)
            })
            .addCase(triggerCampaign.rejected, (state, action) => {
                const id = action.meta.arg.id
                state.processingIds = state.processingIds.filter(pid => pid !== id)
            })
            .addCase(fetchCampaignDetail.fulfilled, (state, action) => {
                const { campaign, jobs, accounts } = action.payload
                if (campaign) {
                    state.activeId = campaign.id
                    state.activeJobs = jobs
                    state.activeAccounts = accounts
                    const idx = state.list.findIndex((c: CampaignData) => c.id === campaign.id)
                    if (idx >= 0) {
                        state.list[idx] = { ...state.list[idx], ...campaign }
                    }
                }
            })
    }
})

export const { setActiveId, addProcessingId, removeProcessingId } = campaignSlice.actions

// ── Selectors ────────────────────────────────────────────────

export const selectCampaigns = (state: SliceRoot) => state.campaigns.list
export const selectProcessingIds = (state: SliceRoot) => new Set(state.campaigns.processingIds)
export const selectCampaignsLoading = (state: SliceRoot) => state.campaigns.loading
export const selectActiveJobs = (state: SliceRoot) => state.campaigns.activeJobs
export const selectActiveAccounts = (state: SliceRoot) => state.campaigns.activeAccounts
export const selectActiveCampaign = (state: SliceRoot) => {
    const id = state.campaigns.activeId
    return id ? state.campaigns.list.find((c: CampaignData) => c.id === id) : null
}

/**
 * Derive campaign progress info for list display (recurrent campaigns)
 */
export const selectCampaignProgress = (state: SliceRoot, campaignId: number) => {
    const c = state.campaigns.list.find((camp: CampaignData) => camp.id === campaignId)
    if (!c) return null

    let config: any = {}
    try { config = JSON.parse(c.config_json || '{}') } catch { }

    const hasSources = (config.sources?.channels?.length > 0) || (config.sources?.keywords?.length > 0)
    const isScanning = (c.scanning_count || 0) > 0
    const hasPendingScan = (c.scan_pending_count || 0) > 0
    const totalPublished = c.published_count || 0
    const totalFailed = c.failed_count || 0
    const totalQueued = c.queued_count || 0
    const totalScanned = c.scanned_count || 0

    // Determinate = ALL sources have finite video counts
    // history_only → determinate
    // custom_range with endDate → determinate
    // future_only, history_and_future, custom_range without endDate → indeterminate
    const allSources = [
        ...(config.sources?.channels || []),
        ...(config.sources?.keywords || [])
    ]
    const isDeterminate = !hasSources || allSources.every((src: any) => {
        const mode = src.timeRange
        if (!mode || mode === 'future_only' || mode === 'history_and_future') return false
        if (mode === 'custom_range' && !src.endDate) return false
        return true
    })

    // Waiting for scan = scan job pending but not yet running
    const isWaitingForScan = hasSources && !isScanning && hasPendingScan && c.status === 'active'
    // Monitoring = indeterminate sources, all current jobs done, campaign active, no scan running/pending
    const isMonitoring = hasSources && !isDeterminate && !isScanning && !hasPendingScan && c.status === 'active' &&
        (totalQueued === 0) && ((c.preparing_count || 0) === 0) && ((c.uploading_count || 0) === 0)
    const isFinished = c.status === 'finished'

    const channelCount = config.sources?.channels?.length || 0
    const keywordCount = config.sources?.keywords?.length || 0

    return {
        isScanning,
        isWaitingForScan,
        isMonitoring,
        isFinished,
        isDeterminate,
        hasPendingScan,
        totalPublished,
        totalFailed,
        totalQueued,
        totalScanned,
        channelCount,
        keywordCount,
        hasSources
    }
}

export default campaignSlice.reducer

