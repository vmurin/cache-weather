import { describe, expect, test } from 'claude-code/testing'

import {
  FIVE_MINUTES_MS,
  ONE_HOUR_MS,
  countdown,
  formatReset,
  hitPercent,
  msToNextMinute,
  readTranscriptTail,
  trimHint,
  weather,
  weeklyLimit,
} from '../hooks/logic'

describe('countdown', () => {
  test('green until the last quarter, yellow until the last tenth, then red', () => {
    expect(countdown(0, ONE_HOUR_MS, 0)).toEqual({ minutes: 60, level: 'fresh' })
    expect(countdown(0, ONE_HOUR_MS, 44 * 60_000).level).toBe('fresh')
    expect(countdown(0, ONE_HOUR_MS, 45 * 60_000).level).toBe('late')
    expect(countdown(0, ONE_HOUR_MS, 54 * 60_000).level).toBe('critical')
  })

  test('a partial last minute reads 1, zero and after read expired', () => {
    expect(countdown(0, FIVE_MINUTES_MS, FIVE_MINUTES_MS - 10_000).minutes).toBe(1)
    expect(countdown(0, FIVE_MINUTES_MS, FIVE_MINUTES_MS)).toEqual({ minutes: 0, level: 'expired' })
    expect(countdown(0, FIVE_MINUTES_MS, ONE_HOUR_MS).level).toBe('expired')
  })
})

test('the next redraw lands on the next whole minute since the response', () => {
  expect(msToNextMinute(1_000, 1_000)).toBe(60_000)
  expect(msToNextMinute(1_000, 21_000)).toBe(40_000)
})

test('hit rate is the cached share of all input tokens', () => {
  expect(hitPercent({ input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 90 })).toBe(90)
  expect(hitPercent({ input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })).toBe(null)
})

test('sunny up to half the threshold, rainy up to 80 % of it, stormy above', () => {
  expect(weather(null, 80)).toBe('sunny')
  expect(weather(40, 80)).toBe('sunny')
  expect(weather(41, 80)).toBe('rainy')
  expect(weather(64, 80)).toBe('rainy')
  expect(weather(65, 80)).toBe('stormy')
})

test('the hint loses the mode-cycling reminder and keeps the rest', () => {
  expect(trimHint('(shift+tab to cycle) · ← 1 agent')).toBe('← 1 agent')
  expect(trimHint('(shift+tab to cycle)')).toBe('')
  expect(trimHint('esc to interrupt · (shift+tab to cycle) · ← 2 agents')).toBe('esc to interrupt · ← 2 agents')
  expect(trimHint('← 1 agent')).toBe('← 1 agent')
})

test('the weekly limit is the seven-day window, rounded, with its reset moment', () => {
  expect(
    weeklyLimit([
      { kind: 'five_hour', percentUsed: 26, resetsAt: '2026-10-12T17:00:00Z' },
      { kind: 'seven_day', percentUsed: 65.6, resetsAt: '2026-10-16T08:00:00Z' },
    ]),
  ).toEqual({ percent: 66, resetsAt: Date.parse('2026-10-16T08:00:00Z') })
  expect(weeklyLimit([{ kind: 'seven_day', percentUsed: 3 }])).toEqual({ percent: 3, resetsAt: null })
  expect(weeklyLimit([])).toBe(null)
})

test('the reset moment reads day, month and local time, zero-padded', () => {
  expect(formatReset(new Date(2026, 9, 16, 8).getTime())).toBe('16.10. 08:00')
  expect(formatReset(new Date(2026, 0, 5, 23, 59).getTime())).toBe('05.01. 23:59')
})

describe('readTranscriptTail', () => {
  const row = (timestamp: string, m5: number, h1: number, extra = {}) =>
    JSON.stringify({
      type: 'assistant',
      timestamp,
      ...extra,
      message: {
        usage: {
          input_tokens: 10,
          cache_read_input_tokens: 80,
          cache_creation_input_tokens: m5 + h1,
          cache_creation: { ephemeral_5m_input_tokens: m5, ephemeral_1h_input_tokens: h1 },
        },
      },
    })

  test('the TTL of the newest cache write, and the newest response', () => {
    const tail = ['{"cut', row('2026-10-12T10:00:00Z', 50, 0), row('2026-10-12T10:05:00Z', 0, 10), row('2026-10-12T10:06:00Z', 0, 0)].join('\n')
    expect(readTranscriptTail(tail)).toEqual({
      ttlMs: ONE_HOUR_MS,
      lastResponse: { respondedAt: Date.parse('2026-10-12T10:06:00Z'), hitPercent: 89 },
    })
  })

  test('subagent responses do not count', () => {
    const tail = [row('2026-10-12T10:00:00Z', 5, 0), row('2026-10-12T10:09:00Z', 0, 5, { isSidechain: true })].join('\n')
    expect(readTranscriptTail(tail).ttlMs).toBe(FIVE_MINUTES_MS)
  })

  test('nothing when no response wrote to the cache', () => {
    expect(readTranscriptTail('')).toEqual({ ttlMs: null, lastResponse: null })
  })
})
