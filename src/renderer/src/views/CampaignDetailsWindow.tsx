import React, { useState, useEffect, useCallback } from 'react'
import { CampaignHeader } from '../components/campaign/CampaignHeader'
import { CampaignStats } from '../components/campaign/CampaignStats'
import { VideoTimeline } from '../components/campaign/VideoTimeline'
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

    const [stats, setStats] = useState({ queued: 0, preparing: 0, uploading: 0, published: 0, failed: 0, skipped: 0 })
    const [isProcessing, setIsProcessing] = useState(false)

    // Edit Modal State
    const [editingJob, setEditingJob] = useState<any>(null)

    const loadData = useCallback(async () => {
        try {
            // @ts-ignore
            const c: any = await window.api.invoke('get-campaign-details', id)
            if (c) {
                setCampaign(c)
                // @ts-ignore
                const j: any[] = await window.api.invoke('get-campaign-jobs', id)
                setJobs(j || [])

                // Calculate stats
                const newStats = { queued: 0, preparing: 0, uploading: 0, published: 0, failed: 0, skipped: 0 }
                j?.forEach(job => {
                    const status = job.status?.toLowerCase() || ''
                    if (status === 'pending') newStats.queued++
                    if (status === 'processing' || status === 'running' || status === 'preparing') newStats.preparing++
                    if (status === 'uploading') newStats.uploading++
                    if (status === 'completed' || status === 'success') newStats.published++
                    if (status.includes('failed')) newStats.failed++
                    if (status === 'skipped') newStats.skipped++
                })
                setStats(newStats)

                // @ts-ignore
                const accs = await window.api.invoke('publish-account:list')
                setAccounts(accs || [])
            }
        } catch (e) { console.error(e) }
    }, [id])

    useEffect(() => {
        loadData()
        const interval = setInterval(loadData, 5000)
        return () => clearInterval(interval)
    }, [loadData])

    // Actions
    const handleRunNow = async () => {
        try {
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

    const isRunning = isProcessing || stats.queued > 0 || stats.preparing > 0 || stats.uploading > 0

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            <CampaignHeader campaign={campaign} onRunNow={handleRunNow} onRefresh={loadData} isRunning={isRunning} />

            <div style={{ flex: 1, overflowY: 'auto', paddingTop: '24px' }}>
                <CampaignStats stats={stats} />

                {/* TABS CONTENT */}
                {activeTab === 'timeline' && (
                    <VideoTimeline videos={videos} jobs={jobs} onAction={handleAction} />
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
