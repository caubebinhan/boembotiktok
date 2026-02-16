import React from 'react'
import { formatFrequency } from '../../utils/formatters'

interface Props {
    campaign: any
    onRunNow: () => void
    onRefresh: () => void
}

export const CampaignHeader: React.FC<Props> = ({ campaign, onRunNow, onRefresh }) => {
    if (!campaign) return null

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
                        background: campaign.status === 'active' ? 'rgba(34, 197, 94, 0.15)' : 'rgba(156, 163, 175, 0.15)',
                        color: campaign.status === 'active' ? '#4ade80' : '#9ca3af',
                        display: 'flex', alignItems: 'center', gap: '6px'
                    }}>
                        <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'currentColor' }} />
                        {campaign.status?.toUpperCase()}
                    </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '24px', marginLeft: '40px', fontSize: '13px', color: 'var(--text-secondary)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>📋</span> {campaign.type === 'one_time' ? 'One-time Campaign' : 'Recurring Campaign'}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>📅</span> {formatFrequency(campaign)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <span>👤</span> {JSON.parse(campaign.config_json || '{}').targetAccounts?.length || 0} Accounts
                    </div>
                </div>
            </div>

            <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn btn-secondary" onClick={onRefresh}>
                    🔄 Refresh
                </button>
                <button className="btn btn-secondary">
                    ⚙️ Settings
                </button>
                <button className="btn btn-primary" onClick={onRunNow} style={{
                    background: 'linear-gradient(135deg, #3b82f6 0%, #2563eb 100%)',
                    boxShadow: '0 4px 12px rgba(37, 99, 235, 0.3)'
                }}>
                    ▶ Run Now
                </button>
            </div>
        </header>
    )
}
