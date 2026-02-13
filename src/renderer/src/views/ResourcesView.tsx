import React, { useState, useEffect } from 'react'
import { SourceCard } from '../components/SourceCard'

type ResourceTab = 'channels' | 'videos' | 'images'

export const ResourcesView: React.FC = () => {
    const [activeTab, setActiveTab] = useState<ResourceTab>('channels')
    const [loading, setLoading] = useState(true)

    // Data
    const [collection, setCollection] = useState<any[]>([])
    const [sources, setSources] = useState<{ channels: any[]; keywords: any[] }>({ channels: [], keywords: [] })

    useEffect(() => {
        loadData()
    }, [activeTab])

    const loadData = async () => {
        setLoading(true)
        try {
            if (activeTab === 'channels') {
                // @ts-ignore
                const data = await window.api.invoke('get-sources')
                setSources(data || { channels: [], keywords: [] })
            } else if (activeTab === 'videos') {
                // @ts-ignore
                const data = await window.api.invoke('get-collection')
                setCollection(data || [])
            }
        } catch { }
        setLoading(false)
    }

    const tabs: { id: ResourceTab; label: string; icon: string; count?: number }[] = [
        { id: 'channels', label: 'Saved Channels', icon: '📡', count: sources.channels.length },
        { id: 'videos', label: 'Video Library', icon: '🎬', count: collection.length },
        { id: 'images', label: 'Images', icon: '🖼️' }
    ]

    return (
        <div className="page-enter" style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', padding: '24px', overflow: 'hidden' }}>
            {/* Header */}
            <div style={{ marginBottom: '20px' }}>
                <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>Resources</h1>
                <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                    Manage your publish accounts, channels, video library, and media assets
                </p>
            </div>

            {/* Tab Bar */}
            <div className="tab-bar" style={{ marginBottom: '20px' }}>
                {tabs.map(tab => (
                    <div
                        key={tab.id}
                        className={`tab-item ${activeTab === tab.id ? 'active' : ''}`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        <span style={{ marginRight: '6px' }}>{tab.icon}</span>
                        {tab.label}
                        {tab.count !== undefined && (
                            <span className="tab-badge">{tab.count}</span>
                        )}
                    </div>
                ))}
            </div>

            {/* Content */}
            <div style={{ flex: 1, overflowY: 'auto' }}>
                {loading ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '60px' }}>
                        <div style={{ textAlign: 'center' }}>
                            <div className="spinner" style={{ width: '20px', height: '20px', marginBottom: '10px' }} />
                            <div style={{ color: 'var(--text-muted)', fontSize: '13px' }}>Loading...</div>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* ═══ Saved Channels Tab ═══ */}
                        {activeTab === 'channels' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {sources.channels.length === 0 ? (
                                    <div className="empty-state" style={{ padding: '60px' }}>
                                        <div className="empty-icon" style={{ fontSize: '48px' }}>📡</div>
                                        <div className="empty-text" style={{ marginTop: '12px' }}>
                                            No channels tracked yet.<br />
                                            Follow a channel via the Scanner to start tracking.
                                        </div>
                                    </div>
                                ) : (
                                    <>
                                        <div style={{ fontSize: '13px', color: 'var(--text-muted)', marginBottom: '4px' }}>
                                            {sources.channels.length} channel{sources.channels.length !== 1 ? 's' : ''} tracked
                                        </div>
                                        {sources.channels.map(ch => (
                                            <SourceCard
                                                key={ch.id}
                                                type="channel"
                                                name={ch.username}
                                                filterCriteria={ch.filter_criteria}
                                                onRemove={() => { }}
                                            />
                                        ))}
                                    </>
                                )}

                                {/* Keywords section */}
                                {sources.keywords && sources.keywords.length > 0 && (
                                    <div style={{ marginTop: '20px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px' }}>
                                            <span style={{ fontSize: '16px' }}>🔍</span>
                                            <h3 style={{ margin: 0, fontSize: '15px', fontWeight: 600 }}>
                                                Saved Keywords
                                                <span style={{ marginLeft: '8px', fontSize: '13px', fontWeight: 400, color: 'var(--text-muted)' }}>
                                                    ({sources.keywords.length})
                                                </span>
                                            </h3>
                                        </div>
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            {sources.keywords.map((kw: any) => (
                                                <SourceCard
                                                    key={kw.id}
                                                    type="keyword"
                                                    name={kw.keyword}
                                                    filterCriteria={kw.filter_criteria}
                                                    onRemove={() => { }}
                                                />
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* ═══ Video Library Tab ═══ */}
                        {activeTab === 'videos' && (
                            collection.length === 0 ? (
                                <div className="empty-state" style={{ padding: '60px' }}>
                                    <div className="empty-icon" style={{ fontSize: '48px' }}>🎬</div>
                                    <div className="empty-text" style={{ marginTop: '12px' }}>
                                        Your video library is empty.<br />
                                        Scan a channel to discover videos.
                                    </div>
                                </div>
                            ) : (
                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: '12px' }}>
                                    {collection.map(v => (
                                        <div key={v.id} className="card" style={{ padding: '14px' }}>
                                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '8px' }}>
                                                <div style={{ fontWeight: 600, fontSize: '13px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%' }}>
                                                    {v.platform_id}
                                                </div>
                                                <span className="badge" style={{
                                                    background: v.status === 'downloaded' ? 'rgba(74,222,128,0.12)' : 'rgba(124,92,252,0.12)',
                                                    color: v.status === 'downloaded' ? '#4ade80' : '#7c5cfc'
                                                }}>
                                                    {(v.status || 'saved').toUpperCase()}
                                                </span>
                                            </div>
                                            {v.local_path && (
                                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {v.local_path}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )
                        )}

                        {/* ═══ Images Tab ═══ */}
                        {activeTab === 'images' && (
                            <div className="empty-state" style={{ padding: '60px' }}>
                                <div className="empty-icon" style={{ fontSize: '48px' }}>🖼️</div>
                                <div className="empty-text" style={{ marginTop: '12px' }}>
                                    Image library coming soon.<br />
                                    Store thumbnails, watermarks, and overlay assets here.
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>


        </div>
    )
}
