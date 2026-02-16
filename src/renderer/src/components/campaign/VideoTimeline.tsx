import React from 'react'
import { TimelineItem } from './TimelineItem'
import { determineVideoStatus } from '../../utils/campaignStateManager'

interface Props {
    videos: any[]
    jobs: any[]
    onAction: (action: string, id: number) => void
}

export const VideoTimeline: React.FC<Props> = ({ videos, jobs, onAction }) => {
    // Group jobs by video
    const videoMap = new Map<string, { downloadJob?: any, publishJob?: any }>()

    jobs.forEach(job => {
        let videoId = null
        try {
            const d = JSON.parse(job.data_json || '{}')
            videoId = d.platform_id || d.video_id || d.video?.id
        } catch { }

        if (videoId) {
            const current = videoMap.get(videoId) || {}
            if (job.type === 'DOWNLOAD') current.downloadJob = job
            // Use latest publish job
            if (job.type === 'PUBLISH') {
                if (!current.publishJob || job.id > current.publishJob.id) {
                    current.publishJob = job
                }
            }
            videoMap.set(videoId, current)
        }
    })

    // Sort videos: Active/Running first, then by date
    const sortedVideos = [...videos].sort((a, b) => {
        const stateA = videoMap.get(a.id)
        const stateB = videoMap.get(b.id)
        // Todo: better sorting logic
        return 0
    })

    return (
        <div style={{ padding: '0 32px 32px 80px' }}>
            <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--text-muted)', marginBottom: '24px', letterSpacing: '0.5px' }}>
                🕐 VIDEO TIMELINE
            </div>

            {sortedVideos.length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '40px' }}>
                    No videos in timeline.
                </div>
            ) : (
                sortedVideos.map(video => {
                    const jobState = videoMap.get(video.id)
                    const status = determineVideoStatus(video, jobState?.downloadJob, jobState?.publishJob)

                    return (
                        <TimelineItem
                            key={video.id}
                            video={video}
                            status={status}
                            downloadJob={jobState?.downloadJob}
                            publishJob={jobState?.publishJob}
                            onAction={onAction}
                        />
                    )
                })
            )}
        </div>
    )
}
