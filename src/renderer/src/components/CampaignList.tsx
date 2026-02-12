import React from 'react'
import { Campaign } from '../types/picker'

interface Props {
    campaigns: Campaign[]
    onCreate: () => void
    onToggleStatus: (id: number, currentStatus: string) => void
}

const cronToHuman = (cron: string): string => {
    if (!cron) return 'Manual'
    const parts = cron.split(' ')
    if (parts.length >= 1 && parts[0].startsWith('*/')) {
        const mins = parseInt(parts[0].replace('*/', ''))
        if (mins >= 60) return `Every ${Math.round(mins / 60)}h`
        return `Every ${mins} min`
    }
    return cron
}

export const CampaignList: React.FC<Props> = ({ campaigns, onCreate, onToggleStatus }) => {
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
                        const isRunning = c.pending_count > 0
                        return (
                            <div key={c.id} style={{
                                padding: '14px 16px',
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border-subtle)',
                                borderRadius: 'var(--radius-lg)',
                                transition: 'all 0.2s',
                                cursor: 'pointer'
                            }}
                                onMouseOver={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--border-primary)'
                                    e.currentTarget.style.boxShadow = 'var(--shadow-card)'
                                }}
                                onMouseOut={(e) => {
                                    e.currentTarget.style.borderColor = 'var(--border-subtle)'
                                    e.currentTarget.style.boxShadow = 'none'
                                }}
                            >
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
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
                                </div>

                                <div style={{ display: 'flex', gap: '16px', fontSize: '12px', color: 'var(--text-secondary)' }}>
                                    <span>
                                        {c.type === 'scan_all' ? '🔄 Full Scan' : '📋 New Items'}
                                    </span>
                                    <span>📅 {cronToHuman(c.schedule_cron)}</span>
                                </div>

                                {isRunning && (
                                    <div style={{ marginTop: '10px' }}>
                                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                                            Processing...
                                        </div>
                                        <div className="progress-bar">
                                            <div className="progress-fill indeterminate" />
                                        </div>
                                    </div>
                                )}
                            </div>
                        )
                    })
                )}
            </div>
        </div>
    )
}
