import React, { memo, useMemo } from 'react'
import { Campaign } from '../types/picker'
import { formatFrequency } from '../utils/formatters'

interface Props {
    campaigns: Campaign[]
    onCreate: () => void
    onToggleStatus: (id: number, currentStatus: string) => void
    onSelect: (campaign: Campaign) => void
    onDelete?: (id: number) => void
    onRun?: (id: number) => void
    onPause?: (id: number) => void
    onClone?: (id: number) => void
    onReschedule?: (id: number) => void
    processingIds?: Set<number>
}

interface ItemProps {
    campaign: Campaign
    onToggleStatus: (id: number, currentStatus: string) => void
    onSelect: (campaign: Campaign) => void
    onDelete?: (id: number) => void
    onRun?: (id: number) => void
    onPause?: (id: number) => void
    onClone?: (id: number) => void
    processingIds?: Set<number>
}

/** Derive scanning/monitoring/progress state from campaign data */
function useCampaignProgress(c: Campaign) {
    return useMemo(() => {
        let config: any = {}
        try { config = JSON.parse(c.config_json || '{}') } catch { }

        const hasSources = (config.sources?.channels?.length > 0) || (config.sources?.keywords?.length > 0)
        const isScanning = ((c as any).scanning_count || 0) > 0
        const hasPendingScan = ((c as any).scan_pending_count || 0) > 0

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

        // Waiting for scan = scan pending but not yet running
        const isWaitingForScan = hasSources && !isScanning && hasPendingScan && c.status === 'active'
        // Monitoring = indeterminate, all current jobs done, campaign active, no scan running/pending
        const isMonitoring = hasSources && !isDeterminate && !isScanning && !hasPendingScan && c.status === 'active' &&
            (c.queued_count || 0) === 0 && (c.preparing_count || 0) === 0 && (c.uploading_count || 0) === 0
        const isFinished = c.status === 'finished'

        const channelCount = config.sources?.channels?.length || 0
        const keywordCount = config.sources?.keywords?.length || 0

        // Progress ratio for bar
        const totalJobs = (c.queued_count || 0) + (c.preparing_count || 0) + (c.uploading_count || 0) + (c.published_count || 0) + (c.failed_count || 0) + (c.downloaded_count || 0)
        const completedJobs = (c.published_count || 0)
        const progressRatio = totalJobs > 0 ? completedJobs / totalJobs : 0

        return { hasSources, isScanning, isWaitingForScan, hasPendingScan, isDeterminate, isMonitoring, isFinished, channelCount, keywordCount, progressRatio, totalJobs }
    }, [c])
}

