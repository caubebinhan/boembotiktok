import React, { useState, useEffect } from 'react'
import { PublishAccountCard } from '../components/PublishAccountCard'
import { AccountSettingsModal } from '../components/AccountSettingsModal'

export const AccountsView: React.FC = () => {
    const [publishAccounts, setPublishAccounts] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [addingAccount, setAddingAccount] = useState(false)
    const [editingAccount, setEditingAccount] = useState<any | null>(null)

    useEffect(() => {
        loadAccounts()
    }, [])

    const loadAccounts = async () => {
        setLoading(true)
        try {
            // @ts-ignore
            const data = await window.api.invoke('publish-account:list')
            setPublishAccounts(data || [])
        } catch { }
        setLoading(false)
    }

    const handleAddAccount = async () => {
        setAddingAccount(true)
        try {
            // @ts-ignore
            const account = await window.api.invoke('publish-account:add')
            if (account) {
                setPublishAccounts(prev => [account, ...prev])
            }
        } catch (err) {
            console.error('Failed to add account:', err)
        }
        setAddingAccount(false)
    }

    const handleRemoveAccount = async (id: number) => {
        try {
            // @ts-ignore
            await window.api.invoke('publish-account:remove', id)
            setPublishAccounts(prev => prev.filter(a => a.id !== id))
        } catch (err) {
            console.error('Failed to remove account:', err)
        }
    }

    const handleUpdateAccount = async (id: number, settings: any) => {
        try {
            // @ts-ignore
            await window.api.invoke('publish-account:update', id, settings)
            setPublishAccounts(prev => prev.map(a => a.id === id ? { ...a, ...settings } : a))
        } catch (err) {
            console.error('Failed to update account:', err)
        }
    }

    const handleReLogin = async (id: number) => {
        try {
            // @ts-ignore
            const updated = await window.api.invoke('publish-account:relogin', id)
            if (updated) {
                setPublishAccounts(prev => prev.map(a => a.id === id ? updated : a))
            }
        } catch (err) {
            console.error('Re-login failed:', err)
        }
    }

    return (
        <div className="page-enter" style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', padding: '24px', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>Accounts</h1>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                        Manage your TikTok publish accounts
                    </p>
                </div>
                <button
                    className="btn btn-primary"
                    onClick={handleAddAccount}
                    disabled={addingAccount}
                    style={{
                        padding: '10px 20px',
                        fontSize: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}
                >
                    {addingAccount ? (
                        <>
                            <span className="spinner" style={{ width: '14px', height: '14px' }} />
                            Waiting for login...
                        </>
                    ) : (
                        <>➕ Add TikTok Account</>
                    )}
                </button>
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {loading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div className="spinner" style={{ width: '20px', height: '20px', marginBottom: '10px' }} />
                            <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading accounts...</div>
                        </div>
                    </div>
                ) : publishAccounts.length === 0 && !addingAccount ? (
                    <div className="empty-state" style={{ padding: '60px' }}>
                        <div className="empty-icon" style={{ fontSize: '48px' }}>👤</div>
                        <div className="empty-text" style={{ marginTop: '12px' }}>
                            No publish accounts linked yet.<br />
                            Click "Add TikTok Account" to login and save your session.
                        </div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {publishAccounts.map(acc => (
                            <PublishAccountCard
                                key={acc.id}
                                account={acc}
                                onEdit={setEditingAccount}
                                onRemove={handleRemoveAccount}
                                onReLogin={handleReLogin}
                            />
                        ))}
                    </div>
                )}
            </div>

            {/* Account Settings Modal */}
            {editingAccount && (
                <AccountSettingsModal
                    account={editingAccount}
                    onSave={handleUpdateAccount}
                    onClose={() => setEditingAccount(null)}
                />
            )}
        </div>
    )
}
