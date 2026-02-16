import React, { useState, useRef, useEffect, useCallback } from 'react'
import ReactDOM from 'react-dom'

export interface VideoCardProps {
    video: {
        id: string
        url: string
        thumbnail?: string
        description?: string
        stats?: {
            views: number | string
            likes: number | string
        }
    }
    onRemove?: () => void
    showStats?: boolean
    compact?: boolean
    className?: string
    children?: React.ReactNode
}

const formatCount = (n: number | string | undefined): string => {
    const num = typeof n === 'string' ? parseInt(n) : (n || 0)
    if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
    if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
    return String(num)
}

export const VideoCard: React.FC<VideoCardProps> = ({ video, onRemove, showStats = true, compact = false, className = '', children }) => {
    const [isHovered, setIsHovered] = useState(false)
    const [popupPos, setPopupPos] = useState<{ top: number; left: number; side: 'left' | 'right' } | null>(null)
    const cardRef = useRef<HTMLDivElement>(null)
    const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
    const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

    // Helper to get embed URL
    const getEmbedUrl = (url: string) => {
        const videoIdMatch = url.match(/\/video\/(\d+)/)
        if (videoIdMatch) {
            return `https://www.tiktok.com/embed/v2/${videoIdMatch[1]}`
        }
        return url
    }

    const cancelLeave = useCallback(() => {
        if (leaveTimer.current) {
            clearTimeout(leaveTimer.current)
            leaveTimer.current = null
        }
    }, [])

    const handleMouseEnter = useCallback(() => {
        cancelLeave()
        hoverTimer.current = setTimeout(() => {
            if (cardRef.current) {
                const rect = cardRef.current.getBoundingClientRect()
                const windowWidth = window.innerWidth
                // Show popup on the side with more space
                const spaceRight = windowWidth - rect.right
                const spaceLeft = rect.left
                const side = spaceRight > 340 ? 'right' : 'left'
                setPopupPos({
                    top: rect.top,
                    left: side === 'right' ? rect.right + 8 : rect.left - 328,
                    side
                })
            }
            setIsHovered(true)
        }, 400) // Small delay before showing popup
    }, [cancelLeave])

    const handleMouseLeave = useCallback(() => {
        if (hoverTimer.current) {
            clearTimeout(hoverTimer.current)
            hoverTimer.current = null
        }
        // Use a delay so user can move mouse to the popup
        leaveTimer.current = setTimeout(() => {
            setIsHovered(false)
            setPopupPos(null)
        }, 300)
    }, [])

    useEffect(() => {
        return () => {
            if (hoverTimer.current) clearTimeout(hoverTimer.current)
            if (leaveTimer.current) clearTimeout(leaveTimer.current)
        }
    }, [])

    const renderPopup = () => {
        if (!isHovered || !popupPos || !video.url) return null
        return ReactDOM.createPortal(
            <div
                className="video-card-popup"
                style={{
                    position: 'fixed',
                    top: Math.max(10, Math.min(popupPos.top, window.innerHeight - 500)),
                    left: popupPos.left,
                    width: '320px',
                    height: '480px',
                    borderRadius: '12px',
                    overflow: 'hidden',
                    background: '#000',
                    border: '1px solid var(--border-primary)',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                    zIndex: 99999,
                    animation: 'fadeIn 0.15s ease'
                }}
                onMouseEnter={() => { cancelLeave(); setIsHovered(true) }}
                onMouseLeave={handleMouseLeave}
            >
                <iframe
                    src={getEmbedUrl(video.url)}
                    width="100%"
                    height="100%"
                    frameBorder="0"
                    allow="autoplay; encrypted-media"
                    style={{ border: 'none' }}
                />
            </div>,
            document.body
        )
    }

    return (
        <>
            <div
                ref={cardRef}
                className={`video-card ${className}`}
                style={{
                    position: 'relative',
                    borderRadius: '8px',
                    overflow: 'hidden',
                    background: '#000',
                    aspectRatio: compact ? '1/1' : '9/16',
                    border: isHovered ? '1px solid var(--accent-purple)' : '1px solid var(--border-primary)',
                    transition: 'all 0.2s',
                    transform: isHovered ? 'scale(1.02)' : 'scale(1)',
                    zIndex: isHovered ? 10 : 1,
                    cursor: 'pointer'
                }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
            >
                {/* Thumbnail — Always visible */}
                {video.thumbnail ? (
                    <img
                        src={video.thumbnail}
                        alt={video.description}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '24px', background: '#111' }}>
                        🎬
                    </div>
                )}

                {/* Remove Button */}
                {onRemove && (
                    <button
                        onClick={(e) => { e.stopPropagation(); onRemove(); }}
                        style={{
                            position: 'absolute', top: '4px', right: '4px',
                            width: '20px', height: '20px', borderRadius: '50%',
                            background: 'rgba(0,0,0,0.6)', color: '#fff', border: 'none',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: '12px', cursor: 'pointer', zIndex: 20
                        }}
                    >
                        ✕
                    </button>
                )}

                {/* Stats Overlay — Always visible */}
                {showStats && (
                    <div style={{
                        position: 'absolute', bottom: '0', left: '0', width: '100%',
                        padding: '6px 8px', background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)',
                        display: 'flex', gap: '10px', alignItems: 'center'
                    }}>
                        <span style={{ fontSize: '11px', color: '#fff', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            👁 {formatCount(video.stats?.views)}
                        </span>
                        <span style={{ fontSize: '11px', color: '#fff', display: 'flex', alignItems: 'center', gap: '3px' }}>
                            ❤️ {formatCount(video.stats?.likes)}
                        </span>
                    </div>
                )}

                {/* Hover indicator */}
                {isHovered && video.url && (
                    <div style={{
                        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
                        background: 'rgba(0,0,0,0.6)', borderRadius: '50%', width: '36px', height: '36px',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '16px'
                    }}>
                        ▶
                    </div>
                )}
                {children}
            </div>

            {/* Floating popup portal */}
            {renderPopup()}
        </>
    )
}
