import React, { useState, useEffect, useRef } from 'react'
import DatePicker from 'react-datepicker'
import "react-datepicker/dist/react-datepicker.css"
import { VideoCard } from './VideoCard'

interface SchedulePreviewProps {
    sources: any[]
    savedVideos: any[]
    schedule: {
        interval: number // minutes
        runAt?: string // ISO string or relevant start time
        days: string[]
    }
    initialItems?: any[] // Added prop
    onScheduleChange?: (items: TimelineItem[]) => void
    onStartTimeChange?: (date: Date) => void
    onIntervalChange?: (interval: number) => void
}

export interface TimelineItem {
    id: string
    time: Date
    type: 'post' | 'scan'
    label: string
    detail: string
    icon: string
    video?: any
    sourceId?: string
    isFixed?: boolean
}

export const SchedulePreview: React.FC<SchedulePreviewProps> = ({ sources, savedVideos, schedule, initialItems, onScheduleChange, onStartTimeChange, onIntervalChange }) => {
    // Local state for the plan
    const [items, setItems] = useState<TimelineItem[]>([])
    const [startTime, setStartTime] = useState<Date>(new Date())
    const [interval, setInterval] = useState<number>(schedule.interval || 15)

    // UI State for description toggles
    const [expandedItems, setExpandedItems] = useState<Record<string, boolean>>({})

    // For Drag & Drop
    const [draggedItemIndex, setDraggedItemIndex] = useState<number | null>(null)

    // Initialize logic
    useEffect(() => {
        // Determine initial start time
        let start = new Date()
        if (schedule.runAt) {
            const parsed = new Date(schedule.runAt)
            if (!isNaN(parsed.getTime())) {
                start = parsed
                // If past, maybe jump to tomorrow? strict adherence to user input is better
                if (start < new Date()) {
                    // Optional: auto-correct to now? Or leave as is?
                    // Let's default to now if raw input is past, or just respect it
                    if (parsed.getTime() < Date.now() - 3600000) { // older than 1 hour
                        start = new Date()
                    }
                }
            }
        }
        // If start time is not set in prop, default to now + 5 mins
        if (!schedule.runAt) {
            start = new Date(Date.now() + 5 * 60000)
        }

        setStartTime(start)
        setInterval(schedule.interval || 15)

        // 1. PREFER EXISTING ITEMS (Persist State)
        if (initialItems && initialItems.length > 0) {
            // Restore dates from strings if necessary
            const restored = initialItems.map(i => ({
                ...i,
                time: new Date(i.time)
            }))

            // Fix: If schedule.runAt is explicitly provided, we should align the start time 
            // even if we have initial items, especially if the user just changed it in the wizard.
            // Check if the restored first item matches the requested start time (roughly)
            // If completely different, we assume a "Force Update" from the wizard.
            const firstItemTime = restored[0]?.time?.getTime()
            const requestedTime = start.getTime()

            // If difference > 1 minute, assume user changed start time in Wizard
            if (firstItemTime && Math.abs(firstItemTime - requestedTime) > 60000) {
                // Unfix first item to allow it to move
                if (restored[0]) (restored[0] as any).isFixed = false
                setItems(restored) // Set state first
                recalculateTimes(restored, start, schedule.interval || 15)
            } else {
                setItems(restored)
            }
            return
        }

        // 2. Build initial items list (order: Videos -> Scans)
        // ... (rest is same)

        // Note: The logic in triggerCampaign is "Singles First". We replicate that here.
        const newItems: TimelineItem[] = []

        // Helper to format large numbers
        const formatCount = (n: number | string | undefined): string => {
            const num = typeof n === 'string' ? parseInt(n) : (n || 0)
            if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M'
            if (num >= 1000) return (num / 1000).toFixed(1) + 'K'
            return String(num)
        }

        // 1. Single Videos
        savedVideos.forEach((video, i) => {
            const stats = video.stats || {}
            newItems.push({
                id: `post-${video.id}`,
                time: new Date(), // placeholder, calculated below
                type: 'post',
                label: `Post Video`,
                detail: `👁️ ${formatCount(stats.views)} • ❤️ ${formatCount(stats.likes)}`,
                icon: '🎬',
                video: video
            })
        })

        // 2. Scans (Placeholder for visual preview)
        // We show one scan item per source to indicate when scanning starts
        sources.forEach((source, i) => {
            newItems.push({
                id: `scan-${source.name}-${i}`,
                time: new Date(),
                type: 'scan',
                label: `Scan Source`,
                detail: `${source.type === 'channel' ? '@' : ''}${source.name}`,
                icon: source.type === 'channel' ? '📺' : '🔍',
                sourceId: source.name
            })
        })

        recalculateTimes(newItems, start, schedule.interval || 15)

        // DEBUG: Check descriptions in preview
        console.log(`[DEBUG_DESC] SchedulePreview: Initialized with ${savedVideos.length} videos.`,
            savedVideos.map(v => ({ id: v.id, desc: v.description?.substring(0, 20) + '...' }))
        );
    }, [savedVideos, sources, schedule.runAt, schedule.interval]) // Re-init if external props change substantially

    // Recalculate times based on order + start + interval + jitter + daily constraints
    const recalculateTimes = (currentItems: TimelineItem[], start: Date, step: number) => {
        let cursorTime = new Date(start)

        // Helper to parsing HH:mm
        const getMinutes = (timeStr: string) => {
            const [h, m] = timeStr.split(':').map(Number)
            return (h || 0) * 60 + (m || 0)
        }
        const dailyStart = (schedule as any).startTime ? getMinutes((schedule as any).startTime) : 9 * 60
        const dailyEnd = (schedule as any).endTime ? getMinutes((schedule as any).endTime) : 21 * 60

        // Helper to ensure valid time
        const ensureValidTime = (date: Date): Date => {
            let d = new Date(date)
            let currentMins = d.getHours() * 60 + d.getMinutes()
            if (currentMins < dailyStart) {
                d.setHours(Math.floor(dailyStart / 60), dailyStart % 60, 0, 0)
            }
            else if (currentMins >= dailyEnd) {
                d.setDate(d.getDate() + 1)
                d.setHours(Math.floor(dailyStart / 60), dailyStart % 60, 0, 0)
            }
            return d
        }

        const updated = currentItems.map((item, index) => {
            // 1. Determine base "Natural" time for this slot (where it SHOULD be)
            // This is the anchor for the schedule flow.
            const naturalTime = ensureValidTime(new Date(cursorTime))

            let itemTime: Date

            if (item.isFixed && item.time) {
                // Respect Manual Override for the ITEM itself
                itemTime = new Date(item.time)
            } else {
                // Otherwise use the natural flow
                itemTime = new Date(naturalTime)
            }

            // 2. Advance Cursor for NEXT item based on NATURAL time
            // This ensures that moving Item A doesn't ripple and shift Item B, C, D...
            let duration = step * 60000
            const hasJitter = (schedule as any).jitter
            if (hasJitter) {
                const variation = (Math.random() * 0.4) - 0.2 // +/- 20%
                duration = duration * (1 + variation)
            }

            // The cursor advances from the NATURAL time of this slot, 
            // completely ignoring any manual override on this specific item.
            cursorTime = new Date(naturalTime.getTime() + duration)

            return { ...item, time: itemTime }
        })

        // Final Step: Sort by time to ensure visual timeline consistency
        updated.sort((a, b) => a.time.getTime() - b.time.getTime())

        setItems(updated)
        // Notify parent 
        onScheduleChange?.(updated)
    }

    // Handlers
    const handleStartTimeChange = (date: Date | null) => {
        if (date && !isNaN(date.getTime())) {
            setStartTime(date)
            onStartTimeChange?.(date)

            // Fix: Unfix first item so it accepts the new global start time
            // Otherwise, if it was manually edited, it would stick to the old time/date.
            const newItems = [...items]
            if (newItems.length > 0) {
                (newItems[0] as any).isFixed = false
            }

            recalculateTimes(newItems, date, interval)
        }
    }

    const handleIntervalChange = (valInput: string | number) => {
        if (valInput === '') {
            // @ts-ignore
            setInterval('')
            return
        }
        const val = Number(valInput)
        const newInterval = Math.max(1, val)
        setInterval(newInterval)
        recalculateTimes(items, startTime, newInterval)
        onIntervalChange?.(newInterval)
    }

    // Drag & Drop
    const onDragStart = (e: React.DragEvent, index: number) => {
        setDraggedItemIndex(index)
        e.dataTransfer.effectAllowed = "move"
        // Transparent drag image or default? Default is fine.
    }

    const onDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault()
        if (draggedItemIndex === null || draggedItemIndex === index) return

        // Reorder immediately for visual feedback
        const newItems = [...items]
        const draggedItem = newItems[draggedItemIndex]
        newItems.splice(draggedItemIndex, 1)
        newItems.splice(index, 0, draggedItem)

        setItems(newItems)
        setDraggedItemIndex(index)
    }

    const onDragEnd = () => {
        setDraggedItemIndex(null)
        // Recalculate times to enforce the sequence
        recalculateTimes(items, startTime, interval)
    }

    // Manual Time Edit (Advanced: shift just this one or re-calc?)
    // User asked "tùy ý". Let's allow explicit set, but note that subsequent reorders might overwrite it if we enforce interval.
    // Compromise: Changing specific time shifts ONLY that item visually, but effectively we might just update start time if it's the first one.
    // Actually, simpler logic: manual edit updates that item. If we re-sort, it might snap back.
    // Let's stick to "Sequence Driven" for reliability. Manual edit of #1 shifts #1, and #2 shifts to #1 + interval?
    // Let's implement: Shift Start Time if #1 is changed.
    // Manual Time Edit
    const handleManualTimeChange = (index: number, date: Date | null) => {
        if (!date || isNaN(date.getTime())) return

        // Update items list
        const newItems = [...items]
        newItems[index] = {
            ...newItems[index],
            time: date,
            isFixed: true // Mark as manually fixed
        }

        // If index 0, we also update the global Start Time state for consistency
        // Note: With sorting, index 0 might change, so this triggers a sort which might move this item.
        if (index === 0) {
            setStartTime(date)
        }

        // Trigger recalculation with the fixed item
        recalculateTimes(newItems, startTime, interval)
    }

    // Toggle description
    const toggleExpand = (id: string) => {
        setExpandedItems(prev => ({ ...prev, [id]: !prev[id] }))
    }

    // Group items by Date label
    const groupedItems: { label: string; items: { data: TimelineItem; index: number }[] }[] = []
    let lastDateLabel = ''
    items.forEach((item, index) => {
        const today = new Date().toDateString()
        const tomorrow = new Date(Date.now() + 86400000).toDateString()
        const itemDate = item.time.toDateString()

        let label = item.time.toLocaleDateString()
        if (itemDate === today) label = 'Today'
        else if (itemDate === tomorrow) label = 'Tomorrow'

        if (label !== lastDateLabel) {
            groupedItems.push({ label, items: [] })
            lastDateLabel = label
        }
        groupedItems[groupedItems.length - 1].items.push({ data: item, index })
    })

    // Format local date for input
    const toLocalISO = (d: Date) => {
        if (!d || isNaN(d.getTime())) return ''
        const pad = (n: number) => n < 10 ? '0' + n : n
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    return (
        <div className="wizard-step">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: '20px', background: 'var(--bg-secondary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-primary)' }}>
                <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Campaign Start Time</label>
                    <DatePicker
                        selected={startTime}
                        onChange={handleStartTimeChange}
                        showTimeSelect timeIntervals={15}
                        dateFormat="yyyy-MM-dd HH:mm" timeFormat="HH:mm"
                        minDate={new Date()}
                        className="form-control"
                        wrapperClassName="datepicker-wrapper"
                    />
                </div>
                <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Gap between actions</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                            type="number"
                            min="1"
                            value={interval}
                            onChange={(e) => handleIntervalChange(e.target.value)}
                            className="form-control"
                            style={{ width: '80px', padding: '6px' }}
                        />
                        <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>minutes</span>
                    </div>
                </div>
            </div>

            <div className="timeline-container" style={{ padding: '0 10px', maxHeight: '500px', overflowY: 'auto' }}>
                {groupedItems.map((group, gIdx) => (
                    <div key={gIdx} style={{ marginBottom: '25px' }}>
                        <div style={{
                            fontSize: '13px', fontWeight: 600, color: 'var(--accent-primary)',
                            marginBottom: '12px', position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-primary)',
                            padding: '8px 0', textTransform: 'uppercase', letterSpacing: '0.5px'
                        }}>
                            {group.label}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {group.items.map(({ data: item, index }) => (
                                <div
                                    key={item.id}
                                    draggable
                                    onDragStart={(e) => onDragStart(e, index)}
                                    onDragOver={(e) => onDragOver(e, index)}
                                    onDragEnd={onDragEnd}
                                    style={{
                                        display: 'flex', gap: '16px', alignItems: 'flex-start',
                                        background: draggedItemIndex === index ? 'rgba(59, 130, 246, 0.1)' : 'var(--bg-card)',
                                        border: draggedItemIndex === index ? '1px dashed var(--accent-primary)' : '1px solid var(--border-primary)',
                                        padding: '12px', borderRadius: '8px', cursor: 'grab',
                                        transition: 'transform 0.2s, box-shadow 0.2s',
                                        opacity: draggedItemIndex === index ? 0.6 : 1
                                    }}
                                >
                                    {/* Drag Handle & Time */}
                                    <div style={{ minWidth: '140px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', paddingTop: '4px' }}>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '20px', lineHeight: '10px' }}>⋮⋮</div>
                                        <DatePicker
                                            selected={item.time}
                                            onChange={(date: Date | null) => handleManualTimeChange(index, date)}
                                            showTimeSelect timeIntervals={15}
                                            dateFormat="MM/dd HH:mm" timeFormat="HH:mm"
                                            className="form-control"
                                            // @ts-ignore
                                            onKeyDown={(e) => e.stopPropagation()} // Allow typing without triggering drag
                                            onClickOutside={(e) => { }}
                                            popperPlacement="right"
                                            customInput={
                                                <input style={{
                                                    background: 'var(--bg-input)', border: '1px solid var(--border-primary)',
                                                    color: 'var(--text-primary)', borderRadius: '4px', padding: '4px 8px',
                                                    fontSize: '12px', width: '120px', textAlign: 'center', cursor: 'pointer'
                                                }} />
                                            }
                                        />
                                        {item.isFixed && <span style={{ fontSize: '10px', color: 'var(--accent-primary)' }}>Fixed</span>}
                                    </div>

                                    {/* Content */}
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                            <span style={{ fontSize: '16px' }}>{item.icon}</span>
                                            <span style={{ fontWeight: 600, fontSize: '14px' }}>{item.label}</span>
                                            <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                                                Seq #{index + 1}
                                            </span>
                                        </div>

                                        {/* Video Info Display (Unified Style) */}
                                        {item.video && (
                                            <div style={{
                                                marginTop: '4px',
                                                display: 'flex',
                                                gap: '12px',
                                                background: 'var(--bg-secondary)',
                                                border: '1px solid var(--border-primary)',
                                                borderRadius: '6px',
                                                padding: '8px'
                                            }}>
                                                {/* Mini Thumbnail with Stats Overlay */}
                                                <div style={{ position: 'relative', width: '60px', height: '80px', flexShrink: 0, borderRadius: '4px', overflow: 'hidden' }}>
                                                    {item.video.thumbnail ? (
                                                        <img src={item.video.thumbnail} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                                                    ) : (
                                                        <div style={{ width: '100%', height: '100%', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>🎬</div>
                                                    )}
                                                    {/* Stats Overlay */}
                                                    <div style={{
                                                        position: 'absolute', bottom: 0, left: 0, width: '100%',
                                                        background: 'linear-gradient(to top, rgba(0,0,0,0.9), transparent)',
                                                        padding: '4px 2px', display: 'flex', justifyContent: 'center', gap: '4px'
                                                    }}>
                                                        <span style={{ fontSize: '9px', color: '#fff' }}>👁️ {item.video.stats?.views ? (typeof item.video.stats.views === 'number' ? (item.video.stats.views > 1000 ? (item.video.stats.views / 1000).toFixed(1) + 'K' : item.video.stats.views) : item.video.stats.views) : '0'}</span>
                                                    </div>
                                                </div>

                                                {/* Right: Description & Details */}
                                                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                    {/* Description */}
                                                    {(item.video.description || item.detail) && (
                                                        <div style={{ fontSize: '12px', color: 'var(--text-primary)', lineHeight: '1.3' }}>
                                                            {expandedItems[item.id] ? (
                                                                <span>{item.video.description || item.detail}</span>
                                                            ) : (
                                                                <span>{(item.video.description || item.detail).substring(0, 80)}{(item.video.description || item.detail).length > 80 ? '...' : ''}</span>
                                                            )}
                                                            {(item.video.description || item.detail).length > 80 && (
                                                                <span
                                                                    onClick={(e) => { e.stopPropagation(); toggleExpand(item.id) }}
                                                                    style={{ color: 'var(--accent-primary)', cursor: 'pointer', marginLeft: '6px', fontSize: '11px' }}
                                                                >
                                                                    {expandedItems[item.id] ? '(less)' : '(more)'}
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}

                                                    {/* Stats 2 (Likes) & URL */}
                                                    <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '11px', color: 'var(--text-muted)' }}>
                                                        <span style={{ color: '#ff2c55', display: 'flex', alignItems: 'center', gap: '3px' }}>
                                                            ❤️ {item.video.stats?.likes ? (typeof item.video.stats.likes === 'number' ? (item.video.stats.likes > 1000 ? (item.video.stats.likes / 1000).toFixed(1) + 'K' : item.video.stats.likes) : item.video.stats.likes) : '0'}
                                                        </span>
                                                        <div style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                            {item.video.url}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {!item.video && (
                                            <div style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>
                                                {item.detail}
                                            </div>
                                        )}
                                    </div>

                                </div>
                            ))}
                        </div>
                    </div>
                ))
                }
            </div >
        </div >
    )
}
