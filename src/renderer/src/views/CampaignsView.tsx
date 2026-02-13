import React, { useState, useEffect } from 'react'
import { CampaignList } from '../components/CampaignList'
import { CampaignWizard } from '../components/CampaignWizard'
import { CampaignDetailsModal } from '../components/CampaignDetailsModal'

export const CampaignsView: React.FC = () => {
    const [campaigns, setCampaigns] = useState<any[]>([])
    const [showCreateModal, setShowCreateModal] = useState(false)
    const [selectedCampaign, setSelectedCampaign] = useState<any>(null)

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
    }, [])

    const handleCreateCampaign = async (data: any, runNow: boolean) => {
        try {
            // Build cron from schedule
            let cron = ''
            if (data.type === 'scheduled') {
                cron = `*/${data.schedule.interval} * * * *`
            }

            // Full config includes all wizard data
            const config = {
                sources: data.sourceData?.channels && data.sourceData?.keywords ? {
                    channels: data.sourceData.channels,
                    keywords: data.sourceData.keywords
                } : { channels: [], keywords: [] },
                videos: data.sourceData?.videos || [],
                postOrder: data.postOrder || 'newest',
                editPipeline: data.editPipeline,
                targetAccounts: data.targetAccounts,
                schedule: data.schedule
            }

            // @ts-ignore
            const result = await window.api.invoke('create-campaign', data.name, data.type, cron, config)

            if (runNow && result && result.lastInsertId) {
                // @ts-ignore
                await window.api.invoke('trigger-campaign', result.lastInsertId)
            }

            setShowCreateModal(false)
            loadCampaigns()
        } catch (err) {
            console.error('Failed to create campaign:', err)
        }
    }

    const handleToggleStatus = async (id: number, currentStatus: string) => {
        console.log('Toggle', id, currentStatus)
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
        await window.api.openCampaignDetails(campaign.id)
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

    const handleRun = async (id: number) => {
        // Find campaign name for better feedback
        const camp = campaigns.find(c => c.id === id)
        const name = camp ? camp.name : 'Campaign'

        try {
            // Show toast/alert? Or just set a local loading state?
            // For now, let's use a simple alert or console, but user asked for "feedback"
            // Let's rely on job updates?
            // Better: optimistic UI or toast. Since I don't have a toast lib setup, I'll use window.alert or a custom overlay.
            // Actually, let's just log it and maybe show a "Triggered" badge?
            // User specifically asked: "bấm run campaign không có phản hồi gì hết"

            if (!confirm(`Run "${name}" immediately?`)) return

            // @ts-ignore
            await window.api.invoke('trigger-campaign', id)
            loadCampaigns() // Refresh to show running status if applicable
        } catch (err) {
            console.error('Failed to run campaign:', err)
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
                    <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
                        + New Campaign
                    </button>
                </div>
            </div>

            <div style={{ flex: 1, overflow: 'hidden' }}>
                <CampaignList
                    campaigns={campaigns}
                    // @ts-ignore
                    onCreate={() => setShowCreateModal(true)}
                    // @ts-ignore
                    onToggleStatus={handleToggleStatus}
                    onSelect={handleSelectCampaign}
                    onDelete={handleDelete}
                    onRun={handleRun}
                />
            </div>

            {showCreateModal && (
                <CampaignWizard
                    onClose={() => setShowCreateModal(false)}
                    onSave={handleCreateCampaign}
                />
            )}
        </div>
    )
}
