import React from 'react'

type Tab = 'campaigns' | 'resources' | 'schedule' | 'stats' | 'settings'

interface SidebarProps {
    activeTab: Tab
    onTabChange: (tab: Tab) => void
}

export const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange }) => {
    const tabs: { id: Tab; label: string; icon: string }[] = [
        { id: 'campaigns', label: 'Campaigns', icon: '📢' },
        { id: 'resources', label: 'Resources', icon: '📦' },
        { id: 'schedule', label: 'Schedule', icon: '📅' },
        { id: 'stats', label: 'Statistics', icon: '📊' },
        { id: 'settings', label: 'Settings', icon: '⚙️' },
    ]

    return (
        <div style={{
            width: '80px',
            height: '100%',
            background: 'var(--bg-secondary)',
            borderRight: '1px solid var(--border-primary)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: '16px',
            gap: '4px',
            flexShrink: 0
        }}>
            {/* App Logo */}
            <div style={{
                width: '40px',
                height: '40px',
                borderRadius: '12px',
                background: 'var(--gradient-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '18px',
                fontWeight: 700,
                color: '#fff',
                marginBottom: '16px',
                boxShadow: 'var(--shadow-button)'
            }}>
                B
            </div>

            {tabs.map(tab => (
                <div
                    key={tab.id}
                    onClick={() => onTabChange(tab.id)}
                    style={{
                        width: '56px',
                        height: '56px',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '12px',
                        cursor: 'pointer',
                        background: activeTab === tab.id ? 'var(--bg-active)' : 'transparent',
                        color: activeTab === tab.id ? 'var(--accent-primary)' : 'var(--text-muted)',
                        transition: 'all 0.2s ease',
                        border: activeTab === tab.id ? '1px solid var(--border-primary)' : '1px solid transparent',
                        position: 'relative'
                    }}
                    title={tab.label}
                    onMouseOver={(e) => {
                        if (activeTab !== tab.id) {
                            e.currentTarget.style.background = 'var(--bg-tertiary)'
                            e.currentTarget.style.color = 'var(--text-secondary)'
                        }
                    }}
                    onMouseOut={(e) => {
                        if (activeTab !== tab.id) {
                            e.currentTarget.style.background = 'transparent'
                            e.currentTarget.style.color = 'var(--text-muted)'
                        }
                    }}
                >
                    {activeTab === tab.id && (
                        <div style={{
                            position: 'absolute',
                            left: '-12px',
                            width: '3px',
                            height: '20px',
                            borderRadius: '0 2px 2px 0',
                            background: 'var(--accent-primary)'
                        }} />
                    )}
                    <div style={{ fontSize: '20px', marginBottom: '3px' }}>{tab.icon}</div>
                    <div style={{ fontSize: '9px', fontWeight: 600, letterSpacing: '0.3px' }}>{tab.label}</div>
                </div>
            ))}
        </div>
    )
}
