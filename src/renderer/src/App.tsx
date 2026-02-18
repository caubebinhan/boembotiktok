import { useState, useEffect } from 'react'
import { Sidebar } from './components/Sidebar'
import { CampaignsView } from './views/CampaignsView'
import { AccountsView } from './views/AccountsView'
import { ResourcesView } from './views/ResourcesView'
import { ScheduleView } from './views/ScheduleView'
import { StatsView } from './views/StatsView'
import { SettingsView } from './views/SettingsView'
import { CampaignDetailsWindow } from './views/CampaignDetailsWindow'
import { DebugConsole } from './components/DebugConsole'
import { RescheduleModal } from './components/RescheduleModal'

import { ScannerApp } from './ScannerApp'

function App(): JSX.Element {
    const [activeTab, setActiveTab] = useState<'campaigns' | 'accounts' | 'resources' | 'schedule' | 'stats' | 'settings'>('campaigns')
    const [viewMode, setViewMode] = useState<'scan' | 'normal' | 'campaign-details'>('normal')
    const [campaignId, setCampaignId] = useState<number | null>(null)
    const [missedJobs, setMissedJobs] = useState<any[]>([])
    const [showRecoveryModal, setShowRecoveryModal] = useState(false)

    useEffect(() => {
        const params = new URLSearchParams(window.location.search)
        const mode = params.get('mode')
        const id = params.get('id')

        if (mode === 'scan') {
            setViewMode('scan')
        } else if (mode === 'campaign-details' && id) {
            setViewMode('campaign-details')
            setCampaignId(Number(id))
        }
    }, [])

    // Check for crash recovery on mount
    useEffect(() => {
        const checkRecovery = async () => {
            try {
                const jobs = await (window as any).api.invoke('job:get-missed')
                if (jobs && jobs.length > 0) {
                    console.log('Found missed jobs:', jobs)
                    setMissedJobs(jobs)
                    setShowRecoveryModal(true)
                }
            } catch (e) {
                console.error('Failed to check recovery:', e)
            }
        }
        checkRecovery()
    }, [])

    const handleResumeRecovery = async (items: { id: number, scheduled_for: string }[]) => {
        try {
            await (window as any).api.invoke('job:resume-recovery', items)
            setShowRecoveryModal(false)
            // Optional: Show success toast
        } catch (e) {
            console.error('Failed to resume:', e)
        }
    }

    if (viewMode === 'scan') {
        return <ScannerApp />
    }

    if (viewMode === 'campaign-details' && campaignId) {
        return <CampaignDetailsWindow id={campaignId} />
    }

    // Default App Layout
    return (
        <div style={{ width: '100vw', height: '100vh', overflow: 'hidden', display: 'flex', background: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            {/* Sidebar Navigation */}
            <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

            {/* Main Content Area */}
            <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                {activeTab === 'campaigns' && <CampaignsView />}
                {activeTab === 'accounts' && <AccountsView />}
                {activeTab === 'resources' && <ResourcesView />}
                {activeTab === 'schedule' && <ScheduleView />}
                {activeTab === 'stats' && <StatsView />}
                {activeTab === 'settings' && <SettingsView />}

                {showRecoveryModal && (
                    <RescheduleModal
                        missedJobs={missedJobs}
                        onResume={handleResumeRecovery}
                        onDiscard={async () => {
                            try {
                                const ids = missedJobs.map(j => j.id)
                                await (window as any).api.invoke('job:discard-recovery', ids)
                                setShowRecoveryModal(false)
                            } catch (e) { console.error('Discard failed', e) }
                        }}
                    />
                )}
            </div>

            <DebugConsole />
        </div>
    )
}

export default App
