import ffmpeg from 'fluent-ffmpeg'
import * as path from 'path'
import * as fs from 'fs'
import { IEditProvider, EditPipeline, AppliedEffect } from '../types'

const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static')

/**
 * LocalFFmpegProvider — Default rendering provider using fluent-ffmpeg.
 * Translates an EditPipeline into FFmpeg filter chains and executes locally.
 */
export class LocalFFmpegProvider implements IEditProvider {
    readonly name = 'local_ffmpeg'
    readonly description = 'Local FFmpeg processing (no cloud, no API calls)'

    constructor() {
        if (ffmpegPath) ffmpeg.setFfmpegPath(ffmpegPath)
        if (ffprobePath?.path) ffmpeg.setFfprobePath(ffprobePath.path)
    }

    async isAvailable(): Promise<boolean> {
        return !!ffmpegPath
    }

    /**
     * Render a full pipeline. Effects are applied sequentially.
     * For MVP: we chain effects by processing them one at a time,
     * using intermediate temp files.
     */
    async render(inputPath: string, pipeline: EditPipeline, outputPath: string): Promise<string> {
        if (!pipeline.effects || pipeline.effects.length === 0) {
            // No effects → just copy
            fs.copyFileSync(inputPath, outputPath)
            return outputPath
        }

        let currentInput = inputPath
        const tempFiles: string[] = []

        for (let i = 0; i < pipeline.effects.length; i++) {
            const effect = pipeline.effects[i]
            const isLast = i === pipeline.effects.length - 1
            const currentOutput = isLast
                ? outputPath
                : path.join(path.dirname(outputPath), `_temp_effect_${i}_${Date.now()}.mp4`)

            if (!isLast) tempFiles.push(currentOutput)

            await this.applyEffect(currentInput, effect, currentOutput)
            currentInput = currentOutput
        }

        // Cleanup temp files
        for (const tmp of tempFiles) {
            try { fs.unlinkSync(tmp) } catch { }
        }

        return outputPath
    }

