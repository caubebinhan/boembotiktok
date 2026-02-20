import React, { useState, useEffect, useCallback } from 'react'
import { CampaignHeader } from '../components/campaign/CampaignHeader'
import { CampaignStats } from '../components/campaign/CampaignStats'
import { VideoTimeline } from '../components/campaign/VideoTimeline'
import { RescheduleModal } from '../components/RescheduleModal'
import { AccountPanel } from '../components/campaign/AccountPanel'
import { LogViewer } from '../components/campaign/LogViewer'
import { determineVideoStatus } from '../utils/campaignStateManager'
import { EditCaptionModal } from '../components/EditCaptionModal'

interface Props {
    id: number
}

export const CampaignDetailsWindow: React.FC<Props> = ({ id }) => {
    const [campaign, setCampaign] = useState<any>(null)
    const [jobs, setJobs] = useState<any[]>([])
    const [accounts, setAccounts] = useState<any[]>([])
    const [activeTab, setActiveTab] = useState<'timeline' | 'published' | 'accounts' | 'logs'>('timeline')

    const [stats, setStats] = useState({ scanned: 0, queued: 0, preparing: 0, uploading: 0, published: 0, failed: 0, skipped: 0 })
    const [isProcessing, setIsProcessing] = useState(false)
    const [nextScan, setNextScan] = useState<string | null>(null)

    // Edit Modal State
    const [editingJob, setEditingJob] = useState<any>(null)
    const [rescheduleTarget, setRescheduleTarget] = useState<{ campaign: any, missedJobs: any[] } | null>(null)

    const loadData = useCallback(async () => {
        try {
            // @ts-ignore
            const c: any = await window.api.invoke('get-campaign-details', id)
            if (c) {
                setCampaign(c)
                // @ts-ignore
                const j: any[] = await window.api.invoke('get-campaign-jobs', id)
                const jobList = j || []
                setJobs(jobList)

                // Calculate stats based on grouped jobs to avoid double counting
                const newStats = { scanned: 0, queued: 0, preparing: 0, uploading: 0, published: 0, failed: 0, skipped: 0 }

                // Track unique videos
                const uniqueVideos = new Set<string>()
                if (c.config_json) {
                    try {
                        const config = JSON.parse(c.config_json)
                        config.videos?.forEach((v: any) => uniqueVideos.add(v.id || v.platform_id))
                    } catch { }
                }

                // Group jobs by video to determine final status per video
                const videoLatestJob = new Map<string, any>()

                jobList.forEach(job => {
                    if (job.type !== 'EXECUTE') return

                    try {
                        const data = JSON.parse(job.data_json || '{}')
                        const vid = data.platform_id || data.video_id || data.video?.id
                        if (!vid) return

                        // Keep only LATEST job (highest ID = most recent)
                        if (!videoLatestJob.has(vid) || job.id > videoLatestJob.get(vid).id) {
                            videoLatestJob.set(vid, job)
                        }
                    } catch { }
                })

                newStats.scanned = videoLatestJob.size

                videoLatestJob.forEach((job) => {
                    const status = job.status?.toLowerCase() || ''
                    if (status === 'queued' || status === 'scheduled' || status === 'pending') newStats.queued++
                    else if (status === 'downloading' || status === 'editing' || status === 'downloaded' || status === 'edited' || status === 'processing' || status === 'running' || status === 'preparing') newStats.preparing++
                    else if (status === 'publishing' || status === 'uploading') newStats.uploading++
                    else if (status === 'published' || status === 'uploaded' || status === 'completed' || status === 'success') newStats.published++
                    else if (status.includes('failed')) newStats.failed++
                    else if (status === 'skipped' || status === 'cancelled') newStats.skipped++
                })
                setStats(newStats)

                // Find next scan time
                const pendingScan = jobList.find(j => j.type === 'SCAN' && j.status === 'pending')
                setNextScan(pendingScan ? pendingScan.scheduled_for : null)

                // @ts-ignore
                const accs = await window.api.invoke('publish-account:list')
                setAccounts(accs || [])
            }
        } catch (e) { console.error(e) }
    }, [id])

    useEffect(() => {
        loadData()
        const interval = setInterval(loadData, 2000)

        // Listen for realtime updates
        // @ts-ignore
        const removeListener = window.api.on('campaigns-updated', loadData)

        return () => {
            clearInterval(interval)
            if (removeListener) removeListener()
        }
    }, [loadData])

    // Actions
    const handleRunNow = async () => {
        try {
            // Check for missed jobs first
            // @ts-ignore
            const missedJobs = await window.api.invoke('job:get-campaign-missed', id)

            if (missedJobs && missedJobs.length > 0) {
                setRescheduleTarget({ campaign, missedJobs })
                return
            }

            setIsProcessing(true)
            // @ts-ignore
            await window.api.invoke('trigger-campaign', id)
            // Brief delay to let the backend start create jobs
            await new Promise(resolve => setTimeout(resolve, 1000))
            await loadData()
        } catch (e) { console.error(e) } finally {
            setIsProcessing(false)
        }
    }

    const handlePause = async () => {
        try {
            // @ts-ignore
            await window.api.invoke('campaign:pause', id)
            await loadData()
        } catch (e) {
            console.error('Failed to pause campaign:', e)
        }
    }

    const handleAction = async (action: string, jobId: number) => {
        console.log(`Action ${action} on job ${jobId}`)
        if (action === 'retry') {
            try {
                // @ts-ignore
                await window.api.invoke('job:retry', jobId)
                loadData()
            } catch (e) { console.error(e) }
        }
        if (action === 'captcha') {
            try {
                // @ts-ignore
                await window.api.invoke('job:open-browser', jobId)
            } catch (e: any) { console.error(e); alert('Failed to open browser: ' + e.message) }
        }
        if (action === 'refresh') {
            try {
                // @ts-ignore
                const status = await window.api.invoke('job:check-status', jobId)
                loadData()
            } catch (e: any) { console.error(e); alert('Failed to refresh status: ' + e.message) }
        }
        if (action === 'edit-caption') {
            const job = jobs.find(j => j.id === jobId)
            if (job) {
                setEditingJob(job)
            }
        }
    }

    const handleSaveCaption = async (jobId: number, newCaption: string) => {
        try {
            // @ts-ignore
            await window.api.invoke('job:update-data', jobId, { caption: newCaption, description: newCaption })
            setEditingJob(null)
            loadData()
        } catch (e: any) {
            console.error(e)
            alert('Failed to save caption: ' + e.message)
        }
    }

    if (!campaign) return <div className="spinner" />

    // Derived Data
    const config = JSON.parse(campaign.config_json || '{}')
    const videos = config.videos || []

    // Filter for Published Tab
    const publishedVideos = videos.filter((v: any) => {
        // Check if this video has a successful publish job or is marked as published
        // We can check the `jobs` list or just rely on video status if synced?
        // VideoTimeline.tsx uses job state.
        // Let's filter by checking if ANY publish job for this video is completed?
        // Or simpler: filter videos where `status` is 'published'
        return v.status === 'published'
    })

    // Check if any SCAN jobs are running (pending or processing)
    const isScanRunning = jobs.some(j => j.type === 'SCAN' && ['pending', 'processing', 'running'].includes(j.status?.toLowerCase()))

    // Check if there are scan jobs that are queued but not running yet
    const hasPendingScan = jobs.some(j => j.type === 'SCAN' && ['queued', 'scheduled'].includes(j.status?.toLowerCase()))

    // Check ACTUAL job states, not stats
    const hasActiveJobs = jobs.some(j =>
        j.type === 'EXECUTE' &&
        ['queued', 'scheduled', 'downloading', 'editing', 'publishing', 'downloaded', 'edited'].includes(j.status?.toLowerCase())
    )

    const hasScanningJobs = jobs.some(j =>
        j.type === 'SCAN' &&
        ['queued', 'scheduled', 'running', 'pending', 'processing'].includes(j.status?.toLowerCase())
    )

    const isRunning = isProcessing || hasActiveJobs || hasScanningJobs

    const isWaitingForScan = hasPendingScan && !isRunning && !isScanRunning && campaign.status === 'active'

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            <CampaignHeader
                campaign={campaign}
                onRunNow={handleRunNow}
                onPause={handlePause}
                onRefresh={loadData}
                isRunning={isRunning}
                isScanning={isScanRunning}
                isWaitingForScan={isWaitingForScan}
                nextScan={nextScan}
            />

            <div style={{ flex: 1, overflowY: 'auto', paddingTop: '24px' }}>
                <CampaignStats stats={stats} />

                {/* TABS CONTENT */}
                {activeTab === 'timeline' && (
                    <VideoTimeline videos={videos} jobs={jobs} onAction={handleAction} campaign={campaign} />
                )}
                {activeTab === 'published' && (
                    <div style={{ padding: '0 32px' }}>
                        <div style={{ fontSize: '12px', fontWeight: 700, color: '#4ade80', marginBottom: '24px', letterSpacing: '0.5px' }}>
                            ✅ PUBLISHED VIDEOS ({publishedVideos.length})
                        </div>
                        <VideoTimeline videos={publishedVideos} jobs={jobs} onAction={handleAction} />
                    </div>
                )}
                {activeTab === 'accounts' && (
                    <AccountPanel accounts={accounts} jobs={jobs} />
                )}
                {activeTab === 'logs' && (
                    <LogViewer jobs={jobs} />
                )}
            </div>

            {/* Bottom Tab Bar */}
            <div style={{
                borderTop: '1px solid var(--border-primary)',
                background: 'var(--bg-secondary)',
                padding: '0 32px'
            }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    {[
                        { id: 'timeline', label: 'Overview' },
                        { id: 'published', label: 'Published' },
                        { id: 'accounts', label: 'Accounts' },
                        { id: 'logs', label: 'Logs' }
                    ].map(tab => (
                        <button
                            key={tab.id}
                            data-testid={`tab-${tab.id}`}
                            onClick={() => setActiveTab(tab.id as any)}
                            style={{
                                padding: '16px 20px',
                                background: 'transparent',
                                borderBottom: activeTab === tab.id ? '2px solid var(--accent-primary)' : '2px solid transparent',
                                color: activeTab === tab.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                                fontWeight: 600,
                                fontSize: '13px',
                                cursor: 'pointer'
                            }}>
                            {tab.label}
                        </button>
                    ))}
                </div>
            </div>

            {rescheduleTarget && (
                <RescheduleModal
                    missedJobs={rescheduleTarget.missedJobs}
                    onResume={async (items) => {
                        // @ts-ignore
                        await window.api.invoke('job:resume-recovery', items)
                        setRescheduleTarget(null)
                        loadData()
                    }}
                    onDiscard={async () => {
                        // @ts-ignore
                        await window.api.invoke('job:discard-recovery', rescheduleTarget.missedJobs.map(j => j.id))
                        setRescheduleTarget(null)
                        loadData()
                    }}
                />
            )}

            {editingJob && (
                <EditCaptionModal
                    jobId={editingJob.id}
                    initialCaption={JSON.parse(editingJob.data_json || '{}').caption || ''}
                    onSave={handleSaveCaption}
                    onClose={() => setEditingJob(null)}
                />
            )}
        </div>
    )
}
