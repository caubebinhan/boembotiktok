import React, { useState } from 'react'

interface AccountSettingsModalProps {
    account: any
    onSave: (id: number, settings: any) => void
    onClose: () => void
}

export const AccountSettingsModal: React.FC<AccountSettingsModalProps> = ({ account, onSave, onClose }) => {
    const [proxyUrl, setProxyUrl] = useState(account.proxy_url || '')
    const [autoCaption, setAutoCaption] = useState(account.auto_caption || '')
    const [autoTags, setAutoTags] = useState(account.auto_tags || '')

    const handleSave = () => {
        onSave(account.id, {
            proxy_url: proxyUrl,
            auto_caption: autoCaption,
            auto_tags: autoTags
        })
        onClose()
    }

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, width: '100%', height: '100%',
            background: 'rgba(0,0,0,0.7)', zIndex: 2000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            backdropFilter: 'blur(4px)'
        }}>
            <div style={{
                width: '500px',
                background: 'var(--bg-primary)',
                borderRadius: '16px',
                border: '1px solid var(--border-primary)',
                boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                overflow: 'hidden'
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px 24px',
                    borderBottom: '1px solid var(--border-primary)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '12px'
                }}>
                    <div style={{
                        width: '36px', height: '36px', borderRadius: '50%',
                        background: 'linear-gradient(135deg, #25f4ee, #fe2c55)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: '16px', color: '#fff', fontWeight: 700
                    }}>
                        {account.username?.charAt(0)?.toUpperCase() || '?'}
                    </div>
                    <div>
                        <div style={{ fontWeight: 600, fontSize: '16px' }}>Account Settings</div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>@{account.username}</div>
                    </div>
                </div>

                {/* Body */}
                <div style={{ padding: '24px' }}>
                    {/* Proxy */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                            🌐 Proxy URL
                        </label>
                        <input
                            type="text"
                            className="form-control"
                            value={proxyUrl}
                            onChange={e => setProxyUrl(e.target.value)}
                            placeholder="socks5://user:pass@host:port or http://host:port"
                            style={{ width: '100%' }}
                        />
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            Leave empty to use direct connection
                        </div>
                    </div>

                    {/* Auto Caption */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                            💬 Auto Caption Template
                        </label>
                        <textarea
                            className="form-control"
                            value={autoCaption}
                            onChange={e => setAutoCaption(e.target.value)}
                            placeholder="e.g. Check out this video! #trending"
                            rows={3}
                            style={{ width: '100%', resize: 'vertical' }}
                        />
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            Template text added to every published video's caption
                        </div>
                    </div>

                    {/* Auto Tags */}
                    <div style={{ marginBottom: '20px' }}>
                        <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, marginBottom: '6px', color: 'var(--text-secondary)' }}>
                            🏷️ Auto Tags
                        </label>
                        <input
                            type="text"
                            className="form-control"
                            value={autoTags}
                            onChange={e => setAutoTags(e.target.value)}
                            placeholder="#fyp #viral #trending"
                            style={{ width: '100%' }}
                        />
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>
                            Hashtags automatically appended to every video. Separated by spaces.
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div style={{
                    padding: '16px 24px',
                    borderTop: '1px solid var(--border-primary)',
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: '10px'
                }}>
                    <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
                    <button className="btn btn-primary" onClick={handleSave}>Save Settings</button>
                </div>
            </div>
        </div>
    )
}
