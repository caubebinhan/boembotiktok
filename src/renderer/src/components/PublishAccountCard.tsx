import React from 'react'

interface PublishAccountData {
    id: number
    platform: string
    username: string
    display_name: string
    avatar_url: string
    proxy_url: string
    auto_caption: string
    auto_tags: string
    session_valid: number
    last_login_at: string
    created_at: string
}

interface PublishAccountCardProps {
    account: PublishAccountData
    onEdit: (account: PublishAccountData) => void
    onRemove: (id: number) => void
    onReLogin: (id: number) => void
}

export const PublishAccountCard: React.FC<PublishAccountCardProps> = ({ account, onEdit, onRemove, onReLogin }) => {
    const isValid = account.session_valid === 1

    return (
        <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '14px',
            padding: '16px',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-primary)',
            borderRadius: '12px',
            transition: 'all 0.2s'
        }}>
            {/* Avatar */}
            <div style={{
                width: '48px',
                height: '48px',
                borderRadius: '50%',
                background: 'linear-gradient(135deg, #25f4ee, #fe2c55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '20px',
                color: '#fff',
                fontWeight: 700,
                overflow: 'hidden',
                flexShrink: 0
            }}>
                {account.avatar_url ? (
                    <img src={account.avatar_url} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                ) : (
                    account.username?.charAt(0)?.toUpperCase() || '?'
                )}
            </div>

            {/* Info */}
            <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontWeight: 600, fontSize: '14px' }}>
                        {account.display_name || account.username}
                    </span>
                    <span style={{
                        padding: '2px 8px',
                        borderRadius: '10px',
                        fontSize: '10px',
                        fontWeight: 600,
                        background: isValid ? 'rgba(74, 222, 128, 0.15)' : 'rgba(244, 67, 54, 0.15)',
                        color: isValid ? '#4ade80' : '#f44336'
                    }}>
                        {isValid ? 'ACTIVE' : 'EXPIRED'}
                    </span>
                </div>
                <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>
                    @{account.username} • {account.platform}
                </div>
                {/* Settings summary */}
                <div style={{ display: 'flex', gap: '10px', marginTop: '6px', flexWrap: 'wrap' }}>
                    {account.proxy_url && (
                        <span style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(124, 92, 252, 0.12)',
                            color: '#7c5cfc'
                        }}>
                            🌐 Proxy
                        </span>
                    )}
                    {account.auto_caption && (
                        <span style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(37, 244, 238, 0.12)',
                            color: '#25f4ee'
                        }}>
                            💬 Auto Caption
                        </span>
                    )}
                    {account.auto_tags && (
                        <span style={{
                            fontSize: '10px',
                            padding: '2px 6px',
                            borderRadius: '4px',
                            background: 'rgba(254, 44, 85, 0.12)',
                            color: '#fe2c55'
                        }}>
                            🏷️ Auto Tags
                        </span>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '6px', flexShrink: 0 }}>
                {!isValid && (
                    <button
                        className="btn btn-secondary"
                        onClick={() => onReLogin(account.id)}
                        style={{ padding: '6px 12px', fontSize: '12px' }}
                        title="Re-login to refresh session"
                    >
                        🔄 Re-login
                    </button>
                )}
                <button
                    className="btn btn-ghost"
                    onClick={() => onEdit(account)}
                    style={{ padding: '6px 10px', fontSize: '12px' }}
                    title="Edit settings"
                >
                    ⚙️
                </button>
                <button
                    className="btn btn-ghost"
                    onClick={() => {
                        if (confirm(`Remove account @${account.username}?`)) {
                            onRemove(account.id)
                        }
                    }}
                    style={{ padding: '6px 10px', fontSize: '12px', color: '#f44336' }}
                    title="Remove account"
                >
                    🗑️
                </button>
            </div>
        </div>
    )
}
