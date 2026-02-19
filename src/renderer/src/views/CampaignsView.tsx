import React, { useState, useEffect } from 'react'
import { CampaignList } from '../components/CampaignList'
import { TodaySchedule } from '../components/TodaySchedule'
import { RescheduleModal } from '../components/RescheduleModal'
import { useAppDispatch, useAppSelector } from '../store/hooks'
import {
    fetchCampaigns,
    triggerCampaign,
    pauseCampaign,
    deleteCampaign,
    toggleCampaignStatus,
    selectCampaigns,
    selectProcessingIds,
    addProcessingId,
    removeProcessingId
} from '../store/campaignSlice'

export const CampaignsView: React.FC = () => {
    const dispatch = useAppDispatch()
    const campaigns = useAppSelector(selectCampaigns)
    const processingIds = useAppSelector(selectProcessingIds)
    const [activeTab, setActiveTab] = useState<'all' | 'today'>('all')
    const [rescheduleTarget, setRescheduleTarget] = useState<{ campaign: any, missedJobs: any[] } | null>(null)

    useEffect(() => {
        dispatch(fetchCampaigns())

        // Listen for updates from other windows
        // @ts-ignore
        const removeListener = window.api.on('campaigns-updated', () => {
            dispatch(fetchCampaigns())
        })
        return () => {
            if (removeListener) removeListener()
        }
    }, [dispatch])

    const handleCreateCampaign = React.useCallback(async (_data: any, _runNow: boolean) => {
        // No-op: wizard runs in its own window and sends IPC to create campaign
    }, [])


    const handleToggleStatus = React.useCallback(async (id: number, currentStatus: string) => {
        dispatch(toggleCampaignStatus({ id, currentStatus }))
    }, [dispatch])

    const handlePause = React.useCallback(async (id: number) => {
        dispatch(pauseCampaign(id))
    }, [dispatch])

    const handleOpenScanner = React.useCallback(async () => {
        try {
            // @ts-ignore
            await window.api.invoke('open-scanner-window')
        } catch (err) {
            console.error('Failed to open scanner:', err)
        }
    }, [])

    const handleSelectCampaign = React.useCallback(async (campaign: any) => {
        if (campaign.status === 'needs_review') {
            try {
                // @ts-ignore
                const details = await window.api.invoke('get-campaign-details', campaign.id)
                if (details) {
                    // @ts-ignore
                    await window.api.invoke('open-campaign-wizard', details)
                }
            } catch (e) {
                console.error('Failed to open review wizard:', e)
            }
        } else {
            // @ts-ignore
            await window.api.invoke('open-campaign-details', campaign.id)
        }
    }, [])

    const handleDelete = React.useCallback(async (id: number) => {
        dispatch(deleteCampaign(id))
    }, [dispatch])

    const handleRun = React.useCallback(async (id: number) => {
        const camp = campaigns.find(c => c.id === id)
        const name = camp ? camp.name : 'Campaign'

        try {
            // Check for missed jobs first
            // @ts-ignore
            const missedJobs = await window.api.invoke('job:get-campaign-missed', id)

            if (missedJobs && missedJobs.length > 0) {
                setRescheduleTarget({ campaign: camp, missedJobs })
                return
            }

            if (!confirm(`Run "${name}" immediately?`)) return

            dispatch(addProcessingId(id))
            dispatch(triggerCampaign({ id, runNow: true }))
        } catch (err) {
            console.error('Failed to run campaign:', err)
            dispatch(removeProcessingId(id))
        }
    }, [campaigns, dispatch])

    const handleClone = React.useCallback(async (id: number) => {
        try {
            // @ts-ignore
            const details = await window.api.invoke('get-campaign-details', id)
            if (details) {
                // @ts-ignore
                await window.api.invoke('open-campaign-wizard', details)
            }
        } catch (e) {
            console.error('Failed to prepare clone:', e)
        }
    }, [])

    return (
        <div className="page-enter" style={{ flex: 1, height: '100%', display: 'flex', flexDirection: 'column', padding: '24px', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                <div>
                    <h1 style={{ margin: 0, fontSize: '22px', fontWeight: 700 }}>Campaigns</h1>
                    <p style={{ margin: '4px 0 0', fontSize: '13px', color: 'var(--text-muted)' }}>
                        Manage your automated content pipelines
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button className="btn btn-ghost" onClick={async () => {
                        try {
                            // @ts-ignore
                            const res = await window.api.invoke('run-self-test')
                            if (res.success) {
                                alert('✅ Self-Test Passed!\n' + res.logs.join('\n'))
                                dispatch(fetchCampaigns())
                            } else {
                                alert('❌ Self-Test Failed:\n' + res.error + '\n\nLogs:\n' + res.logs.join('\n'))
                            }
                        } catch (e: any) {
                            alert('Failed to run test: ' + e.message)
                        }
                    }}>
                        🛠️ Simulate & Verify
                    </button>
                    <button className="btn btn-secondary" onClick={handleOpenScanner}>
                        🔍 Scanner Tool
                    </button>
                    <button className="btn btn-ghost" onClick={async () => {
                        // @ts-ignore
                        window.api.invoke('logger:open-folder')
                    }}>
                        📂 Open Logs
                    </button>
                    <button className="btn btn-ghost" style={{ color: '#ff4d4d' }} onClick={() => {
                        console.log('Triggering Sentry Error...');
                        // @ts-ignore
                        throw new Error('Sentry Test Error from Renderer');
                    }}>
                        💥 Sentry Error
                    </button>
                    <button className="btn btn-primary" data-testid="wizard-new-campaign-btn" onClick={async () => {
                        // @ts-ignore
                        await window.api.invoke('open-campaign-wizard')
                    }}>
                        + New Campaign
                    </button>
                </div>
            </div>

            <div className="tabs" style={{ marginBottom: '15px', borderBottom: '1px solid var(--border-primary)' }}>
                <button
                    className={`tab ${activeTab === 'all' ? 'active' : ''}`}
                    onClick={() => setActiveTab('all')}
                >
                    📁 All Campaigns
                </button>
                <button
                    className={`tab ${activeTab === 'today' ? 'active' : ''}`}
                    onClick={() => setActiveTab('today')}
                >
                    📅 Today's Schedule
                </button>
            </div>

            <div style={{ flex: 1, overflow: 'hidden' }}>
                {activeTab === 'all' ? (
                    <CampaignList
                        campaigns={campaigns as any}
                        onCreate={async () => {
                            // @ts-ignore
                            await window.api.invoke('open-campaign-wizard')
                        }}
                        onToggleStatus={handleToggleStatus}
                        onSelect={handleSelectCampaign}
                        onDelete={handleDelete}
                        onRun={handleRun}
                        onPause={handlePause}
                        onClone={handleClone}
                        processingIds={processingIds}
                    />
                ) : (
                    <TodaySchedule />
                )}
            </div>

            {rescheduleTarget && (
                <RescheduleModal
                    missedJobs={rescheduleTarget.missedJobs}
                    onResume={async (items) => {
                        // @ts-ignore
                        await window.api.invoke('job:resume-recovery', items)
                        setRescheduleTarget(null)
                        dispatch(fetchCampaigns())
                    }}
                    onDiscard={async () => {
                        // @ts-ignore
                        await window.api.invoke('job:discard-recovery', rescheduleTarget.missedJobs.map(j => j.id))
                        setRescheduleTarget(null)
                        dispatch(fetchCampaigns())
                    }}
                />
            )}
        </div>
    )
}
