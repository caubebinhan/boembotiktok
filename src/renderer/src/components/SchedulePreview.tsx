import React, { useState, useEffect, useRef } from 'react'
import { VideoCard } from './VideoCard'

interface SchedulePreviewProps {
    sources: any[]
    savedVideos: any[]
    schedule: {
        interval: number // minutes
        runAt?: string // ISO string or relevant start time
        days: string[]
    }
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
}

export const SchedulePreview: React.FC<SchedulePreviewProps> = ({ sources, savedVideos, schedule, onScheduleChange, onStartTimeChange, onIntervalChange }) => {
    // Local state for the plan
    const [items, setItems] = useState<TimelineItem[]>([])
    const [startTime, setStartTime] = useState<Date>(new Date())
    const [interval, setInterval] = useState<number>(schedule.interval || 15)

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

        // Build initial items list (order: Videos -> Scans)
        // Note: The logic in triggerCampaign is "Singles First". We replicate that here.
        const initialItems: TimelineItem[] = []

        // 1. Single Videos
        savedVideos.forEach((video, i) => {
            initialItems.push({
                id: `post-${video.id}`,
                time: new Date(), // placeholder, calculated below
                type: 'post',
                label: `Post Video`,
                detail: video.description || 'Targeted Video',
                icon: '🎬',
                video: video
            })
        })

        // 2. Scans (Placeholder for visual preview)
        // We show one scan item per source to indicate when scanning starts
        sources.forEach((source, i) => {
            initialItems.push({
                id: `scan-${source.name}-${i}`,
                time: new Date(),
                type: 'scan',
                label: `Scan Source`,
                detail: `${source.type === 'channel' ? '@' : ''}${source.name}`,
                icon: source.type === 'channel' ? '📺' : '🔍',
                sourceId: source.name
            })
        })

        recalculateTimes(initialItems, start, schedule.interval || 15)
    }, [savedVideos, sources, schedule.runAt, schedule.interval]) // Re-init if external props change substantially

    // Recalculate times based on order + start + interval + jitter + daily constraints
    const recalculateTimes = (currentItems: TimelineItem[], start: Date, step: number) => {
        let currentTime = new Date(start)
        const updated = currentItems.map((item, index) => {
            // If jitter is enabled in schedule prop
            const hasJitter = (schedule as any).jitter
            let offset = 0
            if (hasJitter && index > 0) { // Keep first item fixed, jitter subsequent intervals
                // Max jitter = 50% of interval
                // Random between -50% and +50%? Or 0 to 50%?
                // User said: "5 mins... possible 4 or 7". 
                // 4 (-1), 7 (+2). This implies variance around the "expected" time?
                // OR variance in the INTERVAL itself.
                // Let's vary the interval added.
                // Variation = (Math.random() - 0.5) * step * 60000. (Range -0.5 to 0.5 * interval)
                // But user example 7 mins is +40%. 4 mins is -20%.
                // Let's use simple randomization: interval * (0.5 + Math.random()) -> 0.5x to 1.5x interval.
                // This gives 2.5m to 7.5m for 5m interval.
                // 4 is inside. 7 is inside.
                // This satisfies "max 50% of spanning unit" if interpreted as deviation from center?
                // Let's use `step + (Math.random() - 0.5) * step` -> 0.5 to 1.5.
            }

            // Correction: recalculateTimes loops items.
            // We should maintain `currentTime` state, not calculate from index.
            // Because jitter makes it non-linear.

            // Logic:
            // 1. Check if currentTime is within Active Hours (start/end).
            //    If not, fast forward to next valid Start Time.
            // 2. Assign currentTime to item.
            // 3. Advance currentTime by Interval + Jitter.

            // Ensure currentTime respects Daily Start/End
            // Helper to parsing HH:mm
            const getMinutes = (timeStr: string) => {
                const [h, m] = timeStr.split(':').map(Number)
                return (h || 0) * 60 + (m || 0)
            }

            // Default active hours if not set (or user removed them?)
            // Schedule prop from CampaignWizard uses `startTime`/`endTime` strings (HH:mm).
            // But `SchedulePreviewProps.schedule` definition in snippet 1704 is:
            // interval, runAt, days.
            // It misses startTime/endTime!
            // I need to update interface too?
            // The `schedule` prop passed from CampaignWizard is `formData.schedule`.
            // `formData.schedule` HAS startTime/endTime.
            // So `(schedule as any).startTime` is accessible.
            const dailyStart = (schedule as any).startTime ? getMinutes((schedule as any).startTime) : 9 * 60
            const dailyEnd = (schedule as any).endTime ? getMinutes((schedule as any).endTime) : 21 * 60

            // Function to ensure time is valid
            const ensureValidTime = (date: Date): Date => {
                let d = new Date(date)
                let currentMins = d.getHours() * 60 + d.getMinutes()

                // If before dailyStart, move to dailyStart same day
                if (currentMins < dailyStart) {
                    d.setHours(Math.floor(dailyStart / 60), dailyStart % 60, 0, 0)
                }
                // If after dailyEnd, move to tomorrow dailyStart
                else if (currentMins >= dailyEnd) {
                    d.setDate(d.getDate() + 1)
                    d.setHours(Math.floor(dailyStart / 60), dailyStart % 60, 0, 0)
                    // Recurse to ensure tomorrow is a valid Day? (Active Days logic)
                    // For simplicity, assumed daily.
                }
                return d
            }

            currentTime = ensureValidTime(currentTime)
            const itemTime = new Date(currentTime)

            // Calculate next time
            let duration = step * 60000
            if (hasJitter) {
                // Random factor: 0.5 to 1.5
                const factor = 0.5 + Math.random()
                duration = duration * factor
            }
            currentTime = new Date(currentTime.getTime() + duration)

            return { ...item, time: itemTime }
        })
        setItems(updated)
        // Notify parent of the plan (simplified)
        onScheduleChange?.(updated)
    }

    // Handlers
    const handleStartTimeChange = (val: string) => {
        // val is datetime-local string: YYYY-MM-DDTHH:mm
        const newStart = new Date(val)
        if (!isNaN(newStart.getTime())) {
            setStartTime(newStart)
            recalculateTimes(items, newStart, interval)
        }
    }

    const handleIntervalChange = (val: number) => {
        const newInterval = Math.max(1, val)
        setInterval(newInterval)
        recalculateTimes(items, startTime, newInterval)
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
    const handleManualTimeChange = (index: number, timeStr: string) => {
        // timeStr is HH:mm. We assume same day.
        const [h, m] = timeStr.split(':').map(Number)
        const newItemTime = new Date(items[index].time)
        newItemTime.setHours(h, m)

        // If index is 0, we treat it as changing start time
        if (index === 0) {
            setStartTime(newItemTime)
            recalculateTimes(items, newItemTime, interval)
        } else {
            // For other items, we just update purely locally? Or do we shift the "Base" for subsequent?
            // Let's just update strictly.
            const newItems = [...items]
            newItems[index] = { ...newItems[index], time: newItemTime }
            setItems(newItems)
            onScheduleChange?.(newItems)
        }
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
        const pad = (n: number) => n < 10 ? '0' + n : n
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
    }

    return (
        <div className="wizard-step">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'end', marginBottom: '20px', background: 'var(--bg-secondary)', padding: '16px', borderRadius: '12px', border: '1px solid var(--border-primary)' }}>
                <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Campaign Start Time</label>
                    <input
                        type="datetime-local"
                        value={toLocalISO(startTime)}
                        onChange={(e) => handleStartTimeChange(e.target.value)}
                        className="form-control"
                        style={{ fontSize: '13px', padding: '6px 10px', width: '200px' }}
                    />
                </div>
                <div>
                    <label style={{ fontSize: '12px', color: 'var(--text-muted)', display: 'block', marginBottom: '4px' }}>Gap between actions</label>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input
                            type="number"
                            min="1"
                            value={interval}
                            onChange={(e) => handleIntervalChange(Number(e.target.value))}
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
                                    <div style={{ minWidth: '80px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', paddingTop: '4px' }}>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '20px', lineHeight: '10px' }}>⋮⋮</div>
                                        <input
                                            type="time"
                                            value={item.time.toTimeString().slice(0, 5)}
                                            onChange={(e) => handleManualTimeChange(index, e.target.value)}
                                            className="no-drag"
                                            style={{
                                                background: 'transparent', border: '1px solid var(--border-primary)',
                                                color: 'var(--text-primary)', borderRadius: '4px', padding: '2px 4px',
                                                fontSize: '12px', width: '60px', textAlign: 'center'
                                            }}
                                            onClick={(e) => e.stopPropagation()} // Prevent drag start on input
                                        />
                                    </div>

                                    {/* Content */}
                                    <div style={{ flex: 1 }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                            <span style={{ fontSize: '16px' }}>{item.icon}</span>
                                            <span style={{ fontWeight: 600, fontSize: '14px' }}>{item.label}</span>
                                            <span style={{ fontSize: '10px', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '4px' }}>
                                                Seq #{index + 1}
                                            </span>
                                        </div>

                                        <div style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.4' }}>
                                            {item.detail}
                                        </div>

                                        {/* Video Preview (Mini) */}
                                        {item.video && (
                                            <div style={{ marginTop: '8px', display: 'flex', gap: '10px', alignItems: 'center', background: 'rgba(0,0,0,0.2)', padding: '6px', borderRadius: '6px' }}>
                                                {item.video.thumbnail && (
                                                    <img src={item.video.thumbnail} style={{ width: '40px', height: '40px', objectFit: 'cover', borderRadius: '4px' }} />
                                                )}
                                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '300px' }}>
                                                    {item.video.url}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    )
}
