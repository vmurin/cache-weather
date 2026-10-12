// Appends "☀️ 46 min · hit 90% · ctx 29% · 7d 66% · ⏳ 16.10. 08:00" to the hint line under the prompt.
// The engine keeps drawing its own mode pill ("⏵⏵ auto mode on") in front of this tree.

import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { CacheReading, CacheTtl } from '../types'
import {
  DEFAULT_THRESHOLD_PERCENT,
  FIVE_MINUTES_MS,
  WEATHER_EMOJI,
  countdown,
  hitPercent,
  msToNextMinute,
  percentOf,
  readTranscriptTail,
  RESET_ICON,
  formatReset,
  trimHint,
  weather,
  weeklyLimit,
} from './logic'
import type { CacheLevel } from './logic'

/** Enough transcript to reach the newest responses even after long tool output. */
const TRANSCRIPT_TAIL_BYTES = '2000000'
/** The transcript's rows of a turn land on disk shortly after its Stop hooks run. */
const TRANSCRIPT_SETTLE_MS = 2000

const lastResponse = atom({ plugin: 'cache-weather', key: 'lastResponse' } as const, null)
const ttl = atom({ plugin: 'cache-weather', key: 'ttl' } as const, { ms: FIVE_MINUTES_MS, isMeasured: false })
const context = atom({ plugin: 'cache-weather', key: 'context' } as const, {
  percent: null,
  thresholdPercent: DEFAULT_THRESHOLD_PERCENT,
})
const weekly = atom({ plugin: 'cache-weather', key: 'weekly' } as const, null)
/** Bumped each time the minute figure changes, so the line redraws; its value means nothing. */
const tick = atom({ plugin: 'cache-weather', key: 'tick' } as const, 0)

/** The theme keys the engine draws the hint line and its pills with. */
const HINT_COLOR = 'inactive'
const LEVEL_COLOR: Record<CacheLevel, 'success' | 'warning' | 'error' | 'inactive'> = {
  fresh: 'success',
  late: 'warning',
  critical: 'error',
  expired: 'inactive',
}

// The module's own: a reload starts it over, and session.start re-arms it.
let tickTimer: Timer | undefined

/** Redraws the line each time the countdown's minute figure changes, until the cache has expired. */
async function scheduleTicks($: EngineInterface) {
  tickTimer?.cancel()
  tickTimer = undefined
  const response = await read($, lastResponse)
  if (response === null) return

  const now = await $.clock.now()
  const { ms } = await read($, ttl)
  if (countdown(response.respondedAt, ms, now).level === 'expired') return

  tickTimer = $.clock.after(msToNextMinute(response.respondedAt, now), () => {
    void update($, tick, n => n + 1).then(() => scheduleTicks($))
  })
}

async function setResponse($: EngineInterface, reading: CacheReading | null) {
  await update($, lastResponse, () => reading)
  await scheduleTicks($)
}

/**
 * Context fill from the status line's figures; the threshold from the session's breakdown when it has one.
 * Until the live window's first response (right after a compaction) the session reports no fill, so the
 * figure the compaction left stands.
 */
async function refreshContext($: EngineInterface, options: { withThreshold: boolean }) {
  const usage = await $.session.usage(options.withThreshold ? { breakdown: 'summary' } : undefined)
  const { tokens, window } = usage.context
  const threshold = usage.context.breakdown?.autoCompactThreshold
  const week = weeklyLimit(usage.rateLimits)
  await update($, weekly, () => week)

  await update($, context, previous => {
    const percent = tokens === undefined ? previous.percent : percentOf(tokens, window)
    if (!options.withThreshold) return { ...previous, percent }
    return { percent, thresholdPercent: threshold === undefined ? DEFAULT_THRESHOLD_PERCENT : percentOf(threshold, window) }
  })
}

