import React from 'react'
import { ScannedVideo } from '../types/picker'
import { FilterBar } from './FilterBar'

interface VideoSidebarProps {
    videos: ScannedVideo[]
    onToggleSelect: (id: string, shiftKey?: boolean) => void
    onAddSelected: () => void
    filters: {
        minViews: number
        minLikes: number
        minComments: number
        dateRange: string
    }
    onFilterChange: (key: string, value: any) => void
}

export const VideoSidebar: React.FC<VideoSidebarProps> = ({
    videos,
    onToggleSelect,
    onAddSelected,
    filters,
    onFilterChange
}) => {
    // Filter logic
    const filteredVideos = videos.filter(v => {
        const passViews = v.stats.views >= filters.minViews
        const passLikes = v.stats.likes >= filters.minLikes
        // Date logic (MVP: simple check if date exists and is after filter)
        // v.stats.date isn't populated yet in ScannedVideo, so we skip for now or mock
        return passViews && passLikes
    })

    const selectedCount = filteredVideos.filter(v => v.selected).length

    return (
        <div style={{
            width: '320px',
            background: '#16161e',
            borderRight: '1px solid #333',
            display: 'flex',
            flexDirection: 'column',
            height: '100%'
        }}>
            <FilterBar
                filters={filters}
                onFilterChange={onFilterChange}
                total={videos.length}
                visible={filteredVideos.length}
            />

            <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                {filteredVideos.length === 0 ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#555', fontSize: '13px' }}>
                        No videos found. <br /> Try scanning the page.
                    </div>
                ) : (
                    filteredVideos.map(video => (
                        <div
                            key={video.id}
                            onClick={(e) => onToggleSelect(video.id, e.shiftKey)}
                            style={{
                                display: 'flex',
                                gap: '10px',
                                padding: '8px',
                                background: video.selected ? '#24243a' : '#1a1a26',
                                borderRadius: '6px',
                                marginBottom: '8px',
                                cursor: 'pointer',
                                border: video.selected ? '1px solid #7c5cfc' : '1px solid #2a2a35',
                                transition: 'all 0.2s ease',
                                opacity: video.exists ? 0.6 : 1
                            }}
                        >
                            <div style={{ width: '70px', height: '90px', background: '#000', borderRadius: '4px', overflow: 'hidden', flexShrink: 0, position: 'relative' }}>
                                {video.thumbnail ? (
                                    <img src={video.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                ) : (
                                    <div style={{ width: '100%', height: '100%', background: '#333' }} />
                                )}
                                {video.exists && (
                                    <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                        <span style={{ fontSize: '10px', fontWeight: 'bold', color: '#4ade80', background: 'rgba(0,0,0,0.5)', padding: '2px 4px', borderRadius: '4px' }}>ADDED</span>
                                    </div>
                                )}
                            </div>
                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                                <div style={{ fontSize: '12px', fontWeight: '500', color: '#e8e8f0', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', lineHeight: '1.3' }}>
                                    {video.description || 'No description'}
                                </div>
                                <div style={{ display: 'flex', gap: '8px', fontSize: '10px', color: '#9090a8' }}>
                                    <span title="Views">👁️ {(video.stats.views / 1000).toFixed(1)}k</span>
                                    <span title="Likes">❤️ {(video.stats.likes / 1000).toFixed(1)}k</span>
                                </div>
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center' }}>
                                {!video.exists && (
                                    <input
                                        type="checkbox"
                                        checked={video.selected}
                                        onChange={() => { }} // Handled by div click
                                        style={{ margin: 0, cursor: 'pointer' }}
                                    />
                                )}
                            </div>
                        </div>
                    ))
                )}
            </div>

            <div style={{ padding: '16px', borderTop: '1px solid #333', background: '#16161e' }}>
                <button
                    onClick={onAddSelected}
                    disabled={selectedCount === 0}
                    style={{
                        width: '100%',
                        padding: '12px',
                        background: selectedCount > 0 ? 'linear-gradient(135deg, #7c5cfc 0%, #5c8afc 100%)' : '#2a2a36',
                        color: selectedCount > 0 ? '#fff' : '#555',
                        border: 'none',
                        borderRadius: '8px',
                        fontWeight: '600',
                        cursor: selectedCount > 0 ? 'pointer' : 'not-allowed',
                        transition: 'all 0.2s ease',
                        boxShadow: selectedCount > 0 ? '0 4px 12px rgba(124, 92, 252, 0.3)' : 'none'
                    }}
                >
                    Add Selected ({selectedCount})
                </button>
            </div>
        </div>
    )
}
