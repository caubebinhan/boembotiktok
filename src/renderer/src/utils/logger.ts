/**
 * Enhanced Logging Utility for Renderer Process
 * Redirects all console calls to the Main process persistent logger
 */

// @ts-ignore
const api = window.api

const formatArgs = (args: any[]) => {
    return args.map(arg => {
        if (typeof arg === 'object') {
            try {
                return JSON.stringify(arg, null, 2)
            } catch (e) {
                return '[Circular or Unserializable Object]'
            }
        }
        return String(arg)
    }).join(' ')
}

export const log = {
    info: (message: string, context: string = 'Renderer') => {
        console.info(`[${context}] ${message}`)
        api?.log('info', message, context)
    },
    warn: (message: string, context: string = 'Renderer') => {
        console.warn(`[${context}] ${message}`)
        api?.log('warn', message, context)
    },
    error: (error: any, context: string = 'Renderer') => {
        const message = error instanceof Error ? error.stack || error.message : String(error)
        console.error(`[${context}] ${message}`)
        api?.log('error', message, context)
    },
    debug: (message: string, context: string = 'Renderer') => {
        console.debug(`[${context}] ${message}`)
        api?.log('debug', message, context)
    }
}

// Global console redirection
export const initRendererLogger = () => {
    const originalLog = console.log.bind(console)
    const originalWarn = console.warn.bind(console)
    const originalError = console.error.bind(console)
    const originalDebug = console.debug.bind(console)

    console.log = (...args: any[]) => {
        const msg = formatArgs(args)
        api?.log('info', msg, 'Renderer:Console')
        originalLog(...args)
    }

    console.warn = (...args: any[]) => {
        const msg = formatArgs(args)
        api?.log('warn', msg, 'Renderer:Console')
        originalWarn(...args)
    }

    console.error = (...args: any[]) => {
        const msg = formatArgs(args)
        api?.log('error', msg, 'Renderer:Console')
        originalError(...args)
    }

    console.debug = (...args: any[]) => {
        const msg = formatArgs(args)
        api?.log('debug', msg, 'Renderer:Console')
        originalDebug(...args)
    }

    log.info('Renderer logger initialized and console redirected')
}
