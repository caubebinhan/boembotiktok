import React, { useState, useEffect } from 'react'
import { CampaignList } from '../components/CampaignList'
import { CampaignWizard } from '../components/CampaignWizard'
import { TodaySchedule } from '../components/TodaySchedule'
import { RescheduleModal } from '../components/RescheduleModal'

export const CampaignsView: React.FC = () => {
    const [campaigns, setCampaigns] = useState<any[]>([])
    const [wizardState, setWizardState] = useState<{ isOpen: boolean, initialData?: any }>({ isOpen: false })
    const [activeTab, setActiveTab] = useState<'all' | 'today'>('all')
    const [rescheduleTarget, setRescheduleTarget] = useState<{ campaign: any, missedJobs: any[] } | null>(null)

    // ... (loadCampaigns is same)

    const loadCampaigns = async () => {
        try {
            // @ts-ignore
            const data = await window.api.invoke('get-campaigns')
            setCampaigns(data || [])
        } catch (err) {
            console.error(err)
        }
    }

    useEffect(() => {
        loadCampaigns()

        // Listen for updates from other windows (e.g. details window closed)
        // @ts-ignore
        const removeListener = window.api.on('campaigns-updated', () => {
            loadCampaigns()
        })
        return () => {
            if (removeListener) removeListener()
        }
    }, [])

    const handleCreateCampaign = async (data: any, runNow: boolean) => {
        try {
            // Build cron from schedule
            let cron = ''
            if (data.type === 'scheduled' && data.schedule) {
                // Ensure valid interval
                const interval = Math.max(1, Number(data.schedule.interval) || 60)
                cron = `*/${interval} * * * *`
            }

            // Full config includes all wizard data
            const config = {
                sources: data.sourceData?.channels || data.sourceData?.keywords ? {
                    channels: data.sourceData.channels || [],
                    keywords: data.sourceData.keywords || []
                } : { channels: [], keywords: [] },
                videos: data.sourceData?.videos || [],
                postOrder: data.postOrder || 'newest',
                editPipeline: data.editPipeline,
                targetAccounts: data.targetAccounts,
                schedule: data.schedule,
                executionOrder: data.executionOrder, // Pass manual schedule to backend
                captionTemplate: data.captionTemplate, // Ensure caption template is saved
                autoSchedule: data.autoSchedule,
                advancedVerification: data.advancedVerification
            }

            // @ts-ignore
            const result = await window.api.invoke('create-campaign', data.name, data.type, cron, config)

            // triggerCampaign handles everything: singles first, then scans
            if (result && result.lastInsertId) {
                // @ts-ignore
                await window.api.invoke('trigger-campaign', result.lastInsertId, runNow)
            }

            setWizardState({ isOpen: false })
            loadCampaigns()
        } catch (err) {
            console.error('Failed to create campaign:', err)
        }
    }

    // ... (handlers)

    const handleToggleStatus = async (id: number, currentStatus: string) => {
        try {
            const nextStatus = currentStatus === 'active' ? 'paused' : 'active'
            // @ts-ignore
            await window.api.invoke('update-campaign-status', id, nextStatus)
            loadCampaigns()
        } catch (err) {
            console.error('Failed to toggle status:', err)
        }
    }

    const handlePause = async (id: number) => {
        try {
            // @ts-ignore
            await window.api.invoke('campaign:pause', id)
            await loadCampaigns()
        } catch (err) {
            console.error('Failed to pause campaign:', err)
        }
    }

    const handleOpenScanner = async () => {
        try {
            // @ts-ignore
            await window.api.invoke('open-scanner-window')
        } catch (err) {
            console.error('Failed to open scanner:', err)
        }
    }

    const handleSelectCampaign = async (campaign: any) => {
        // @ts-ignore
        await window.api.invoke('open-campaign-details', campaign.id)
    }

    const handleDelete = async (id: number) => {
        try {
            // @ts-ignore
            await window.api.invoke('delete-campaign', id)
            loadCampaigns()
        } catch (err) {
            console.error('Failed to delete campaign:', err)
        }
    }

    const [processingIds, setProcessingIds] = useState<Set<number>>(new Set())

    const handleRun = async (id: number) => {
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

            // Optimistic UI: Disable button immediately
            setProcessingIds(prev => new Set(prev).add(id))

            // @ts-ignore
            await window.api.invoke('trigger-campaign', id, true)
            // Small delay to ensure DB updates are committed
            await new Promise(resolve => setTimeout(resolve, 500))
            await loadCampaigns()
        } catch (err) {
            console.error('Failed to run campaign:', err)
        } finally {
            setProcessingIds(prev => {
                const next = new Set(prev)
                next.delete(id)
                return next
            })
        }
    }

    const handleClone = async (id: number) => {
        try {
            // Fetch full campaign details including config
            // @ts-ignore
            const details = await window.api.invoke('get-campaign-details', id)
            if (details) {
                setWizardState({ isOpen: true, initialData: details })
            }
        } catch (e) {
            console.error('Failed to prepare clone:', e)
        }
    }

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
                                loadCampaigns()
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
                    <button className="btn btn-primary" data-testid="wizard-new-campaign-btn" onClick={() => setWizardState({ isOpen: true })}>
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
                        campaigns={campaigns}
                        // @ts-ignore
                        onCreate={() => setWizardState({ isOpen: true })}
                        // @ts-ignore
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

            {wizardState.isOpen && (
                <CampaignWizard
                    onClose={() => setWizardState({ isOpen: false })}
                    onSave={handleCreateCampaign}
                    initialData={wizardState.initialData}
                />
            )}
            {rescheduleTarget && (
                <RescheduleModal
                    missedJobs={rescheduleTarget.missedJobs}
                    onResume={async (items) => {
                        // @ts-ignore
                        await window.api.invoke('job:resume-recovery', items)
                        setRescheduleTarget(null)
                        loadCampaigns()
                    }}
                    onDiscard={async () => {
                        // @ts-ignore
                        await window.api.invoke('job:discard-recovery', rescheduleTarget.missedJobs.map(j => j.id))
                        setRescheduleTarget(null)
                        loadCampaigns()
                    }}
                />
            )}
        </div>
    )
}
