/** The last main-loop API response: when it arrived and how much of its input the cache served. */
export type CacheReading = { respondedAt: number; hitPercent: number | null }

/** The prompt-cache lifetime the session writes with, and whether the transcript showed it. */
export type CacheTtl = { ms: number; isMeasured: boolean }

/** The context window's fill and the auto-compact threshold, both as percent of the window. */
export type ContextReading = { percent: number | null; thresholdPercent: number }

/** The seven-day rate-limit window: how much of it is used, and when it resets (epoch ms). */
export type WeeklyLimit = { percent: number; resetsAt: number | null }

declare module 'claude-code' {
  interface PluginState {
    'cache-weather': {
      lastResponse: CacheReading | null
      ttl: CacheTtl
      context: ContextReading
      weekly: WeeklyLimit | null
      tick: number
    }
  }
}
