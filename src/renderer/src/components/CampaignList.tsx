import React from 'react'
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

export const CampaignList: React.FC<Props> = ({ campaigns, onCreate, onToggleStatus, onSelect, onDelete, onRun, onPause, onClone, onReschedule, processingIds }) => {
    return (
        <div className="card" style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-primary)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontSize: '13px', fontWeight: 600 }}>
                    All Campaigns
                    <span style={{ marginLeft: '8px', color: 'var(--text-muted)' }}>({campaigns.length})</span>
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
                    campaigns.map(c => {
                        // @ts-ignore
                        const isRunning = c.queued_count > 0
                        return (
                            <div key={c.id} style={{
                                padding: '14px 16px',
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 'var(--radius-lg)',
                                transition: 'all 0.2s',
                                cursor: 'pointer',
                                display: 'flex', flexDirection: 'column', gap: '8px'
                            }}
                                onClick={() => onSelect(c)}
                                onMouseOver={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--accent-primary)'
                                    e.currentTarget.style.boxShadow = 'var(--shadow-card)'
                                }}
                                onMouseOut={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--border-subtle)'
                                    e.currentTarget.style.boxShadow = 'none'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div style={{ fontWeight: 600, fontSize: '14px' }}>{c.name}</div>
                                    <span
                                        className="badge"
                                        style={{
                                            cursor: 'pointer',
                                            background: c.status === 'active' ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.06)',
                                            color: c.status === 'active' ? '#4ade80' : 'var(--text-muted)'
                                        }}
                                        onClick={(e) => { e.stopPropagation(); onToggleStatus(c.id, c.status) }}
                                    >
                                        {c.status === 'active' ? '● Active' : '○ Paused'}
                                    </span>
                                    {(c.missed_count || 0) > 0 && (
                                        <span className="badge badge-error" style={{ marginLeft: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                            ⚠️ Missed ({c.missed_count})
                                        </span>
                                    )}
                                </div>

                                <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    <span>
                                        {c.type === 'scan_all' ? '🔄 Full Scan' : '📋 New Items'}
                                    </span>
                                    <span>📅 {formatFrequency(c)}</span>
                                </div>

                                <div style={{ display: 'flex', gap: '12px', fontSize: '11px', marginTop: '6px', color: 'var(--text-muted)' }}>
                                    <span title="Queued Videos">
                                        Queued: <b>{c.queued_count || 0}</b>
                                    </span>
                                    <span style={{ color: 'var(--border-primary)' }}>|</span>
                                    <span title="Downloaded Videos">
                                        Downloaded: <b>{c.downloaded_count || 0}</b>
                                    </span>
                                    <span style={{ color: 'var(--border-primary)' }}>|</span>
                                    <span title="Published Videos">
                                        Published: <b>{c.published_count || 0}</b>
                                    </span>
                                    {(c.failed_count || 0) > 0 && (
                                        <>
                                            <span style={{ color: 'var(--border-primary)' }}>|</span>
                                            <span title="Failed Jobs" style={{ color: '#fe2c55', fontWeight: 600 }}>
                                                Failed: {c.failed_count}
                                            </span>
                                        </>
                                    )}
                                </div>


                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4px' }}>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                        <button className="btn btn-ghost btn-sm" style={{ fontSize: '12px', padding: '4px 8px' }}>
                                            View Details &rarr;
                                        </button>

                                        {(() => {
                                            const isProcessing = processingIds?.has(c.id);
                                            const isRunning = isProcessing || (c.queued_count || 0) > 0 || (c.preparing_count || 0) > 0 || (c.uploading_count || 0) > 0;

                                            // DEBUG LOG
                                            if (isProcessing) console.log(`[CampaignList] Campaign ${c.id} is PROCESSING (local state)`);
                                            if (isRunning && !isProcessing) console.log(`[CampaignList] Campaign ${c.id} is RUNNING (DB state: queued=${c.queued_count})`);

                                            const hasActivity = (c.published_count || 0) > 0 || (c.paused_count || 0) > 0 || (c.failed_count || 0) > 0;
                                            const isFinished = !isRunning && hasActivity;

                                            if (isRunning) {
                                                return (
                                                    <button
                                                        className="btn btn-secondary btn-sm"
                                                        onClick={(e) => { e.stopPropagation(); onPause && onPause(c.id); }}
                                                        style={{ padding: '4px 8px', fontSize: '12px', display: 'flex', alignItems: 'center', gap: '4px' }}
                                                    >
                                                        <div className="spinner" style={{ width: '10px', height: '10px', borderWidth: '1.5px' }} />
                                                        ⏸ Pause
                                                    </button>
                                                )
                                            }

                                            return onRun && (
                                                <button className="btn btn-ghost btn-sm"
                                                    onClick={(e) => { e.stopPropagation(); onRun(c.id) }}
                                                    title={isFinished ? "Run Again" : "Run Now"}
                                                    style={{ padding: '4px 8px', color: isFinished ? 'var(--text-primary)' : 'var(--accent-green)' }}>
                                                    {isFinished ? '↻ Run Again' : '▶ Run'}
                                                </button>
                                            )
                                        })()}

                                        {onClone && (
                                            <button className="btn btn-ghost btn-sm"
                                                onClick={(e) => { e.stopPropagation(); onClone(c.id) }}
                                                title="Clone Campaign"
                                                style={{ padding: '4px 8px', color: 'var(--text-secondary)' }}>
                                                Clone
                                            </button>
                                        )}
                                        {onDelete && (
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
                                        )}
                                    </div>
                                </div>
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}