/** What the transcript says that the live events do not: the cache TTL, and on resume the last response. */
async function syncFromTranscript($: EngineInterface, path: string, options: { seedResponse: boolean }) {
  if (path === '') return
  const tail = await $.process.run(['tail', '-c', TRANSCRIPT_TAIL_BYTES, path]).catch(() => undefined)
  if (tail === undefined || tail.exitCode !== 0) return

  const facts = readTranscriptTail(tail.stdout)
  if (facts.ttlMs !== null) {
    const measured: CacheTtl = { ms: facts.ttlMs, isMeasured: true }
    await update($, ttl, () => measured)
  }
  if (options.seedResponse && facts.lastResponse !== null && (await read($, lastResponse)) === null) {
    await setResponse($, facts.lastResponse)
  } else {
    await scheduleTicks($)
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    await refreshContext($, { withThreshold: true })
    await scheduleTicks($)
    return started
  })

  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') {
      await setResponse($, null)
      await update($, context, previous => ({ ...previous, percent: null }))
    }
    const result = await next(e)
    await syncFromTranscript($, e.transcript_path, { seedResponse: e.source === 'resume' || e.source === 'startup' })
    return result
  })

  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    $.clock.after(TRANSCRIPT_SETTLE_MS, () => {
      void syncFromTranscript($, e.transcript_path, { seedResponse: false })
    })
    return result
  })

  // Another model may have another window, and with it another threshold.
  on('classic.PostModelSwitch', async ($, e, next) => {
    const result = await next(e)
    await refreshContext($, { withThreshold: true })
    return result
  })

  // Each main-loop response refreshes the cache: the countdown restarts and the hit rate is this response's.
  on('turn.step', async function* ($, e, next) {
    const response = yield* next(e)
    if (e.agentId === undefined && response.usage !== null) {
      await setResponse($, { respondedAt: await $.clock.now(), hitPercent: hitPercent(response.usage) })
      await refreshContext($, { withThreshold: false })
    }
    return response
  })

  on('session.measure', async ($, e, next) => {
    if (e.changed.includes('rateLimits')) {
      const week = weeklyLimit(e.rateLimits)
      await update($, weekly, () => week)
    }
    if (e.changed.includes('context')) await refreshContext($, { withThreshold: false })
    return next(e)
  })

  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined || result.messages === undefined) return result

    // The compacted conversation is a new prefix: nothing of it is cached until the next response.
    await setResponse($, null)
    const after = result.tokensAfter
    const usage = await $.session.usage().catch(() => undefined)
    if (after !== undefined && usage !== undefined) {
      await update($, context, previous => ({ ...previous, percent: percentOf(after, usage.context.window) }))
    }
    return result
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    await read($, tick)
    const [response, cacheTtl, ctx, week] = await Promise.all([
      read($, lastResponse),
      read($, ttl),
      read($, context),
      read($, weekly),
    ])
    const now = await $.clock.now()
    const { Box, Text } = $.ui.resolve(e)

    const timer = response === null ? null : countdown(response.respondedAt, cacheTtl.ms, now)
    const minutesText = timer === null ? '–' : timer.level === 'expired' ? 'expired' : `${timer.minutes} min`
    const hitText = response?.hitPercent == null ? '–' : `${response.hitPercent}%`
    const ctxText = ctx.percent === null ? '–' : `${ctx.percent}%`
    const hint = trimHint(e.props.hint)

    return (
      <Box flexDirection="row">
        {hint === '' ? null : <Text color={HINT_COLOR}>{hint} · </Text>}
        <Text>{WEATHER_EMOJI[weather(ctx.percent, ctx.thresholdPercent)]} </Text>
        <Text color={timer === null ? HINT_COLOR : LEVEL_COLOR[timer.level]}>{minutesText}</Text>
        <Text color={HINT_COLOR}>
          {' '}
          · hit {hitText} · ctx {ctxText}
          {week === null ? '' : ` · 7d ${week.percent}%`}
          {week?.resetsAt == null ? '' : ` · ${RESET_ICON} ${formatReset(week.resetsAt)}`}
        </Text>
      </Box>
    )
  })
}
