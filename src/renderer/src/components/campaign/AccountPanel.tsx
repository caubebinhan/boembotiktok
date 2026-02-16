import React from 'react'

interface Props {
    accounts: any[]
    jobs: any[] // To calculate daily usage
}

export const AccountPanel: React.FC<Props> = ({ accounts, jobs }) => {
    // Helper to calculate daily usage
    const getDailyUsage = (accountName: string) => {
        const today = new Date().toISOString().split('T')[0]
        return jobs.filter(j =>
            j.type === 'PUBLISH' &&
            j.status === 'completed' &&
            j.updated_at?.startsWith(today) &&
            JSON.parse(j.data_json || '{}').account_name === accountName
        ).length
    }

    return (
        <div style={{ padding: '0 32px 32px 32px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '16px', letterSpacing: '0.5px' }}>
                👤 ACCOUNTS STATUS
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                {accounts.map(acc => {
                    const usage = getDailyUsage(acc.username)
                    const limit = 10 // Mock limit, or from config
                    const isSessionValid = acc.session_valid === 1

                    return (
                        <div key={acc.username} style={{
                            background: 'var(--bg-secondary)',
                            border: `1px solid ${isSessionValid ? 'var(--border-primary)' : '#ef4444'}`,
                            borderRadius: '12px',
                            padding: '16px'
                        }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                                <div style={{ fontWeight: 700, fontSize: '14px' }}>@{acc.username}</div>
                                <span style={{
                                    fontSize: '11px', fontWeight: 600,
                                    color: isSessionValid ? '#4ade80' : '#ef4444',
                                    display: 'flex', alignItems: 'center', gap: '4px'
                                }}>
                                    {isSessionValid ? '🟢 Active' : '⚠️ Session Expired'}
                                </span>
                            </div>

                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                <div>
                                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                                        <span>Daily Limit ({usage}/{limit})</span>
                                        <span>{Math.round((usage / limit) * 100)}%</span>
                                    </div>
                                    <div style={{ height: '4px', background: 'var(--bg-primary)', borderRadius: '2px', overflow: 'hidden' }}>
                                        <div style={{ width: `${(usage / limit) * 100}%`, height: '100%', background: usage >= limit ? '#ef4444' : '#3b82f6' }} />
                                    </div>
                                </div>

                                {!isSessionValid && (
                                    <button className="btn btn-sm btn-outline-danger" style={{ width: '100%', marginTop: '4px' }}>
                                        🔑 Re-login Required
                                    </button>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}
