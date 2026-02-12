import ffmpeg from 'fluent-ffmpeg'
// Use require to avoid type issues with library lacking definitions
const ffmpegPath = require('ffmpeg-static')
const ffprobePath = require('ffprobe-static')

class ProcessingService {
    constructor() {
        if (ffmpegPath) {
            ffmpeg.setFfmpegPath(ffmpegPath)
            console.log('FFmpeg path set:', ffmpegPath)
        } else {
            console.warn('ffmpeg-static not found, relying on system PATH')
        }

        if (ffprobePath && ffprobePath.path) {
            ffmpeg.setFfprobePath(ffprobePath.path)
            console.log('FFprobe path set:', ffprobePath.path)
        } else {
            console.warn('ffprobe-static not found, metadata extraction might fail')
        }
    }

    async getMetadata(filePath: string): Promise<ffmpeg.FfprobeData> {
        return new Promise((resolve, reject) => {
            ffmpeg.ffprobe(filePath, (err, metadata) => {
                if (err) return reject(err)
                resolve(metadata)
            })
        })
    }

    async addOverlay(inputPath: string, outputPath: string, text: string): Promise<void> {
        return new Promise((resolve, reject) => {
            ffmpeg(inputPath)
                .videoFilters([{
                    filter: 'drawtext',
                    options: {
                        text: text,
                        fontsize: 24,
                        fontcolor: 'white',
                        x: '(w-text_w)/2',
                        y: '(h-text_h)/2',
                        shadowcolor: 'black',
                        shadowx: 2,
                        shadowy: 2
                    }
                }])
                .on('end', () => resolve())
                .on('error', (err) => reject(err))
                .save(outputPath)
        })
    }

    async prependIntro(videoPath: string, imagePath: string, duration: number, outputPath: string): Promise<void> {
        return new Promise((resolve, reject) => {
            console.log(`Processing: Prepending intro image ${imagePath} to ${videoPath} for ${duration}s`)

            // Complex filter to:
            // 1. Loop image for 'duration' seconds
            // 2. Scale image to match video (assuming 1080x1920 for TikTok)
            // 3. Concat
            // Note: Audio handling is tricky. We'll generate silent audio for the image part or just ignore audio sync issues for MVP.
            // A safer MVP approach: Just generates a video from image first, then concat?

            // For MVP simplifiction: We will use a filter complex that assumes input video has audio.
            // We generate silent audio for the image.

            ffmpeg()
                .input(imagePath)
                .inputOption(`-loop 1`)
                .inputOption(`-t ${duration}`)
                .input(videoPath)
                .complexFilter([
                    // Scale image to intro [v0]
                    `[0:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v0]`,
                    // Scale video to main [v1]
                    `[1:v]scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2,setsar=1[v1]`,
                    // Generate silence for intro [a0]
                    `aevalsrc=0:d=${duration}[a0]`,
                    // Concat [v0][a0] + [v1][1:a]
                    `[v0][a0][v1][1:a]concat=n=2:v=1:a=1[outv][outa]`
                ])
                .outputOptions('-map [outv]')
                .outputOptions('-map [outa]')
                .outputOptions('-c:v libx264')
                .outputOptions('-pix_fmt yuv420p')
                .on('start', (cmd) => console.log('FFmpeg command:', cmd))
                .on('end', () => {
                    console.log('Processing finished');
                    resolve()
                })
                .on('error', (err) => {
                    console.error('Processing error:', err)
                    reject(err)
                })
                .save(outputPath)
        })
    }
}

export const processingService = new ProcessingService()
