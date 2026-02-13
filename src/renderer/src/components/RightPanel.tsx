import React, { useEffect, useState } from 'react'
import { ScannedVideo, SavedVideo, FollowedChannel, FollowedKeyword, FilterCriteria, RightPanelTab } from '../types/picker'
import { FilterBar } from './FilterBar'
import { SourceCard } from './SourceCard'

interface RightPanelProps {
    activeTab: RightPanelTab
    onTabChange: (tab: RightPanelTab) => void
    // Scanned
    scannedVideos: ScannedVideo[]
    filters: FilterCriteria
    onFilterChange: (key: keyof FilterCriteria, value: any) => void
    onFilterReset: () => void
    onToggleSelect: (id: string) => void
    onAddSelected: () => void
    onSelectAll?: () => void
    onDeselectAll?: () => void
    // Collection refresh signal
    collectionVersion?: number
    // New props for Phase 3 & 4
    isScanning?: boolean
    collectionCount?: number
    sourcesCount?: number
    onRefreshCounts?: () => void
    onRemoveVideo?: (id: number | string, platformId: string) => void
    onRemoveAll?: () => void
    downloads?: any[]
    downloadsCount?: number
    hideLibrary?: boolean
    cart?: {
        channels: { name: string, avatar?: string }[]
        keywords: { keyword: string }[]
        videos: ScannedVideo[]
    }
    onRemoveFromCart?: (type: 'channel' | 'keyword' | 'video', id: string) => void
}

import DownloadItemCard from './DownloadItemCard' // Fixing import if necessary, assuming it exists or using generic
import { CreateCampaignModal } from './CreateCampaignModal'

