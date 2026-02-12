import React, { useState, useEffect } from 'react'
import { CampaignList } from '../components/CampaignList'
import { CampaignWizard } from '../components/CampaignWizard'

interface CampaignsViewProps {
    onOpenScanner: () => void
    onOpenScannerForWizard: (callback: (source: any) => void) => void
}

export const CampaignsView: React.FC<CampaignsViewProps> = ({ onOpenScanner, onOpenScannerForWizard }) => {
    const [campaigns, setCampaigns] = useState<any[]>([])
    const [showCreateModal, setShowCreateModal] = useState(false)

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
            // Construct Cron based on schedule
            let cron = ''
            if (data.type === 'scheduled') {
                cron = `*/${data.schedule.interval} * * * *`
            }

            const config = {
                source: data.sourceConfig,
                editPipeline: data.editPipeline,
                targetAccounts: data.targetAccounts, // Now an array
                scheduleDetails: data.schedule,
                runNow
            }

            // @ts-ignore
            const result = await window.api.invoke('create-campaign', data.name, data.type, cron, config)

            if (runNow && result && result.id) {
                // @ts-ignore
                await window.api.invoke('trigger-campaign', result.id)
            }

            setShowCreateModal(false)
            loadCampaigns()
        } catch (err) {
            console.error(err)
        }
    }

    const handleToggleStatus = async (id: number, currentStatus: string) => {
        console.log('Toggle', id, currentStatus)
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
                    <button className="btn btn-secondary" onClick={onOpenScanner}>
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
                    onCreate={() => setShowCreateModal(true)}
                    onToggleStatus={handleToggleStatus}
                />
            </div>

            {showCreateModal && (
                <CampaignWizard
                    onClose={() => setShowCreateModal(false)}
                    onSave={handleCreateCampaign}
                    onOpenScanner={onOpenScannerForWizard}
                />
            )}
        </div>
    )
}
