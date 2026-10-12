// Pure rules of the segment: no `$`, so the tests exercise them directly.

import type { CacheReading, WeeklyLimit } from '../types'

export const FIVE_MINUTES_MS = 5 * 60_000
export const ONE_HOUR_MS = 60 * 60_000
export const MINUTE_MS = 60_000

/** Used when the session does not report its auto-compact threshold. */
export const DEFAULT_THRESHOLD_PERCENT = 83

export type Usage = {
  input_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}

/** Share of the response's input the cache served, 0–100, or null for a response with no input. */
export function hitPercent(usage: Usage): number | null {
  const total = usage.input_tokens + usage.cache_read_input_tokens + usage.cache_creation_input_tokens
  return total === 0 ? null : Math.round((usage.cache_read_input_tokens / total) * 100)
}

export type CacheLevel = 'fresh' | 'late' | 'critical' | 'expired'

export type Countdown = {
  /** Whole minutes left, rounded up, so the last partial minute still reads 1. */
  minutes: number
  level: CacheLevel
}

/** Green while fresh, yellow in the last quarter, red in the last tenth, expired at zero. */
export function countdown(respondedAt: number, ttlMs: number, now: number): Countdown {
  const remainingMs = Math.max(0, ttlMs - (now - respondedAt))
  const fraction = remainingMs / ttlMs
  const level: CacheLevel =
    remainingMs === 0 ? 'expired' : fraction <= 0.1 ? 'critical' : fraction <= 0.25 ? 'late' : 'fresh'

  return { minutes: Math.ceil(remainingMs / MINUTE_MS), level }
}

/** Delay until the countdown's minute figure next changes, counted from the response. */
export function msToNextMinute(respondedAt: number, now: number): number {
  const elapsed = Math.max(0, now - respondedAt)
  return MINUTE_MS - (elapsed % MINUTE_MS)
}

export type Weather = 'sunny' | 'rainy' | 'stormy'

export const WEATHER_EMOJI: Record<Weather, string> = { sunny: '☀️', rainy: '🌧️', stormy: '⛈️' }

/** Sunny up to half the threshold, rainy up to 80 % of it, stormy above. */
export function weather(percent: number | null, thresholdPercent: number): Weather {
  const fill = percent ?? 0
  if (fill <= thresholdPercent / 2) return 'sunny'
  if (fill <= thresholdPercent * 0.8) return 'rainy'
  return 'stormy'
}

export function percentOf(part: number, whole: number): number {
  return Math.round((part / whole) * 100)
}

export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** The seven-day window among the session's rate limits, or null off a subscription. */
export function weeklyLimit(limits: readonly RateLimit[]): WeeklyLimit | null {
  const week = limits.find(limit => limit.kind === 'seven_day')
  if (week === undefined) return null
  const resetsAt = week.resetsAt === undefined ? NaN : Date.parse(week.resetsAt)
  return { percent: Math.round(week.percentUsed), resetsAt: Number.isNaN(resetsAt) ? null : resetsAt }
}

/** A reset moment in local time, day, month and hour: "16.10. 08:00". */
export function formatReset(ms: number): string {
  const date = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}. ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * The hourglass in front of the reset moment, asked for in its text presentation
 * (U+FE0E), so a terminal that honours it draws it in the line's grey rather than
 * as a colour emoji.
 */
export const RESET_ICON = '\u23F3\uFE0E'

/** The engine's reminder of the mode-cycling key; the mode pill beside it says enough. */
const CYCLE_HINT = /\(shift\+tab to cycle\)/g

/** The engine's hint text without the mode-cycling reminder, its `·` separators tidied. */
export function trimHint(hint: string): string {
  return hint
    .replace(CYCLE_HINT, '')
    .split('·')
    .map(part => part.trim())
    .filter(part => part !== '')
    .join(' · ')
}

export type TranscriptFacts = {
  /** The TTL of the newest cache write the transcript records, or null when none says. */
  ttlMs: number | null
  /** The newest main-loop response, or null when the tail holds none. */
  lastResponse: CacheReading | null
}

type TranscriptUsage = Usage & {
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number }
}

type TranscriptEntry = {
  type?: string
  isSidechain?: boolean
  timestamp?: string
  message?: { usage?: TranscriptUsage }
}

/**
 * Reads the tail of a session transcript (JSONL, newest last): the cache TTL
 * of the newest response that wrote to the cache, and the newest response.
 * The first line of a tail may be cut; unparsable lines are skipped.
 */
export function readTranscriptTail(tail: string): TranscriptFacts {
  let ttlMs: number | null = null
  let lastResponse: CacheReading | null = null
  const lines = tail.split('\n')

  for (let i = lines.length - 1; i >= 0 && (ttlMs === null || lastResponse === null); i--) {
    const entry = parseEntry(lines[i] ?? '')
    const usage = entry?.message?.usage
    if (entry?.type !== 'assistant' || entry.isSidechain === true || usage === undefined) continue

    if (lastResponse === null && entry.timestamp !== undefined) {
      const respondedAt = Date.parse(entry.timestamp)
      if (!Number.isNaN(respondedAt)) lastResponse = { respondedAt, hitPercent: hitPercent(usage) }
    }
    if (ttlMs === null) {
      if ((usage.cache_creation?.ephemeral_1h_input_tokens ?? 0) > 0) ttlMs = ONE_HOUR_MS
      else if ((usage.cache_creation?.ephemeral_5m_input_tokens ?? 0) > 0) ttlMs = FIVE_MINUTES_MS
    }
  }

  return { ttlMs, lastResponse }
}

function parseEntry(line: string): TranscriptEntry | undefined {
  if (!line.startsWith('{')) return undefined
  try {
    return JSON.parse(line) as TranscriptEntry
  } catch {
    return undefined
  }
}