const CampaignItem = memo(({
    campaign: c,
    onToggleStatus,
    onSelect,
    onDelete,
    onRun,
    onPause,
    onClone,
    processingIds
}: ItemProps) => {
    const isProcessing = processingIds?.has(c.id);
    const isRunning = isProcessing || (c.queued_count || 0) > 0 || (c.preparing_count || 0) > 0 || (c.uploading_count || 0) > 0;
    const needsReview = c.status === 'needs_review';
    const needsCaptcha = c.status === 'needs_captcha';
    const progress = useCampaignProgress(c);

    // Status badge config — recurrent campaign status priority:
    // Scanning > Waiting for Scan > Monitoring > Finished > Active/Paused
    let statusBadge = { label: '○ Paused', bg: 'rgba(255,255,255,0.06)', color: 'var(--text-muted)' }
    if (needsCaptcha) {
        statusBadge = { label: '⚠️ CAPTCHA Needed', bg: 'rgba(239,68,68,0.12)', color: '#ef4444' }
    } else if (needsReview) {
        statusBadge = { label: '● Action Needed', bg: 'rgba(245,158,11,0.12)', color: '#f59e0b' }
    } else if (progress.isScanning) {
        statusBadge = { label: '🔍 Scanning...', bg: 'rgba(59,130,246,0.12)', color: '#60a5fa' }
    } else if (progress.isWaitingForScan) {
        statusBadge = { label: '⏳ Waiting for Scan', bg: 'rgba(245,158,11,0.12)', color: '#fbbf24' }
    } else if (progress.isMonitoring) {
        statusBadge = { label: '📡 Monitoring', bg: 'rgba(139,92,246,0.12)', color: '#a78bfa' }
    } else if (progress.isFinished) {
        statusBadge = { label: '✅ Finished', bg: 'rgba(34,197,94,0.12)', color: '#4ade80' }
    } else if (c.status === 'active') {
        statusBadge = { label: '● Active', bg: 'rgba(74,222,128,0.12)', color: '#4ade80' }
    }

    return (
        <div
            style={{
                padding: '14px 16px',
                background: 'var(--bg-card)',
                border: `1px solid ${progress.isScanning ? 'rgba(59,130,246,0.3)' : 'var(--border-subtle)'}`,
                borderRadius: 'var(--radius-lg)',
                transition: 'border-color 0.2s, box-shadow 0.2s',
                cursor: 'pointer',
                display: 'flex',
                flexDirection: 'column',
                gap: '8px',
                outline: 'none',
                position: 'relative',
                overflow: 'hidden'
            }}
            tabIndex={0}
            role="button"
            aria-label={`Campaign: ${c.name}`}
            onClick={() => onSelect(c)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(c) }}
            className="campaign-item-card"
        >
            {/* Progress bar at bottom */}
            {progress.totalJobs > 0 && (
                <div style={{
                    position: 'absolute', bottom: 0, left: 0, right: 0, height: '3px',
                    background: 'rgba(255,255,255,0.04)'
                }}>
                    <div style={{
                        height: '100%', width: `${progress.progressRatio * 100}%`,
                        background: progress.isFinished ? '#22c55e' : 'linear-gradient(90deg, #3b82f6, #8b5cf6)',
                        transition: 'width 0.5s ease',
                        borderRadius: '0 2px 2px 0'
                    }} />
                </div>
            )}

            {/* Row 1: Name + Status */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                <div style={{
                    fontWeight: 600, fontSize: '14px',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    minWidth: 0, flex: 1
                }} title={c.name}>
                    {c.name}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 }}>
                    <span
                        className="badge"
                        style={{
                            cursor: 'pointer',
                            background: statusBadge.bg,
                            color: statusBadge.color,
                            display: 'flex', alignItems: 'center', gap: '4px'
                        }}
                        onClick={(e) => { e.stopPropagation(); onToggleStatus(c.id, c.status) }}
                    >
                        {progress.isScanning && (
                            <div className="spinner" style={{ width: '10px', height: '10px', borderWidth: '1.5px', borderColor: `${statusBadge.color} transparent transparent transparent` }} />
                        )}
                        {statusBadge.label}
                    </span>
                    {(c.missed_count || 0) > 0 ? (
                        <span className="badge badge-error" style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            ⚠️ Missed ({c.missed_count})
                        </span>
                    ) : null}
                </div>
            </div>

            {/* Row 2: Type + Source Info */}
            <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                <span>
                    {c.type === 'scan_all' ? '🔄 Full Scan' : '📋 New Items'}
                </span>
                <span>📅 {formatFrequency(c)}</span>
                {progress.hasSources && (
                    <span style={{ color: 'var(--text-muted)' }}>
                        {progress.channelCount > 0 && `📺 ${progress.channelCount} channel${progress.channelCount > 1 ? 's' : ''}`}
                        {progress.channelCount > 0 && progress.keywordCount > 0 && ' · '}
                        {progress.keywordCount > 0 && `🔍 ${progress.keywordCount} keyword${progress.keywordCount > 1 ? 's' : ''}`}
                    </span>
                )}
            </div>

            {/* Row 3: Stats */}
            <div style={{
                display: 'flex', gap: '12px', fontSize: '11px',
                marginTop: '2px', color: 'var(--text-muted)',
                fontVariantNumeric: 'tabular-nums'
            }}>
                <span title="Queued Videos">
                    Queued: <b>{c.queued_count || 0}</b>
                </span>
                <span style={{ color: 'var(--border-primary)' }}>|</span>
                <span title="Downloaded Videos">
                    Downloaded: <b>{c.downloaded_count || 0}</b>
                </span>
                <span style={{ color: 'var(--border-primary)' }}>|</span>
                <span title="Published Videos" style={{ color: (c.published_count || 0) > 0 ? '#4ade80' : undefined }}>
                    Published: <b>{c.published_count || 0}</b>
                </span>
                {(c.failed_count || 0) > 0 ? (
                    <>
                        <span style={{ color: 'var(--border-primary)' }}>|</span>
                        <span title="Failed Jobs" style={{ color: '#fe2c55', fontWeight: 600 }}>
                            Failed: {c.failed_count}
                        </span>
                    </>
                ) : null}
            </div>

            {/* Row 4: Actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button className="btn btn-ghost btn-sm" style={{ fontSize: '12px', padding: '4px 8px' }}>
                        View Details &rarr;
                    </button>

                    {isRunning ? (
                        <button
                            className="btn btn-secondary btn-sm"
                            onClick={(e) => { e.stopPropagation(); onPause?.(c.id); }}
                            style={{ padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                        >
                            <div className="spinner" style={{ width: '10px', height: '10px', borderWidth: '1.5px' }} />
                            ⏸ Pause
                        </button>
                    ) : (
                        needsReview ? (
                            <button className="btn btn-primary btn-sm"
                                onClick={(e) => { e.stopPropagation(); onSelect(c) }}
                                style={{ padding: '4px 8px', fontSize: '12px' }}>
                                🗓️ Schedule Preview
                            </button>
                        ) : needsCaptcha ? (
                            <button className="btn btn-primary btn-sm"
                                onClick={(e) => { e.stopPropagation(); onRun && onRun(c.id) }}
                                title="Click to open browser and solve CAPTCHA"
                                style={{ padding: '4px 8px', fontSize: '12px', background: '#dc2626', borderColor: '#dc2626' }}>
                                🔓 Solve & Run
                            </button>
                        ) : (
                            onRun ? (
                                <button className="btn btn-ghost btn-sm"
                                    onClick={(e) => { e.stopPropagation(); onRun(c.id) }}
                                    title={progress.isFinished ? "Run Again" : "Run Now"}
                                    style={{ padding: '4px 8px', color: progress.isFinished ? 'var(--text-primary)' : 'var(--accent-green)' }}>
                                    {progress.isFinished ? '↻ Run Again' : '▶ Run'}
                                </button>
                            ) : null
                        )
                    )}

                    {onClone ? (
                        <button className="btn btn-ghost btn-sm"
                            onClick={(e) => { e.stopPropagation(); onClone(c.id) }}
                            title="Clone Campaign"
                            style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}>
                            Clone
                        </button>
                    ) : null}

                    {onDelete ? (
                        <button className="btn btn-ghost btn-sm"
                            onClick={(e) => {
                                e.stopPropagation()
                                if (confirm('Are you sure you want to delete this campaign?')) {
                                    onDelete(c.id)
                                }
                            }}
                            title="Delete Campaign"
                            style={{ padding: '4px 8px', color: '#ef4444' }}>
                            Delete
                        </button>
                    ) : null}
                </div>
            </div>
        </div >
    )
});

CampaignItem.displayName = 'CampaignItem';

export const CampaignList: React.FC<Props> = ({
    campaigns,
    onCreate,
    onToggleStatus,
    onSelect,
    onDelete,
    onRun,
    onPause,
    onClone,
    processingIds
}) => {
    return (
        <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>
                    All Campaigns
                    <span style={{ marginLeft: '8px', color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                        ({campaigns.length})
                    </span>
                </div>
                <button className="btn btn-primary btn-sm" onClick={onCreate}>
                    + New
                </button>
            </div>

            <div style={{ flex: 1, overflowY: 'auto', padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {campaigns.length === 0 ? (
                    <div className="empty-state" style={{ padding: '60px 20px' }}>
                        <div className="empty-icon">📢</div>
                        <div className="empty-text">
                            No campaigns yet.<br />
                            Create your first campaign to start automating.
                        </div>
                        <button className="btn btn-primary" style={{ marginTop: '16px' }} onClick={onCreate}>
                            + Create Campaign
                        </button>
                    </div>
                ) : (
                    campaigns.map(c => (
                        <CampaignItem
                            key={c.id}
                            campaign={c}
                            onToggleStatus={onToggleStatus}
                            onSelect={onSelect}
                            onDelete={onDelete}
                            onRun={onRun}
                            onPause={onPause}
                            onClone={onClone}
                            processingIds={processingIds}
                        />
                    ))
                )}
            </div>
        </div>
    )
}
