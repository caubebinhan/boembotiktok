import React, { useState, useEffect, useCallback } from 'react'
import { CampaignHeader } from '../components/campaign/CampaignHeader'
import { CampaignStats } from '../components/campaign/CampaignStats'
import { VideoTimeline } from '../components/campaign/VideoTimeline'
import { AccountPanel } from '../components/campaign/AccountPanel'
import { LogViewer } from '../components/campaign/LogViewer'
import { determineVideoStatus } from '../utils/campaignStateManager'

interface Props {
    id: number
}

export const CampaignDetailsWindow: React.FC<Props> = ({ id }) => {
    const [campaign, setCampaign] = useState<any>(null)
    const [jobs, setJobs] = useState<any[]>([])
    const [accounts, setAccounts] = useState<any[]>([])
    const [activeTab, setActiveTab] = useState<'timeline' | 'accounts' | 'logs'>('timeline')

    const [stats, setStats] = useState({ queued: 0, preparing: 0, uploading: 0, published: 0, failed: 0, skipped: 0 })

    // Data Loading
    const loadCampaign = useCallback(async () => {
        try {
            // @ts-ignore
            const data = await window.api.invoke('get-campaigns')
            const c = data.find((c: any) => c.id === Number(id))
            setCampaign(c)

            // Load accounts used in this campaign (mocking for now, or fetching all)
            // @ts-ignore
            const allAccounts = await window.api.invoke('publish-account:list')
            if (c && c.config_json) {
                const conf = JSON.parse(c.config_json)
                if (conf.targetAccounts && conf.targetAccounts.length > 0) {
                    setAccounts(allAccounts.filter((a: any) => conf.targetAccounts.includes(a.username)))
                } else {
                    setAccounts(allAccounts)
                }
            } else {
                setAccounts(allAccounts)
            }
        } catch (err) { console.error(err) }
    }, [id])

    const loadData = useCallback(async () => {
        try {
            // @ts-ignore
            const [campaignJobs, campaignStats] = await Promise.all([
                // @ts-ignore
                window.api.invoke('get-campaign-jobs', Number(id)),
                // @ts-ignore
                window.api.invoke('get-campaign-stats', Number(id))
            ])
            setJobs(campaignJobs || [])
            if (campaignStats) setStats(campaignStats)
        } catch (e) { console.error(e) }
    }, [id])

    useEffect(() => {
        loadCampaign()
        loadData()
        const interval = setInterval(loadData, 2000)
        return () => clearInterval(interval)
    }, [id, loadCampaign, loadData])

    // Actions
    const handleRunNow = async () => {
        try {
            // @ts-ignore
            await window.api.invoke('trigger-campaign', id)
            loadData()
        } catch (e) { console.error(e) }
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
                // alert(`Status Check: ${status}`) // Optional feedback
                loadData()
            } catch (e: any) { console.error(e); alert('Failed to refresh status: ' + e.message) }
        }
    }

    if (!campaign) return <div className="spinner" />

    // Derived Data
    const config = JSON.parse(campaign.config_json || '{}')
    const videos = config.videos || []

    return (
        <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            <CampaignHeader campaign={campaign} onRunNow={handleRunNow} onRefresh={loadData} />

            <div style={{ flex: 1, overflowY: 'auto', paddingTop: '24px' }}>
                <CampaignStats stats={stats} />

                {/* TABS CONTENT */}
                {activeTab === 'timeline' && (
                    <VideoTimeline videos={videos} jobs={jobs} onAction={handleAction} />
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
                    {[{ id: 'timeline', label: 'Overview' }, { id: 'accounts', label: 'Accounts' }, { id: 'logs', label: 'Logs' }].map(tab => (
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
        </div>
    )
}
