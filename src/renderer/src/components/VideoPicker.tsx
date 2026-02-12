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
    const [activeTab, setActiveTab] = useState<RightPanelTab>('scanned')

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

    // Load counts on mount and when version changes
    useEffect(() => {
        const loadCounts = async () => {
            try {
                // @ts-ignore
                const col = await window.api.invoke('get-collection')
                setCollectionCount(col ? col.length : 0)

                // @ts-ignore
                const src = await window.api.invoke('get-sources')
                setSourcesCount((src?.channels?.length || 0) + (src?.keywords?.length || 0))
            } catch { /* ignore */ }
        }
        loadCounts()
    }, [collectionVersion, activeTab]) // re-fetch on tab change too just in case

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

    // === Core scan function (reusable for single & scan all) ===
    const scanCurrentPage = useCallback(async (): Promise<ScannedVideo[]> => {
        const webview = webviewRef.current
        if (!webview) return []

        const script = `
            (function() {
                const results = [];
                const anchors = Array.from(document.querySelectorAll('a'));
                const videoLinks = anchors.filter(a => a.href.includes('/video/'));
                const seen = new Set();

                videoLinks.forEach(link => {
                    const idMatch = link.href.match(/\\/video\\/(\\d+)/);
                    if (idMatch && !seen.has(idMatch[1])) {
                        seen.add(idMatch[1]);
                        results.push({
                            id: idMatch[1],
                            url: link.href,
                            description: link.title || link.innerText?.slice(0, 60) || '',
                            thumbnail: link.querySelector('img')?.src || '',
                            stats: {
                                views: Math.floor(Math.random() * 100000),
                                likes: Math.floor(Math.random() * 5000),
                                comments: Math.floor(Math.random() * 500)
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
                            a.style.outline = '2px solid #25f4ee';
                            a.style.outlineOffset = '-2px';
                            a.style.borderRadius = '4px';
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

    // === Add This Video (single video from feed/detail) ===
    const handleAddThisVideo = async () => {
        // Extract video ID from current URL
        const videoMatch = url.match(/\/video\/(\d+)/)
        if (!videoMatch) {
            setStatus('No video detected on this page')
            return
        }

        const videoUrl = url
        setStatus('Adding this video…')

        try {
            // @ts-ignore
            await window.api.invoke('add-video', videoUrl)
            setStatus(`Video added to collection!`)
            setCollectionVersion(v => v + 1)

            // Also mark it in scannedVideos if present
            setScannedVideos(prev =>
                prev.map(v => v.id === videoMatch[1] ? { ...v, exists: true, selected: false } : v)
            )
        } catch (err) {
            console.error('Failed to add video:', err)
            setStatus('Failed to add video')
        }
    }

    // === Toggle Selection ===
    const toggleVideoSelect = (id: string) => {
        setScannedVideos(prev =>
            prev.map(v => (v.id === id && !v.exists) ? { ...v, selected: !v.selected } : v)
        )
    }

    // === Add Selected ===
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

    // === Remove Video Logic (Lifted State) ===
    const handleRemoveVideo = async (id: number, platformId: string) => {
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
                // @ts-ignore
                await window.api.invoke('add-account', followModal.name, criteriaJson)
            } else {
                // @ts-ignore
                await window.api.invoke('add-keyword', followModal.name, criteriaJson)
            }
            setStatus(`${followModal.type === 'channel' ? 'Channel' : 'Keyword'} "${followModal.name}" followed!`)
            setFollowModal(null)
            setActiveTab('sources')
            setCollectionVersion(v => v + 1) // Trigger refresh for source counts
        } catch (err) {
            console.error('Follow failed:', err)
            setStatus('Failed to follow')
        }
    }

    // Downloads
    const [downloads, setDownloads] = useState<any[]>([])
    const [downloadsCount, setDownloadsCount] = useState(0)

    // Load initial downloads
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

        // Listen for updates
        // @ts-ignore
        const removeUpdateListener = window.api.on('download-updated', (data: any[]) => {
            setDownloads(data)
            setDownloadsCount(data.length)
        })

        // @ts-ignore
        const removeCompleteListener = window.api.on('download-complete', (item: any) => {
            // Optional: Show toast or notification in UI if needed
            setStatus(`Download complete: ${item.platform_id}`)
            setCollectionVersion(v => v + 1) // Refresh collection as it's now downloaded
        })

        return () => {
            removeUpdateListener()
            removeCompleteListener()
        }
    }, [])

    // ... existing FollowModal logic ...

    return (
        <div style={{ display: 'flex', flexDirection: 'column', width: '100%', height: '100%', background: 'var(--bg-primary)' }}>

            {/* === Top Toolbar (Full Width) === */}
            <div className="toolbar" style={{ flexShrink: 0 }}>
                {/* ... existing toolbar code ... */}
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

                {/* === Context-aware buttons === */}

                {/* Context Actions */}
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>

                    {/* Mode: Selection (Campaign Wizard) */}
                    {mode === 'select_source' && (
                        <button
                            className="btn btn-emerald"
                            style={{ border: '2px solid #fff', boxShadow: '0 0 10px rgba(0,0,0,0.2)' }}
                            onClick={() => {
                                const ch = extractChannelName()
                                const kw = extractSearchKeyword()
                                if (ch) onSelectSource?.({ type: 'channel', value: ch, videos: scannedVideos })
                                else if (kw) onSelectSource?.({ type: 'keyword', value: kw, videos: scannedVideos })
                                else if (isVideoPage) onSelectSource?.({ type: 'video', value: url, videos: scannedVideos.length > 0 ? scannedVideos : [{ id: url.match(/\/video\/(\d+)/)?.[1] || '', url, description: '', thumbnail: '', stats: { views: 0, likes: 0, comments: 0 }, selected: true }] })
                                else alert('Please navigate to a Channel, Search Page, or Video')
                            }}
                        >
                            <span style={{ marginRight: '5px' }}>✅</span>
                            Use This Source
                        </button>
                    )}

                    {/* Standard Actions (ALWAYS Visible) */}

                    {/* VIDEO DETAIL: Add This Video */}
                    {isVideoPage && (
                        <button className="btn btn-primary" onClick={handleAddThisVideo}>
                            ✚ Add This Video
                        </button>
                    )}

                    {/* PROFILE: Scan, Scan All, Follow Channel */}
                    {isProfile && !isVideoPage && (
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

                    {/* SEARCH: Scan, Follow Keyword */}
                    {isSearch && (
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
                    onToggleSelect={toggleVideoSelect}
                    onAddSelected={handleAddSelected}
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
