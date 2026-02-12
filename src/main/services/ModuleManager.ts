export interface PlatformModule {
    name: string
    id: string
    initialize(): Promise<void>
    shutdown(): Promise<void>
}

class ModuleManager {
    private modules: Map<string, PlatformModule> = new Map()

    async loadModule(module: PlatformModule) {
        if (this.modules.has(module.id)) {
            console.warn(`Module ${module.id} already loaded`)
            return
        }

        try {
            await module.initialize()
            this.modules.set(module.id, module)
            console.log(`Module loaded: ${module.name}`)
        } catch (error) {
            console.error(`Failed to load module ${module.name}:`, error)
        }
    }

    async unloadModule(moduleId: string) {
        const module = this.modules.get(moduleId)
        if (module) {
            await module.shutdown()
            this.modules.delete(moduleId)
            console.log(`Module unloaded: ${module.name}`)
        }
    }

    getModule(moduleId: string): PlatformModule | undefined {
        return this.modules.get(moduleId)
    }
}

export const moduleManager = new ModuleManager()
