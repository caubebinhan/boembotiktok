import { storageService } from './StorageService'

export interface JobPlugin {
    name: string
    enabled: boolean
    priority: number
    canHandle(jobType: 'DOWNLOAD' | 'PUBLISH', data: any): boolean
    execute(job: any, data: any, next: () => Promise<void>): Promise<void>
    onFail?(job: any, error: Error): Promise<void>
}

class PluginPipeline {
    private plugins: JobPlugin[] = []

    register(plugin: JobPlugin) {
        this.plugins.push(plugin)
        this.plugins.sort((a, b) => a.priority - b.priority)
    }

    async run(jobType: 'DOWNLOAD' | 'PUBLISH', job: any, data: any) {
        const chain = this.plugins.filter(p => p.enabled && p.canHandle(jobType, data))
        let index = 0

        const next = async () => {
            if (index >= chain.length) return
            const plugin = chain[index++]

            // Track plugin stage in DB
            storageService.run(
                "UPDATE jobs SET plugin_stage = ? WHERE id = ?",
                [plugin.name, job.id]
            )

            await plugin.execute(job, data, next)
        }

        await next()
    }
}

export const pluginPipeline = new PluginPipeline()

// Normally you would register plugins here or elsewhere during initialization
