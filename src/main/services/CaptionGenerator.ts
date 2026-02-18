import { format } from 'date-fns'

export class CaptionGenerator {
    static generate(template: string, variables: {
        original: string,
        time?: Date,
        author?: string,
        tags?: string[]
    }): string {
        console.log(`[CaptionGenerator] Input Template: "${template}"`)
        console.log(`[CaptionGenerator] Input Variables:`, JSON.stringify({ ...variables, original: variables.original?.substring(0, 50) + '...' }))

        let caption = template

        // Helper to strip tags - Robust Unicode version
        // Matches # followed by letters, numbers, or underscores (Unicode aware)
        const stripTags = (text: string) => {
            const stripped = text.replace(/#[\p{L}\p{N}_]+/gu, '').trim()
            console.log(`[CaptionGenerator] StripTags: "${text.substring(0, 30)}..." -> "${stripped.substring(0, 30)}..."`)
            return stripped
        }

        if (caption.includes('{original_no_tags}')) {
            console.log(`[CaptionGenerator] Replacing {original_no_tags}`)
            caption = caption.replace(/{original_no_tags}/g, stripTags(variables.original || ''))
        }

        // Replace {original}
        if (caption.includes('{original}')) {
            console.log(`[CaptionGenerator] Replacing {original}`)
            caption = caption.replace(/{original}/g, variables.original || '')
        }

        // Replace {time} (default to short format)
        if (caption.includes('{time}')) {
            const timeStr = variables.time ? format(variables.time, 'HH:mm') : ''
            caption = caption.replace(/{time}/g, timeStr)
        }

        // Replace {date}
        if (caption.includes('{date}')) {
            const dateStr = variables.time ? format(variables.time, 'yyyy-MM-dd') : ''
            caption = caption.replace(/{date}/g, dateStr)
        }

        // Replace {author}
        if (caption.includes('{author}')) {
            caption = caption.replace(/{author}/g, variables.author || '')
        }

        // Replace {tags} (append tags)
        if (caption.includes('{tags}')) {
            const tagsStr = variables.tags ? variables.tags.map(t => `#${t}`).join(' ') : ''
            caption = caption.replace(/{tags}/g, tagsStr)
        }

        const final = caption.trim()
        console.log(`[CaptionGenerator] Output: "${final}"`)
        return final
    }
}
