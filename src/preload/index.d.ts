declare global {
    interface Window {
        api: {
            invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
            on: (channel: string, callback: (...args: unknown[]) => void) => () => void
        }
    }
}

export { }
