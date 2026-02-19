import React from 'react'

interface Props {
    stats: {
        scanned?: number
        queued: number
        preparing: number
        uploading: number
        published: number
        failed: number
        skipped: number
    }
}

export const CampaignStats: React.FC<Props> = ({ stats }) => {
    const items = [
        { label: 'Scanned', value: stats.scanned || 0, color: '#a855f7', bg: 'rgba(168, 85, 247, 0.08)' },
        { label: 'Queued', value: stats.queued, color: '#9ca3af', bg: 'rgba(156, 163, 175, 0.08)' },
        { label: 'Preparing', value: stats.preparing, color: '#eab308', bg: 'rgba(234, 179, 8, 0.08)' },
        { label: 'Uploading', value: stats.uploading, color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.08)' },
        { label: 'Published', value: stats.published, color: '#22c55e', bg: 'rgba(34, 197, 94, 0.08)' },
        { label: 'Failed', value: stats.failed, color: '#ef4444', bg: 'rgba(239, 68, 68, 0.08)' },
        { label: 'Skipped', value: stats.skipped, color: '#6b7280', bg: 'rgba(107, 114, 128, 0.08)' },
    ]

    return (
        <div style={{ padding: '0 32px', marginBottom: '24px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '12px', letterSpacing: '0.5px' }}>
                📈 REAL-TIME STATS
            </div>
            <div data-testid="campaign-stats" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '12px' }}>
                {items.map(item => (
                    <div key={item.label} style={{
                        background: item.bg,
                        border: `1px solid ${item.color}30`,
                        borderRadius: '12px',
                        padding: '16px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center'
                    }}>
                        <div className="tabular-nums" style={{ fontSize: '24px', fontWeight: 700, color: item.color, marginBottom: '4px' }}>
                            {item.value}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', fontWeight: 500 }}>
                            {item.label}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
