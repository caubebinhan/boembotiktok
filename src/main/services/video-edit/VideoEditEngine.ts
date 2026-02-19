import { EditEffect, EditPipeline, IEditProvider } from './types'
import { LocalFFmpegProvider } from './providers/LocalFFmpegProvider'

// Effect definitions (auto-registered)
import { IntroImageEffect } from './effects/IntroImageEffect'
import { TextOverlayEffect } from './effects/TextOverlayEffect'
import { WatermarkEffect } from './effects/WatermarkEffect'
import { MirrorEffect } from './effects/MirrorEffect'
import { ColorAdjustmentEffect } from './effects/ColorAdjustmentEffect'
import { SpeedAdjustmentEffect } from './effects/SpeedAdjustmentEffect'
import { SubtleZoomEffect } from './effects/SubtleZoomEffect'

/**
 * VideoEditEngine — Core orchestrator.
 * 
 * Manages a registry of effects and providers.
 * The frontend calls getEffects() to discover what's available,
 * then sends an EditPipeline to render().
 * 
 * To add a new effect:
 *   1. Create a file in effects/ (just an EditEffect object)
 *   2. Import and register it here
 *   → Frontend auto-discovers it via IPC
 * 
 * To add a new provider:
 *   1. Create a class implementing IEditProvider
 *   2. Register it here with registerProvider()
 */
class VideoEditEngine {
    private effects: Map<string, EditEffect> = new Map()
    private providers: Map<string, IEditProvider> = new Map()
    private activeProvider: string = 'local_ffmpeg'

    constructor() {
        // Register built-in effects
        this.registerEffect(IntroImageEffect)
        this.registerEffect(TextOverlayEffect)
        this.registerEffect(WatermarkEffect)
        this.registerEffect(MirrorEffect)
        this.registerEffect(ColorAdjustmentEffect)
        this.registerEffect(SpeedAdjustmentEffect)
        this.registerEffect(SubtleZoomEffect)

        // Register built-in providers
        const localProvider = new LocalFFmpegProvider()
        this.registerProvider(localProvider)

        console.log(`[VideoEditEngine] Initialized with ${this.effects.size} effects, ${this.providers.size} providers`)
    }

    // ─── Effect Registry ───────────────────────────────────────

    registerEffect(effect: EditEffect): void {
        this.effects.set(effect.id, effect)
        console.log(`[VideoEditEngine] Registered effect: ${effect.id}`)
    }

    getEffects(): EditEffect[] {
        return Array.from(this.effects.values())
    }

    getEffect(id: string): EditEffect | undefined {
        return this.effects.get(id)
    }

    // ─── Provider Registry ─────────────────────────────────────

    registerProvider(provider: IEditProvider): void {
        this.providers.set(provider.name, provider)
        console.log(`[VideoEditEngine] Registered provider: ${provider.name}`)
    }

    getProviders(): string[] {
        return Array.from(this.providers.keys())
    }

    setActiveProvider(name: string): void {
        if (!this.providers.has(name)) {
            throw new Error(`Provider not found: ${name}`)
        }
        this.activeProvider = name
    }

    private getProvider(): IEditProvider {
        const provider = this.providers.get(this.activeProvider)
        if (!provider) throw new Error(`Active provider not found: ${this.activeProvider}`)
        return provider
    }

    // ─── Rendering API ─────────────────────────────────────────

    async render(inputPath: string, pipeline: EditPipeline, outputPath: string): Promise<string> {
        const provider = this.getProvider()
        console.log(`[VideoEditEngine] Rendering ${pipeline.effects.length} effects with provider: ${this.activeProvider}`)
        return provider.render(inputPath, pipeline, outputPath)
    }

    async getPreviewFrame(inputPath: string, pipeline: EditPipeline, timestampSec: number): Promise<Buffer> {
        const provider = this.getProvider()
        return provider.getPreviewFrame(inputPath, pipeline, timestampSec)
    }

    // ─── Validation ────────────────────────────────────────────

    validatePipeline(pipeline: EditPipeline): { valid: boolean; errors: string[] } {
        const errors: string[] = []

        for (const applied of pipeline.effects) {
            const effectDef = this.effects.get(applied.effectId)
            if (!effectDef) {
                errors.push(`Unknown effect: ${applied.effectId}`)
                continue
            }

            // Check required params
            for (const param of effectDef.params) {
                if (param.default === undefined && (applied.params[param.key] === undefined || applied.params[param.key] === '')) {
                    errors.push(`Effect "${effectDef.name}": missing required param "${param.label}"`)
                }
            }
        }

        return { valid: errors.length === 0, errors }
    }
}

// Singleton
export const videoEditEngine = new VideoEditEngine()