export const RightPanel: React.FC<RightPanelProps> = ({
    activeTab, onTabChange,
    scannedVideos, filters, onFilterChange, onFilterReset,
    onToggleSelect, onAddSelected, onSelectAll, onDeselectAll,
    collectionVersion,
    isScanning,
    collectionCount,
    sourcesCount,
    onRefreshCounts,
    onRemoveVideo,
    onRemoveAll,
    downloads = [],
    downloadsCount = 0,
    hideLibrary = false,
    cart,
    onRemoveFromCart
}) => {
    const [collection, setCollection] = useState<SavedVideo[]>([])
    const [channels, setChannels] = useState<FollowedChannel[]>([])
    const [keywords, setKeywords] = useState<FollowedKeyword[]>([])

    // Load data for active tab
    const loadCollection = async () => {
        try {
            // @ts-ignore
            const data = await window.api.invoke('get-collection')
            setCollection(data || [])
        } catch { /* ignore */ }
    }

    const loadSources = async () => {
        try {
            // @ts-ignore
            const data = await window.api.invoke('get-sources')
            setChannels((data?.channels || []).map((c: any) => ({
                ...c,
                filterCriteria: tryParse(c.filter_criteria)
            })))
            setKeywords((data?.keywords || []).map((k: any) => ({
                ...k,
                filterCriteria: tryParse(k.filter_criteria)
            })))
        } catch { /* ignore */ }
    }

    useEffect(() => {
        if (!hideLibrary) {
            if (activeTab === 'collection') loadCollection()
            if (activeTab === 'sources') loadSources()
        }
    }, [activeTab, collectionVersion, hideLibrary])

    // Scanned tab filtering
    const filteredScanned = scannedVideos.filter(v => {
        if (v.stats.views < filters.minViews) return false
        if (v.stats.likes < filters.minLikes) return false
        if (v.stats.comments < filters.minComments) return false
        return true
    })

    const selectedCount = filteredScanned.filter(v => v.selected && !v.exists).length

    const handleRemoveSource = async (type: 'channel' | 'keyword', id: number) => {
        try {
            // @ts-ignore
            await window.api.invoke('remove-source', type, id)
            loadSources()
            onRefreshCounts?.()
        } catch { /* ignore */ }
    }

    const confirmRemoveAll = async () => {
        if (!confirm('Are you sure you want to remove ALL videos from the collection?')) return
        onRemoveAll?.()
    }

    const handleRetryDownload = async (id: number) => {
        try {
            // @ts-ignore
            await window.api.invoke('retry-download', id)
        } catch { }
    }

    const handleClearCompleted = async () => {
        try {
            // @ts-ignore
            await window.api.invoke('clear-completed-downloads')
        } catch { }
    }

    const handleOpenFile = (path: string) => {
        // @ts-ignore
        // We need an IPC for this or just rely on OS specific
        // For now simple alert or log if not implemented
        console.log('Open file:', path)
    }

    // Campaigns (Removed - now in CampaignsView)
    const [campaigns, setCampaigns] = useState<any[]>([])
    const [showCreateCampaign, setShowCreateCampaign] = useState(false)

    // TODO: cleanup unused state variables if they are truly unused by other logic
    // Keeping minimal state here to avoid breaking render if I missed a spot in the diff above,
    // but the actual rendering of CampaignList is gone.

    // Actually, let's remove the logic properly:
    const handleCreateCampaign = async (data: any) => {
        // Moved to CampaignsView
        console.log(data)
    }


    const handleToggleCampaignStatus = async (id: number, currentStatus: string) => {
        // TODO: Implement toggle IPC
        console.log('Toggle status', id, currentStatus)
    }

    return (
        <div style={{
            width: '380px',
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
            overflow: 'hidden', // Contain content
            borderLeft: '1px solid var(--border-primary)',
            background: 'var(--bg-secondary)'
        }}>
            {/* Tabs */}
            <div className="tab-bar">
                {/* Targets Tab (Only visible if wizard mode / cart exists) */}
                {cart && (
                    <div
                        className={`tab-item ${activeTab === 'targets' ? 'active' : ''}`}
                        onClick={() => onTabChange('targets')}
                    >
                        Targets
                        <span className="tab-badge">{cart.channels.length + cart.keywords.length + cart.videos.length}</span>
                    </div>
                )}

                <div
                    className={`tab-item ${activeTab === 'scanned' ? 'active' : ''}`}
                    onClick={() => onTabChange('scanned')}
                >
                    {isScanning ? (
                        <>
                            Scanning <span className="spinner" style={{ width: '8px', height: '8px', marginLeft: '4px', borderWidth: '1px' }} />
                        </>
                    ) : 'Scanned'}
                    <span className="tab-badge">{scannedVideos.length}</span>
                </div>
                {!hideLibrary && (
                    <>
                        <div
                            className={`tab-item ${activeTab === 'collection' ? 'active' : ''}`}
                            onClick={() => onTabChange('collection')}
                        >
                            Collection
                            <span className="tab-badge">{collectionCount ?? collection.length}</span>
                        </div>
                        <div
                            className={`tab-item ${activeTab === 'sources' ? 'active' : ''}`}
                            onClick={() => onTabChange('sources')}
                        >
                            Sources
                            <span className="tab-badge">{sourcesCount ?? (channels.length + keywords.length)}</span>
                        </div>
                        <div
                            className={`tab-item ${activeTab === 'downloads' ? 'active' : ''}`}
                            onClick={() => onTabChange('downloads')}
                        >
                            Downloads
                            <span className="tab-badge">{downloadsCount ?? downloads.length}</span>
                        </div>
                    </>
                )}
            </div>

            {/* Content */}
            {activeTab === 'targets' && cart && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {cart.channels.length === 0 && cart.keywords.length === 0 && cart.videos.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-icon">🎯</div>
                            <div className="empty-text">
                                No targets selected yet.<br />
                                Add channels, keywords, or videos to run your campaign on.
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* Channels */}
                            {cart.channels.length > 0 && (
                                <div style={{ marginBottom: '8px' }}>
                                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 4px 6px' }}>
                                        Target Channels ({cart.channels.length})
                                    </div>
                                    {cart.channels.map((ch, i) => (
                                        <div key={i} className="video-card" style={{ cursor: 'default', padding: '8px' }}>
                                            <div className="thumb" style={{ width: '32px', height: '32px', borderRadius: '50%' }}>
                                                {ch.avatar ? <img src={ch.avatar} alt="" style={{ borderRadius: '50%' }} /> : <div className="thumb-placeholder">👤</div>}
                                            </div>
                                            <div className="meta">
                                                <div className="desc" style={{ fontWeight: 600 }}>@{ch.name}</div>
                                            </div>
                                            <button className="btn-icon" onClick={() => onRemoveFromCart?.('channel', ch.name)} style={{ color: 'var(--accent-red)' }}>
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Keywords */}
                            {cart.keywords.length > 0 && (
                                <div style={{ marginBottom: '8px' }}>
                                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 4px 6px' }}>
                                        Target Keywords ({cart.keywords.length})
                                    </div>
                                    {cart.keywords.map((kw, i) => (
                                        <div key={i} className="video-card" style={{ cursor: 'default', padding: '8px' }}>
                                            <div className="thumb" style={{ width: '32px', height: '32px', background: 'var(--bg-tertiary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                                🔍
                                            </div>
                                            <div className="meta">
                                                <div className="desc" style={{ fontWeight: 600 }}>{kw.keyword}</div>
                                            </div>
                                            <button className="btn-icon" onClick={() => onRemoveFromCart?.('keyword', kw.keyword)} style={{ color: 'var(--accent-red)' }}>
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* Videos */}
                            {cart.videos.length > 0 && (
                                <div>
                                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 4px 6px' }}>
                                        Specific Videos ({cart.videos.length})
                                    </div>
                                    {cart.videos.map(video => (
                                        <div key={video.id} className="video-card" style={{ cursor: 'default' }}>
                                            <div className="thumb">
                                                {video.thumbnail ? <img src={video.thumbnail} alt="" /> : <div className="thumb-placeholder">🎬</div>}
                                            </div>
                                            <div className="meta">
                                                <div className="desc">{video.description}</div>
                                                <div className="stats">
                                                    <span>{formatNum(video.stats.views)} views</span>
                                                </div>
                                            </div>
                                            <button className="btn-icon" onClick={() => onRemoveFromCart?.('video', video.id)} style={{ color: 'var(--accent-red)' }}>
                                                ✕
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {activeTab === 'scanned' && (
                <>
                    <FilterBar
                        filters={filters}
                        onFilterChange={onFilterChange}
                        total={scannedVideos.length}
                        visible={filteredScanned.length}
                        onReset={onFilterReset}
                    />
                    {filteredScanned.length > 0 && (
                        <div style={{ padding: '4px 8px', display: 'flex', gap: '8px', borderBottom: '1px solid var(--border-primary)' }}>
                            <button className="btn btn-ghost btn-sm" onClick={onSelectAll} style={{ fontSize: '10px', padding: '2px 8px' }}>
                                ☑ Select All
                            </button>
                            <button className="btn btn-ghost btn-sm" onClick={onDeselectAll} style={{ fontSize: '10px', padding: '2px 8px' }}>
                                ☐ Deselect All
                            </button>
                        </div>
                    )}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {filteredScanned.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon">🔍</div>
                                <div className="empty-text">
                                    No videos scanned yet.<br />
                                    Browse TikTok and click <strong>Scan Page</strong>.
                                </div>
                            </div>
                        ) : (
                            filteredScanned.map(video => (
                                <div
                                    key={video.id}
                                    className={`video-card ${video.selected ? 'selected' : ''} ${video.exists ? 'exists' : ''}`}
                                    onClick={() => onToggleSelect(video.id)}
                                >
                                    <div className="thumb">
                                        {video.thumbnail ? (
                                            <img src={video.thumbnail} alt="" />
                                        ) : (
                                            <div className="thumb-placeholder">🎬</div>
                                        )}
                                        {video.exists && <div className="badge-added">Added</div>}
                                    </div>
                                    <div className="meta">
                                        <div className="desc">{video.description || 'No description'}</div>
                                        <div className="stats">
                                            <span>👁 {formatNum(video.stats.views)}</span>
                                            <span>❤️ {formatNum(video.stats.likes)}</span>
                                            {video.stats.comments > 0 && <span>💬 {formatNum(video.stats.comments)}</span>}
                                        </div>
                                    </div>
                                    <div className="checkbox-area">
                                        {!video.exists && (
                                            <input
                                                type="checkbox"
                                                checked={video.selected}
                                                onChange={() => { }}
                                            />
                                        )}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    {selectedCount > 0 && (
                        <div className="action-bar">
                            <button className="btn btn-primary" onClick={onAddSelected}>
                                {hideLibrary ? `✚ Add to Tasks (${selectedCount})` : `✚ Add Selected (${selectedCount})`}
                            </button>
                        </div>
                    )}
                </>
            )}

            {activeTab === 'collection' && (
                <>
                    {collection.length > 0 && (
                        <div style={{ padding: '8px 8px 0', textAlign: 'right' }}>
                            <button className="btn btn-ghost btn-sm" onClick={confirmRemoveAll} style={{ color: 'var(--accent-red)', fontSize: '10px' }}>
                                🗑 Remove All
                            </button>
                        </div>
                    )}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {collection.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon">📦</div>
                                <div className="empty-text">
                                    No videos in collection yet.<br />
                                    Scan and add videos to see them here.
                                </div>
                            </div>
                        ) : (
                            collection.map((video: any) => (
                                <div key={video.id} className="video-card" style={{ cursor: 'default' }}>
                                    <div className="thumb">
                                        <div className="thumb-placeholder">🎬</div>
                                    </div>
                                    <div className="meta">
                                        <div className="desc">{video.description || video.url}</div>
                                        <div className="stats">
                                            <span className={`status-badge ${video.status}`}>{video.status}</span>
                                            <span style={{ fontSize: '10px', color: 'var(--text-muted)' }}>
                                                {video.platform_id}
                                            </span>
                                        </div>
                                    </div>
                                    <button
                                        className="btn-icon"
                                        style={{ color: 'var(--accent-red)', opacity: 1 }}
                                        onClick={() => onRemoveVideo?.(video.id, video.platform_id)}
                                        title="Remove from collection"
                                    >
                                        🗑
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </>
            )}

            {activeTab === 'sources' && (
                <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    {channels.length === 0 && keywords.length === 0 ? (
                        <div className="empty-state">
                            <div className="empty-icon">📡</div>
                            <div className="empty-text">
                                No sources yet.<br />
                                Follow channels or keywords to track them.
                            </div>
                        </div>
                    ) : (
                        <>
                            {channels.length > 0 && (
                                <div style={{ marginBottom: '4px' }}>
                                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 4px 6px', marginTop: '4px' }}>
                                        Channels ({channels.length})
                                    </div>
                                    {channels.map((ch: any) => (
                                        <div key={ch.id} style={{ marginBottom: '6px' }}>
                                            <SourceCard
                                                type="channel"
                                                name={ch.username}
                                                filterCriteria={typeof ch.filter_criteria === 'string' ? ch.filter_criteria : JSON.stringify(ch.filter_criteria || {})}
                                                onRemove={() => handleRemoveSource('channel', ch.id)}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                            {keywords.length > 0 && (
                                <div>
                                    <div style={{ fontSize: '10px', fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.5px', padding: '4px 4px 6px', marginTop: '4px' }}>
                                        Keywords ({keywords.length})
                                    </div>
                                    {keywords.map((kw: any) => (
                                        <div key={kw.id} style={{ marginBottom: '6px' }}>
                                            <SourceCard
                                                type="keyword"
                                                name={kw.keyword}
                                                filterCriteria={typeof kw.filter_criteria === 'string' ? kw.filter_criteria : JSON.stringify(kw.filter_criteria || {})}
                                                onRemove={() => handleRemoveSource('keyword', kw.id)}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            )}

            {activeTab === 'downloads' && (
                <>
                    <div style={{ padding: '8px 8px 0', textAlign: 'right' }}>
                        <button className="btn btn-ghost btn-sm" onClick={handleClearCompleted} style={{ fontSize: '10px' }}>
                            Clear Completed
                        </button>
                    </div>
                    <div style={{ flex: 1, overflowY: 'auto', padding: '8px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                        {downloads.length === 0 ? (
                            <div className="empty-state">
                                <div className="empty-icon">⬇️</div>
                                <div className="empty-text">
                                    No downloads yet.<br />
                                    Background scan results will appear here.
                                </div>
                            </div>
                        ) : (
                            downloads.map(item => (
                                <DownloadItemCard
                                    key={item.id}
                                    item={item}
                                    onRetry={handleRetryDownload}
                                    onOpenFile={handleOpenFile}
                                />
                            ))
                        )}
                    </div>
                </>
            )}

        </div>
    )
}
// Helper functions remain same
function formatNum(n: number): string {
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
    return n.toString()
}

function tryParse(s: any): any {
    if (typeof s === 'object') return s
    try { return JSON.parse(s) } catch { return {} }
}