    /**
     * Generate a preview frame at a given timestamp.
     * For effects that modify the video content, we render a short segment
     * and extract a frame. For MVP: just extract a frame from original.
     */
    async getPreviewFrame(inputPath: string, pipeline: EditPipeline, timestampSec: number): Promise<Buffer> {
        const tempFrame = path.join(path.dirname(inputPath), `_preview_${Date.now()}.jpg`)

        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .seekInput(timestampSec)
                .frames(1)
                .outputOptions('-vf', 'scale=480:-1')
                .on('end', () => {
                    try {
                        const data = fs.readFileSync(tempFrame)
                        fs.unlinkSync(tempFrame)
                        resolve(data)
                    } catch (e) {
                        reject(e)
                    }
                })
                .on('error', reject)
                .save(tempFrame)
        })
    }

    // ─── Effect Handlers ───────────────────────────────────────

    private async applyEffect(inputPath: string, effect: AppliedEffect, outputPath: string): Promise<void> {
        switch (effect.effectId) {
            case 'intro_image':
                return this.applyIntroImage(inputPath, effect.params, outputPath)
            case 'text_overlay':
                return this.applyTextOverlay(inputPath, effect.params, outputPath)
            case 'watermark':
                return this.applyWatermark(inputPath, effect.params, outputPath)
            case 'mirror':
                return this.applyMirror(inputPath, effect.params, outputPath)
            case 'color_adjust':
                return this.applyColorAdjust(inputPath, effect.params, outputPath)
            case 'speed_adjust':
                return this.applySpeedAdjust(inputPath, effect.params, outputPath)
            case 'subtle_zoom':
                return this.applySubtleZoom(inputPath, effect.params, outputPath)
            default:
                throw new Error(`Unknown effect: ${effect.effectId}`)
        }
    }

    private async applyIntroImage(inputPath: string, params: Record<string, any>, outputPath: string): Promise<void> {
        const { imagePath, duration = 3 } = params
        if (!imagePath || !fs.existsSync(imagePath)) {
            throw new Error(`Intro image not found: ${imagePath}`)
        }

        return new Promise((resolve, reject) => {
            ffmpeg()
                .input(imagePath)
                .inputOption('-loop 1')
                .inputOption(`-t ${duration}`)
                .input(inputPath)
                .complexFilter([
                    `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v0]`,
                    `[1:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v1]`,
                    `aevalsrc=0:d=${duration}[a0]`,
                    `[v0][a0][v1][1:a]concat=n=2:v=1:a=1[outv][outa]`
                ])
                .outputOptions(['-map [outv]', '-map [outa]', '-c:v libx264', '-pix_fmt yuv420p', '-preset fast'])
                .on('start', cmd => console.log('[IntroImage] FFmpeg:', cmd))
                .on('end', () => resolve())
                .on('error', err => reject(err))
                .save(outputPath)
        })
    }

    private async applyTextOverlay(inputPath: string, params: Record<string, any>, outputPath: string): Promise<void> {
        const { text = 'Hello', fontSize = 36, fontColor = '#ffffff', position = 'center' } = params

        const positionMap: Record<string, { x: string; y: string }> = {
            'top': { x: '(w-text_w)/2', y: '50' },
            'center': { x: '(w-text_w)/2', y: '(h-text_h)/2' },
            'bottom': { x: '(w-text_w)/2', y: 'h-text_h-50' },
            'top-left': { x: '50', y: '50' },
            'top-right': { x: 'w-text_w-50', y: '50' },
            'bottom-left': { x: '50', y: 'h-text_h-50' },
            'bottom-right': { x: 'w-text_w-50', y: 'h-text_h-50' }
        }

        const pos = positionMap[position] || positionMap['center']
        // Strip '#' from color for FFmpeg
        const color = fontColor.startsWith('#') ? fontColor.slice(1) : fontColor

        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .videoFilters([{
                    filter: 'drawtext',
                    options: {
                        text: text.replace(/'/g, "'\\''"),
                        fontsize: fontSize,
                        fontcolor: `0x${color}`,
                        x: pos.x,
                        y: pos.y,
                        shadowcolor: 'black',
                        shadowx: 2,
                        shadowy: 2
                    }
                }])
                .outputOptions(['-c:a copy', '-preset fast'])
                .on('start', cmd => console.log('[TextOverlay] FFmpeg:', cmd))
                .on('end', () => resolve())
                .on('error', err => reject(err))
                .save(outputPath)
        })
    }

    private async applyWatermark(inputPath: string, params: Record<string, any>, outputPath: string): Promise<void> {
        const { imagePath, position = 'bottom-right', opacity = 50, scale = 20 } = params
        if (!imagePath || !fs.existsSync(imagePath)) {
            throw new Error(`Watermark image not found: ${imagePath}`)
        }

        const overlayMap: Record<string, string> = {
            'top-left': '10:10',
            'top-right': 'main_w-overlay_w-10:10',
            'bottom-left': '10:main_h-overlay_h-10',
            'bottom-right': 'main_w-overlay_w-10:main_h-overlay_h-10',
            'center': '(main_w-overlay_w)/2:(main_h-overlay_h)/2'
        }

        const overlayPos = overlayMap[position] || overlayMap['bottom-right']
        const alphaFilter = opacity < 100 ? `,format=rgba,colorchannelmixer=aa=${opacity / 100}` : ''
        const scaleFactor = scale / 100

        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .input(imagePath)
                .complexFilter([
                    `[1:v]scale=iw*${scaleFactor}:ih*${scaleFactor}${alphaFilter}[wm]`,
                    `[0:v][wm]overlay=${overlayPos}[outv]`
                ])
                .outputOptions(['-map [outv]', '-map 0:a?', '-c:a copy', '-preset fast'])
                .on('start', cmd => console.log('[Watermark] FFmpeg:', cmd))
                .on('end', () => resolve())
                .on('error', err => reject(err))
                .save(outputPath)
        })
    }

    private async applyMirror(inputPath: string, params: Record<string, any>, outputPath: string): Promise<void> {
        const { active = 'true' } = params
        if (active !== 'true') {
            fs.copyFileSync(inputPath, outputPath)
            return
        }

        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .videoFilters('hflip')
                .outputOptions(['-c:a copy', '-preset fast'])
                .on('start', cmd => console.log('[Mirror] FFmpeg:', cmd))
                .on('end', () => resolve())
                .on('error', err => reject(err))
                .save(outputPath)
        })
    }

    private async applyColorAdjust(inputPath: string, params: Record<string, any>, outputPath: string): Promise<void> {
        const { brightness = 0.05, contrast = 1.05, saturation = 1.1 } = params

        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .videoFilters([{
                    filter: 'eq',
                    options: {
                        brightness,
                        contrast,
                        saturation
                    }
                }])
                .outputOptions(['-c:a copy', '-preset fast'])
                .on('start', cmd => console.log('[ColorAdjust] FFmpeg:', cmd))
                .on('end', () => resolve())
                .on('error', err => reject(err))
                .save(outputPath)
        })
    }

    private async applySpeedAdjust(inputPath: string, params: Record<string, any>, outputPath: string): Promise<void> {
        const { multiplier = 1.02 } = params
        const videoMult = 1 / multiplier

        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .complexFilter([
                    `[0:v]setpts=${videoMult}*PTS[v]`,
                    `[0:a]atempo=${multiplier}[a]`
                ])
                .outputOptions(['-map [v]', '-map [a]', '-preset fast'])
                .on('start', cmd => console.log('[SpeedAdjust] FFmpeg:', cmd))
                .on('end', () => resolve())
                .on('error', err => reject(err))
                .save(outputPath)
        })
    }

    private async applySubtleZoom(inputPath: string, params: Record<string, any>, outputPath: string): Promise<void> {
        const { level = 2 } = params
        const zoom = 1 + (level / 100)

        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .videoFilters([
                    {
                        filter: 'scale',
                        options: `iw*${zoom}:-1`
                    },
                    {
                        filter: 'crop',
                        options: `iw/${zoom}:ih/${zoom}`
                    }
                ])
                .outputOptions(['-c:a copy', '-preset fast'])
                .on('start', cmd => console.log('[SubtleZoom] FFmpeg:', cmd))
                .on('end', () => resolve())
                .on('error', err => reject(err))
                .save(outputPath)
        })
    }
}
