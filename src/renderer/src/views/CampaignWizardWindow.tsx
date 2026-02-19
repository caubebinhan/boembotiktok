import React from 'react'
import { CampaignWizard } from '../components/CampaignWizard'
import { Provider } from 'react-redux'
import { store } from '../store/store'

/**
 * Standalone window wrapper for CampaignWizard.
 * This renders when the browser window is opened with ?mode=campaign-wizard.
 * It handles save/close by sending IPC messages to the main process.
 */
export function CampaignWizardWindow() {
    const params = new URLSearchParams(window.location.search)
    const initialDataParam = params.get('initialData')
    const initialData = initialDataParam ? JSON.parse(decodeURIComponent(initialDataParam)) : undefined

    const handleSave = async (data: any, runNow: boolean) => {
        try {
            let cron = ''
            if (data.type === 'scheduled' && data.schedule) {
                const interval = Math.max(1, Number(data.schedule.interval) || 60)
                cron = `*/${interval} * * * *`
            }

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
                executionOrder: data.executionOrder,
                captionTemplate: data.captionTemplate,
                autoSchedule: data.autoSchedule,
                advancedVerification: data.advancedVerification
            }

            // Send to main to create or save
            // @ts-ignore
            const result = await window.api.invoke('create-campaign', data.name, data.type, cron, config)

            if (result?.lastInsertId && runNow) {
                // @ts-ignore
                await window.api.invoke('trigger-campaign', result.lastInsertId, true)
            }

            // Notify all windows and close
            // @ts-ignore
            await window.api.invoke('wizard:close-and-notify')
        } catch (err) {
            console.error('Wizard save error:', err)
        }
    }

    const handleClose = async () => {
        // @ts-ignore
        await window.api.invoke('wizard:close')
    }

    return (
        <Provider store={store}>
            <div style={{
                width: '100vw',
                height: '100vh',
                overflow: 'hidden',
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)'
            }}>
                <CampaignWizard
                    onClose={handleClose}
                    onSave={handleSave}
                    initialData={initialData}
                />
            </div>
        </Provider>
    )
}
