/**
 * Video Edit Engine — Shared Types
 * All interfaces that the engine, providers, effects, and frontend share.
 */

/** Describes a single parameter that an effect accepts */
export interface EditParam {
    key: string
    label: string
    type: 'file' | 'text' | 'number' | 'color' | 'select'
    default?: any
    options?: { value: string; label: string }[]
    min?: number
    max?: number
    accept?: string  // for file type: e.g. 'image/*'
}

/** Describes a registered effect (what the frontend sees) */
export interface EditEffect {
    id: string
    name: string
    description: string
    icon: string
    category: 'intro' | 'overlay' | 'transform' | 'filter' | 'audio'
    params: EditParam[]
}

/** An effect applied by the user, with concrete parameter values */
export interface AppliedEffect {
    effectId: string
    params: Record<string, any>
}

/** Ordered list of effects to apply to a video */
export interface EditPipeline {
    effects: AppliedEffect[]
}

/** Provider interface — any rendering backend must implement this */
export interface IEditProvider {
    readonly name: string
    readonly description: string

    /** Render the full pipeline to an output file */
    render(inputPath: string, pipeline: EditPipeline, outputPath: string): Promise<string>

    /** Generate a single preview frame at a given timestamp */
    getPreviewFrame(inputPath: string, pipeline: EditPipeline, timestampSec: number): Promise<Buffer>

    /** Check if this provider is available (e.g. ffmpeg binary exists) */
    isAvailable(): Promise<boolean>
}

/** Render progress callback */
export interface RenderProgress {
    percent: number
    currentEffect: string
    timeElapsed: number
}
