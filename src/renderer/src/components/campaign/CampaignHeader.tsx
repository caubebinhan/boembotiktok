import React from 'react'
import { formatFrequency, formatDateTime } from '../../utils/formatters'

interface Props {
    campaign: any
    onRunNow: () => void
    onPause: () => void
    onRefresh: () => void
    isRunning?: boolean
    isScanning?: boolean
    isWaitingForScan?: boolean
    nextScan?: string | null
}

export const CampaignHeader: React.FC<Props> = ({ campaign, onRunNow, onPause, onRefresh, isRunning, isScanning, isWaitingForScan, nextScan }) => {
    if (!campaign) return null

    // Derive campaign state from config
    let config: any = {}
    try { config = JSON.parse(campaign.config_json || '{}') } catch { }
    const hasSources = (config.sources?.channels?.length > 0) || (config.sources?.keywords?.length > 0)

    // Use the native column from the database as per Directive 10
    const isMonitoring = campaign.campaign_mode === 'continuous' && campaign.status === 'active' && !isRunning

    // Status badge calculations prioritizing highest importance
    let statusColor = campaign.status === 'active' ? '#4ade80' : '#9ca3af'
    let statusLabel = campaign.status?.toUpperCase() || 'UNKNOWN'
    let statusBg = campaign.status === 'active' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(156, 163, 175, 0.15)'

    if (campaign.status === 'needs_captcha') {
        statusColor = '#ef4444'
        statusLabel = '⚠️ CAPTCHA NEEDED'
        statusBg = 'rgba(239, 68, 68, 0.15)'
    } else if (campaign.status === 'needs_review') {
        statusColor = '#f59e0b'
        statusLabel = '● ACTION NEEDED'
        statusBg = 'rgba(245, 158, 11, 0.15)'
    } else if (campaign.status === 'finished') {
        statusColor = '#10b981'
        statusLabel = '✅ FINISHED'
        statusBg = 'rgba(16, 185, 129, 0.15)'
    } else if (campaign.status === 'paused') {
        if (campaign.paused_at_startup) {
            statusColor = '#eab308'
            statusLabel = '⏸ AUTO-PAUSED'
            statusBg = 'rgba(234, 179, 8, 0.15)'
        } else {
            statusColor = '#9ca3af'
            statusLabel = '⏸ PAUSED'
            statusBg = 'rgba(156, 163, 175, 0.15)'
        }
    } else if (isScanning) {
        statusColor = '#60a5fa'
        statusLabel = '🔍 SCANNING'
        statusBg = 'rgba(59, 130, 246, 0.15)'
    } else if (isRunning) {
        statusColor = '#60a5fa'
        statusLabel = '🔄 RUNNING'
        statusBg = 'rgba(59, 130, 246, 0.15)'
    } else if (isWaitingForScan) {
        statusColor = '#fbbf24'
        statusLabel = '⏳ WAITING FOR SCAN'
        statusBg = 'rgba(245, 158, 11, 0.15)'
    } else if (isMonitoring) {
        statusColor = '#a78bfa'
        statusLabel = '📡 MONITORING'
        statusBg = 'rgba(139, 92, 246, 0.15)'
    }

    return (
        <header data-testid="campaign-header" style={{
            padding: '24px 32px',
            borderBottom: '1px solid var(--border-primary)',
            background: 'var(--bg-secondary)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
        }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    <button className="btn-ghost" style={{ fontSize: '18px', padding: '4px' }}>←</button>
                    <h1 style={{ margin: 0, fontSize: '24px', fontWeight: 800, color: 'var(--text-primary)' }}>
                        {campaign.name}
                    </h1>
                    <span style={{
                        padding: '4px 12px', borderRadius: '20px', fontSize: '12px', fontWeight: 700,
                        background: statusBg, color: statusColor,
                        display: 'flex', alignItems: 'center', gap: '6px'
                    }}>
                        {isRunning && (
                            <div className="spinner" style={{ width: '10px', height: '10px', borderWidth: '1.5px', borderColor: `${statusColor} transparent transparent transparent` }} />
                        )}
                        {!isRunning && !isMonitoring && campaign.status !== 'finished' && (
                            <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'currentColor' }} />
                        )}
                        {statusLabel}
                    </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginLeft: '40px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>📋</span> {campaign.type === 'one_time' ? 'One-time Campaign' : 'Recurring Campaign'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>📅</span> {formatFrequency(campaign)}
                    </div>
                    {nextScan && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#3b82f6', fontWeight: 600 }}>
                            <span>🕒</span> Next Scan: {formatDateTime(nextScan)}
                        </div>
                    )}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>👤</span> {JSON.parse(campaign.config_json || '{}').targetAccounts?.length || 0} Accounts
                    </div>
                    {hasSources && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)' }}>
                            <span>📺</span>
                            {config.sources?.channels?.length || 0} channels
                            {(config.sources?.keywords?.length || 0) > 0 && ` · ${config.sources.keywords.length} keywords`}
                        </div>
                    )}
                </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn btn-secondary" onClick={onRefresh}>
                    🔄 Refresh
                </button>
                <button className="btn btn-secondary">
                    ⚙️ Settings
                </button>
                <button
                    className={`btn ${isRunning ? 'btn-secondary' : 'btn-primary'}`}
                    onClick={isRunning ? onPause : onRunNow}
                    disabled={campaign.status === 'finished'}
                    style={{
                        background: campaign.status === 'finished' ? '#10b981' : (isRunning ? 'var(--bg-tertiary)' : 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)'),
                        boxShadow: isRunning || campaign.status === 'finished' ? 'none' : '0 4px 12px rgba(37, 99, 235, 0.3)',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                        color: campaign.status === 'finished' ? '#fff' : 'inherit',
                        cursor: campaign.status === 'finished' ? 'default' : 'pointer'
                    }}
                >
                    {isRunning ? (
                        <>
                            <div className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />
                            ⏸ Pause
                        </>
                    ) : (
                        campaign.status === 'finished' ? (
                            <>✓ Finished</>
                        ) : (
                            <>▶ Run Now</>
                        )
                    )}
                </button>
            </div>
        </header>
    )
}
