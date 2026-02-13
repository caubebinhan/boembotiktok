import React, { useState, useRef, useEffect, useCallback } from 'react'
import { RightPanel } from './RightPanel'
import { FollowModal } from './FollowModal'
import { ScannedVideo, FilterCriteria, RightPanelTab } from '../types/picker'

const DEFAULT_FILTERS: FilterCriteria = {
    minViews: 0,
    minLikes: 0,
    minComments: 0,
    dateFrom: '',
    dateTo: ''
}

interface VideoPickerProps {
    mode?: 'standalone' | 'select_source'
    onSelectSource?: (source: any) => void
}

export const VideoPicker: React.FC<VideoPickerProps> = ({ mode = 'standalone', onSelectSource }) => {
    const [url, setUrl] = useState('https://www.tiktok.com/@vtv24news')
    const [status, setStatus] = useState('')
    const webviewRef = useRef<any>(null)
    const [activeTab, setActiveTab] = useState<RightPanelTab>(mode === 'select_source' ? 'targets' : 'scanned')

    // Scanned Data
    const [scannedVideos, setScannedVideos] = useState<ScannedVideo[]>([])
    const [filters, setFilters] = useState<FilterCriteria>({ ...DEFAULT_FILTERS })

    // Follow Modal
    const [followModal, setFollowModal] = useState<{ type: 'channel' | 'keyword', name: string } | null>(null)

    // Scan All state
    const [isScanningAll, setIsScanningAll] = useState(false)
    const scanAllRef = useRef(false) // used to signal stop

    // Data trigger & Counts
    const [collectionVersion, setCollectionVersion] = useState(0)
    const [collectionCount, setCollectionCount] = useState(0)
    const [sourcesCount, setSourcesCount] = useState(0)

    // === Cart State (Wizard Mode) ===
    const [cart, setCart] = useState<{
        channels: { name: string, avatar?: string }[],
        keywords: { keyword: string }[],
        videos: ScannedVideo[]
    }>({ channels: [], keywords: [], videos: [] })

    // Load counts on mount and when version changes
    useEffect(() => {
        const loadCounts = async () => {
            try {
                // Only load saved collection if NOT in select_source mode
                if (mode !== 'select_source') {
                    // @ts-ignore
                    const col = await window.api.invoke('get-collection')
                    setCollectionCount(col ? col.length : 0)
                    setScannedVideos(col || [])
                } else {
                    // In wizard mode, start fresh but keep cart
                    setCollectionCount(0)
                }

                // @ts-ignore
                const src = await window.api.invoke('get-sources')
                setSourcesCount((src?.channels?.length || 0) + (src?.keywords?.length || 0))
            } catch { /* ignore */ }
        }
        loadCounts()
    }, [collectionVersion, activeTab])

    // WebView navigation listener
    useEffect(() => {
        const webview = webviewRef.current
        if (!webview) return
        const handleNav = (e: any) => setUrl(e.url)
        webview.addEventListener('did-navigate', handleNav)
        webview.addEventListener('did-navigate-in-page', handleNav)
        return () => {
            webview.removeEventListener('did-navigate', handleNav)
            webview.removeEventListener('did-navigate-in-page', handleNav)
        }
    }, [])

    // === Scrape Channel Info from current page ===
    const scanChannelInfo = useCallback(async () => {
        const webview = webviewRef.current
        if (!webview) return null

        const script = `
            (function() {
                const avatar = document.querySelector('img[src*="tiktokcdn"]')?.getAttribute('src') || '';
                const nickname = document.querySelector('[data-e2e="user-title"]')?.textContent || '';
                const bio = document.querySelector('[data-e2e="user-bio"]')?.textContent || '';
                const followers = document.querySelector('[data-e2e="followers-count"]')?.textContent || '0';
                const following = document.querySelector('[data-e2e="following-count"]')?.textContent || '0';
                const likes = document.querySelector('[data-e2e="likes-count"]')?.textContent || '0';
                return { avatar, nickname, bio, followers, following, likes };
            })();
        `
        try {
            return await webview.executeJavaScript(script)
        } catch (e) {
            console.error('Failed to scrape channel:', e)
            return null
        }
    }, [])

    // === Core scan function (reusable for single & scan all) ===
    const scanCurrentPage = useCallback(async (): Promise<ScannedVideo[]> => {
        const webview = webviewRef.current
        if (!webview) return []

        const script = `
            (function() {
                const results = [];
                // Target both Feed (div based) and Grid (a href based) layouts
                // Use a more generic approach: find all links to videos
                const anchors = Array.from(document.querySelectorAll('a'));
                const videoLinks = anchors.filter(a => a.href.includes('/video/') && !a.href.includes('/search')); 
                const seen = new Set();

                videoLinks.forEach(link => {
                    const idMatch = link.href.match(/\\/video\\/(\\d+)/);
                    if (idMatch && !seen.has(idMatch[1])) {
                        seen.add(idMatch[1]);
                        
                        // Try to find container
                        const container = link.closest('[data-e2e="user-post-item"]') || 
                                          link.closest('div[class*="DivItemContainer"]') || 
                                          link.parentElement;

                        // Scrape Stats
                        let viewsText = '';
                        // Try standard selector
                        if (container) {
                            viewsText = container.querySelector('[data-e2e="video-views"]')?.textContent || 
                                        container.textContent.match(/(\\d+(\\.\\d+)?[KMB]?)\\s*Play/)?.[1] ||
                                        container.textContent.match(/(\\d+(\\.\\d+)?[KMB]?)/)?.[0] || '';
                        }

                        // Likes are hard to get from grid, usually only on hover or detail. 
                        // If not found, leave empty or 'N/A' rather than random
                        let likesText = '';
                        // Sometimes likes are shown
                        if (container) {
                             likesText = container.querySelector('[data-e2e="video-likes"]')?.textContent || '';
                        }

                        // Thumbnail
                        let thumbSrc = '';
                        const img = link.querySelector('img');
                        // TikTok often uses background-image or picture/source tags
                        if (img) thumbSrc = img.src;
                        if (!thumbSrc && container) {
                             const style = window.getComputedStyle(container);
                             const bg = style.backgroundImage;
                             if (bg && bg.startsWith('url(')) {
                                 thumbSrc = bg.slice(5, -2);
                             }
                        }
                        
                        // Fallback for thumbnail: try to get the 'poster' if it's a video element playing
                        if (!thumbSrc && container) {
                            const videoEl = container.querySelector('video');
                            if (videoEl) thumbSrc = videoEl.poster;
                        }

                        results.push({
                            id: idMatch[1],
                            url: link.href,
                            description: link.title || link.innerText?.slice(0, 80).replace(/\\n/g, ' ') || 'No description',
                            thumbnail: thumbSrc || '', 
                            stats: {
                                views: viewsText || '0',
                                likes: likesText || '0', // No more random
                                comments: '0' // Comments rarely shown on grid
                            },
                            selected: false
                        });
                    }
                });
                return results;
            })();
        `

        try {
            const results = await webview.executeJavaScript(script)
            if (!results || !Array.isArray(results)) return []

            const ids = results.map((v: any) => v.id)
            // @ts-ignore
            const existingIds: string[] = await window.api.invoke('check-videos', ids)
            const existingSet = new Set(existingIds)

            const mapped = results.map((v: any) => ({
                ...v,
                exists: existingSet.has(v.id),
                selected: !existingSet.has(v.id)
            }))

            // Highlight in webview
            await webview.executeJavaScript(`
                (function() {
                    const ids = ${JSON.stringify(ids)};
                    document.querySelectorAll('a').forEach(a => {
                        if(ids.some(id => a.href.includes('/video/' + id))) {
                           a.style.border = '2px solid #25f4ee';
                        }
                    });
                })();
            `)

            return mapped
        } catch (err) {
            console.error('Scan failed:', err)
            return []
        }
    }, [])

    // === Merge scan results into state ===
    const mergeResults = useCallback((newVideos: ScannedVideo[]): number => {
        let addedCount = 0
        setScannedVideos(prev => {
            const prevIds = new Set(prev.map(v => v.id))
            const unique = newVideos.filter(v => !prevIds.has(v.id))
            addedCount = unique.length
            return [...prev, ...unique]
        })
        return addedCount
    }, [])

    // === Single Scan ===
    const handleScanPage = async () => {
        setStatus('Scanning page…')
        const results = await scanCurrentPage()
        const newCount = mergeResults(results)
        const existCount = results.filter(v => v.exists).length
        setStatus(`Found ${results.length} videos (${newCount} new, ${existCount} already in collection)`)
        setActiveTab('scanned')
    }

    // === Scan All (auto-scroll entire channel) ===
    const handleScanAll = async () => {
        const webview = webviewRef.current
        if (!webview) return

        setIsScanningAll(true)
        scanAllRef.current = true
        setStatus('Scan All: starting…')

        let totalNew = 0
        let round = 0
        let prevCount = -1

        while (scanAllRef.current) {
            round++
            setStatus(`Scan All: round ${round}… (${totalNew} new videos so far)`)

            // Scan current visible videos
            const results = await scanCurrentPage()
            const newCount = mergeResults(results)
            totalNew += newCount

            // Get current video count in DOM
            const currentCount = await webview.executeJavaScript(`
                document.querySelectorAll('a[href*="/video/"]').length
            `)

            // If no new links appeared, we've reached the end
            if (currentCount === prevCount && newCount === 0) {
                setStatus(`Scan All complete: ${totalNew} new videos found in ${round} rounds`)
                break
            }
            prevCount = currentCount

            // Scroll down to load more
            await webview.executeJavaScript(`
                window.scrollTo(0, document.documentElement.scrollHeight);
            `)

            // Wait for content to load
            await new Promise(r => setTimeout(r, 2000))
        }

        if (!scanAllRef.current) {
            setStatus(`Scan All stopped: ${totalNew} new videos found`)
        }

        setIsScanningAll(false)
        scanAllRef.current = false
        setActiveTab('scanned')
    }

    const handleStopScanAll = () => {
        scanAllRef.current = false
    }

    // === Add to Cart Handlers (Wizard Mode) ===
    const addToCart = async (type: 'channel' | 'keyword' | 'video', value: any) => {
        if (type === 'channel') {
            const metadata = await scanChannelInfo()
            setCart(prev => {
                if (prev.channels.some(c => c.name === value)) return prev
                return { ...prev, channels: [...prev.channels, { name: value, avatar: metadata?.avatar }] }
            })
            setStatus(`Added channel @${value} to targets`)
            setActiveTab('targets')
        } else if (type === 'keyword') {
            setCart(prev => {
                if (prev.keywords.some(k => k.keyword === value)) return prev
                return { ...prev, keywords: [...prev.keywords, { keyword: value }] }
            })
            setStatus(`Added keyword "${value}" to targets`)
            setActiveTab('targets')
        } else if (type === 'video') {
            // value is a ScannedVideo object or partial
            setCart(prev => {
                if (prev.videos.some(v => v.id === value.id)) return prev
                return { ...prev, videos: [...prev.videos, value] }
            })
            setStatus(`Added video to targets`)
        }
    }

    // === Add This Video Logic (Context Aware) ===
    const handleAddThisVideo = async () => {
        const videoMatch = url.match(/\/video\/(\d+)/)
        if (!videoMatch) {
            setStatus('No video detected on this page')
            return
        }
        const platformId = videoMatch[1]

        if (mode === 'select_source') {
            // WIZARD MODE: Add to Cart
            const video: ScannedVideo = {
                id: platformId,
                url: url,
                description: 'Manually added',
                thumbnail: '', // Hard to get without scraping, maybe scanCurrentPage can help
                stats: { views: 0, likes: 0, comments: 0 },
                selected: true,
                exists: false
            }

            // Try to scrape better details
            const scraped = await scanCurrentPage()
            const found = scraped.find(v => v.id === platformId)

            addToCart('video', found || video)
        } else {
            // STANDALONE MODE: Add to Global DB
            const videoUrl = url
            setStatus('Adding this video…')
            try {
                // @ts-ignore
                await window.api.invoke('add-video', videoUrl)
                setStatus(`Video added to collection!`)
                setCollectionVersion(v => v + 1)
                setScannedVideos(prev =>
                    prev.map(v => v.id === platformId ? { ...v, exists: true, selected: false } : v)
                )
            } catch (err) {
                console.error('Failed to add video:', err)
                setStatus('Failed to add video')
            }
        }
    }

    // === Toggle Selection ===
    const handleToggleSelect = (id: string) => {
        setScannedVideos(prev => prev.map(v => v.id === id ? { ...v, selected: !v.selected } : v))
    }

    const handleSelectAll = () => {
        setScannedVideos(prev => prev.map(v => {
            // Check filters
            if (v.stats.views < filters.minViews) return v
            if (v.stats.likes < filters.minLikes) return v
            if (v.stats.comments < filters.minComments) return v

            // Don't selecting if already exists
            if (v.exists) return v

            return { ...v, selected: true }
        }))
    }

    const handleDeselectAll = () => {
        setScannedVideos(prev => prev.map(v => ({ ...v, selected: false })))
    }

    // === Add Selected (Standalone) ===
    const handleAddSelected = async () => {
        const selected = scannedVideos.filter(v =>
            v.selected && !v.exists &&
            v.stats.views >= filters.minViews &&
            v.stats.likes >= filters.minLikes
        )
        if (selected.length === 0) return

        setStatus(`Adding ${selected.length} videos…`)
        let count = 0
        for (const video of selected) {
            try {
                // @ts-ignore
                await window.api.invoke('add-video', video.url)
                count++
                setScannedVideos(prev =>
                    prev.map(v => v.id === video.id ? { ...v, exists: true, selected: false } : v)
                )
            } catch (err) {
                console.error(`Failed to add ${video.id}`, err)
            }
        }
        setStatus(`Added ${count} videos to collection`)
        setCollectionVersion(v => v + 1)
    }

    // === Add Selected to Cart (Wizard Mode) ===
    const handleAddSelectedToCart = () => {
        const selected = scannedVideos.filter(v => v.selected)
        if (selected.length === 0) return

        setCart(prev => {
            const newVids = selected.filter(s => !prev.videos.some(pv => pv.id === s.id))
            return { ...prev, videos: [...prev.videos, ...newVids] }
        })
        setStatus(`Added ${selected.length} videos to targets`)
        setActiveTab('targets')

        // Unselect them in the view to indicate done
        setScannedVideos(prev => prev.map(v => v.selected ? { ...v, selected: false } : v))
    }

    // === Remove Video Logic (Lifted State) ===
    const handleRemoveVideo = async (id: number | string, platformId: string) => {
        try {
            // @ts-ignore
            await window.api.invoke('remove-video', id)
            // Update scannedVideos to uncheck exists
            setScannedVideos(prev => prev.map(v =>
                v.id === platformId ? { ...v, exists: false, selected: false } : v
            ))
            setCollectionVersion(v => v + 1)
        } catch { /* ignore */ }
    }

    const handleRemoveAllVideo = async () => {
        try {
            // @ts-ignore
            await window.api.invoke('remove-all-videos')
            // Reset all scanned videos
            setScannedVideos(prev => prev.map(v => ({ ...v, exists: false, selected: false })))
            setCollectionVersion(v => v + 1)
        } catch { /* ignore */ }
    }

    // === Follow Logic ===
    const isProfile = url.includes('/@')
    const isSearch = url.includes('/search')
    const isVideoPage = /\/video\/\d+/.test(url)

    const extractChannelName = (): string | null => {
        const m = url.match(/@([\w.]+)/)
        return m ? m[1] : null
    }
    const extractSearchKeyword = (): string | null => {
        try {
            return new URL(url).searchParams.get('q')
        } catch { return null }
    }

    const handleFollowConfirm = async (criteria: FilterCriteria) => {
        if (!followModal) return
        const criteriaJson = JSON.stringify(criteria)

        try {
            if (followModal.type === 'channel') {
                const metadata = await scanChannelInfo()
                // @ts-ignore
                await window.api.invoke('add-account', followModal.name, criteriaJson, metadata)
            } else {
                // @ts-ignore
                await window.api.invoke('add-keyword', followModal.name, criteriaJson)
            }
            setStatus(`${followModal.type === 'channel' ? 'Channel' : 'Keyword'} "${followModal.name}" followed!`)
            setFollowModal(null)
            setActiveTab('sources')
            setCollectionVersion(v => v + 1)
        } catch (err) {
            console.error('Follow failed:', err)
            setStatus('Failed to follow')
        }
    }

    // Downloads
    const [downloads, setDownloads] = useState<any[]>([])
    const [downloadsCount, setDownloadsCount] = useState(0)

    useEffect(() => {
        const loadDownloads = async () => {
            try {
                // @ts-ignore
                const d = await window.api.invoke('get-downloads')
                setDownloads(d || [])
                setDownloadsCount(d?.length || 0)
            } catch { }
        }
        loadDownloads()
        // @ts-ignore
        const removeUpdateListener = window.api.on('download-updated', (data: any[]) => {
            setDownloads(data)
            setDownloadsCount(data.length)
        })
        // @ts-ignore
        const removeCompleteListener = window.api.on('download-complete', (item: any) => {
            setStatus(`Download complete: ${item.platform_id}`)
            setCollectionVersion(v => v + 1)
        })
        return () => {
            removeUpdateListener()
            removeCompleteListener()
        }
    }, [])

    return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'var(--bg-primary)' }}>

            {/* === Top Toolbar (Full Width) === */}
            <div className="toolbar" style={{ flexShrink: 0 }}>
                <input
                    type="text"
                    className="toolbar-input"
                    value={url}
                    onChange={e => setUrl(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') webviewRef.current?.loadURL(url) }}
                    placeholder="Enter TikTok URL…"
                />
                <button
                    className="btn btn-secondary"
                    onClick={() => webviewRef.current?.loadURL(url)}
                >
                    Go
                </button>

                <div style={{ width: '1px', height: '20px', background: 'var(--border-primary)' }} />

                {/* === Context-aware buttons for Cart === */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>

                    {/* Mode: Selection (Campaign Wizard) */}
                    {mode === 'select_source' && (
                        <>
                            {/* Finish Button */}
                            <button
                                className="btn btn-emerald"
                                style={{
                                    border: '2px solid #fff', boxShadow: '0 0 12px rgba(0,0,0,0.3)',
                                    fontSize: '14px', fontWeight: 700, padding: '8px 16px',
                                    letterSpacing: '0.5px'
                                }}
                                onClick={() => onSelectSource?.(cart)}
                            >
                                ✅ FINISH & IMPORT ({cart.channels.length + cart.keywords.length + cart.videos.length})
                            </button>

                            {/* Add Channel Button */}
                            {extractChannelName() && (
                                <button className="btn btn-teal" onClick={() => {
                                    const ch = extractChannelName()
                                    if (ch) addToCart('channel', ch)
                                }}>
                                    + Target Channel
                                </button>
                            )}

                            {/* Add Keyword Button */}
                            {extractSearchKeyword() && (
                                <button className="btn btn-orange" onClick={() => {
                                    const kw = extractSearchKeyword()
                                    if (kw) addToCart('keyword', kw)
                                }}>
                                    + Target Keyword
                                </button>
                            )}
                        </>
                    )}

                    {/* VIDEO DETAIL: Add This Video */}
                    {isVideoPage && (
                        <button className="btn btn-primary" onClick={handleAddThisVideo}>
                            ✚ {mode === 'select_source' ? 'Target This Video' : 'Add to Library'}
                        </button>
                    )}

                    {/* PROFILE: Scan, Scan All, Follow Channel */}
                    {isProfile && !isVideoPage && mode !== 'select_source' && (
                        <>
                            <button className="btn btn-danger" onClick={handleScanPage} disabled={isScanningAll}>
                                ⚡ Scan Page
                            </button>

                            {!isScanningAll ? (
                                <button className="btn btn-danger" onClick={handleScanAll} style={{ background: '#d4388a' }}>
                                    ⚡ Scan All
                                </button>
                            ) : (
                                <button className="btn btn-danger" disabled style={{ background: '#d4388a', opacity: 0.85 }}>
                                    <span className="spinner" /> Scanning…
                                </button>
                            )}

                            {isScanningAll && (
                                <button className="btn btn-ghost" onClick={handleStopScanAll} style={{ color: 'var(--accent-red)' }}>
                                    ◼ Stop
                                </button>
                            )}

                            <button
                                className="btn btn-teal"
                                onClick={() => {
                                    const ch = extractChannelName()
                                    if (ch) setFollowModal({ type: 'channel', name: ch })
                                }}
                            >
                                📺 Follow
                            </button>
                        </>
                    )}

                    {/* WIZARD MODE SCAN BUTTONS */}
                    {isProfile && !isVideoPage && mode === 'select_source' && (
                        <button className="btn btn-danger" onClick={handleScanPage}>
                            ⚡ Scan Page Videos
                        </button>
                    )}

                    {/* SEARCH ACTIONS */}
                    {isSearch && mode !== 'select_source' && (
                        <>
                            <button className="btn btn-danger" onClick={handleScanPage}>
                                ⚡ Scan Page
                            </button>
                            <button
                                className="btn btn-orange"
                                onClick={() => {
                                    const kw = extractSearchKeyword()
                                    if (kw) setFollowModal({ type: 'keyword', name: kw })
                                }}
                            >
                                🔍 Follow
                            </button>
                        </>
                    )}

                    {isSearch && mode === 'select_source' && (
                        <button className="btn btn-danger" onClick={handleScanPage}>
                            ⚡ Scan Page Videos
                        </button>
                    )}
                </div>

                {/* HOME / FEED (no special markers): Scan only */}
                {!isProfile && !isSearch && !isVideoPage && (
                    <button className="btn btn-danger" onClick={handleScanPage}>
                        ⚡ Scan
                    </button>
                )}
            </div>

            {/* Status Bar */}
            {status && <div className="status-bar">{status}</div>}

            {/* === Main Content Area (Split View) === */}
            <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                {/* Left: WebView */}
                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0, borderRight: '1px solid var(--border-primary)' }}>
                    <webview
                        ref={webviewRef}
                        src="https://www.tiktok.com/@vtv24news"
                        style={{ flex: 1, border: 'none' }}
                        // @ts-ignore
                        allowpopups="true"
                    />
                </div>

                {/* Right: Tabbed Panel */}
                <RightPanel
                    activeTab={activeTab}
                    onTabChange={setActiveTab}
                    scannedVideos={scannedVideos}
                    filters={filters}
                    onFilterChange={(k, v) => setFilters(prev => ({ ...prev, [k]: v }))}
                    onFilterReset={() => setFilters({ ...DEFAULT_FILTERS })}
                    onToggleSelect={handleToggleSelect}
                    onAddSelected={mode === 'select_source' ? handleAddSelectedToCart : handleAddSelected}
                    onSelectAll={handleSelectAll}
                    onDeselectAll={handleDeselectAll}
                    collectionVersion={collectionVersion}
                    // New props
                    isScanning={isScanningAll}
                    collectionCount={collectionCount}
                    sourcesCount={sourcesCount}
                    onRefreshCounts={() => setCollectionVersion(v => v + 1)}
                    // Pass handlers for removal
                    onRemoveVideo={handleRemoveVideo}
                    onRemoveAll={handleRemoveAllVideo}
                    // Downloads
                    downloads={downloads}
                    downloadsCount={downloadsCount}
                    hideLibrary={mode === 'select_source'}
                    // Cart Props
                    cart={cart}
                    onRemoveFromCart={(type, id) => {
                        if (type === 'channel') setCart(p => ({ ...p, channels: p.channels.filter(c => c.name !== id) }))
                        else if (type === 'keyword') setCart(p => ({ ...p, keywords: p.keywords.filter(k => k.keyword !== id) }))
                        else if (type === 'video') setCart(p => ({ ...p, videos: p.videos.filter(v => v.id !== id) }))
                    }}
                />
            </div>

            {/* === Follow Modal === */}
            {followModal && (
                <FollowModal
                    type={followModal.type}
                    name={followModal.name}
                    onConfirm={handleFollowConfirm}
                    onCancel={() => setFollowModal(null)}
                />
            )}
        </div>
    )
}
