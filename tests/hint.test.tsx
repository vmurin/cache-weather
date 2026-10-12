import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const SURFACES = ['terminal', 'desktop'] as const
const USAGE = { input_tokens: 10, cache_read_input_tokens: 900, cache_creation_input_tokens: 90, output_tokens: 5, model: 'm' }

const WEEK_RESET = new Date(2026, 9, 16, 8).getTime()

function answerUsage(on: On, fill: { tokens?: number; window: number; threshold?: number; weekPercent?: number }) {
  on('session.usage', (_$, e) => ({
    value: {
      startedAt: 0,
      rateLimits:
        fill.weekPercent === undefined
          ? []
          : [{ kind: 'seven_day', percentUsed: fill.weekPercent, resetsAt: new Date(WEEK_RESET).toISOString() }],
      context: {
        tokens: fill.tokens,
        window: fill.window,
        breakdown:
          e.breakdown === undefined || fill.threshold === undefined
            ? undefined
            : ({ autoCompactThreshold: fill.threshold, isAutoCompactEnabled: true } as never),
      },
    },
  }))
}

async function startSession($: Engine, on: On) {
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
}

/** Answers every model request beneath the plugin with USAGE; registered before the test's first call on `$`. */
function answerSteps(on: On) {
  on('turn.step', async function* (_$, e) {
    return { turnId: e.turnId, index: e.index, answer: 'ok', toolUses: [], stopReason: 'end_turn' as const, usage: USAGE }
  })
}

async function respond($: Engine) {
  for await (const _chunk of $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1 })) {
    // drained
  }
}

function mount($: Engine, surface: (typeof SURFACES)[number], hint = '(shift+tab to cycle) · ← 1 agent') {
  return $.ui.mount({
    plugin: 'cache-weather',
    surface,
    component: 'PromptHint',
    props: { isDraft: false, isWorking: false, hint },
  })
}

async function line(ui: Awaited<ReturnType<typeof mount>>) {
  return (await ui.findAll({ type: 'Text' })).map(t => t.text).join('')
}

for (const surface of SURFACES) {
  test(`${surface}: keeps the engine's hint, less the mode-cycling reminder, and adds the segment after it`, async ($, on) => {
    const clock = mock.clock(on, { now: 0 })
    answerUsage(on, { tokens: 290_000, window: 1_000_000, threshold: 967_000, weekPercent: 66 })
    answerSteps(on)
    await startSession($, on)
    await respond($)
    const ui = await mount($, surface)

    expect(await line(ui)).toBe('← 1 agent · ☀️ 5 min · hit 90% · ctx 29% · 7d 66% · \u23F3\uFE0E 16.10. 08:00')
    expect((await ui.find({ type: 'Text', text: '5 min' }))?.props.color).toBe('success')

    await clock.advance(4 * 60_000)
    expect((await ui.find({ type: 'Text', text: '1 min' }))?.props.color).toBe('warning')

    await clock.advance(60_000)
    expect((await ui.find({ type: 'Text', text: 'abgelaufen' }))?.props.color).toBe('inactive')
  })
}

test('a hint of only the mode-cycling reminder leaves the segment alone', async ($, on) => {
  mock.clock(on)
  const ui = await mount($, 'terminal', '(shift+tab to cycle)')
  expect(await line(ui)).toBe('☀️ – · hit – · ctx –')
})

test('an empty hint (while typing) leaves the segment alone', async ($, on) => {
  mock.clock(on)
  const ui = await mount($, 'terminal', '')
  expect(await line(ui)).toBe('☀️ – · hit – · ctx –')
})

test('the weather follows the session threshold', async ($, on) => {
  mock.clock(on)
  answerUsage(on, { tokens: 140_000, window: 200_000, threshold: 167_000 })
  await startSession($, on)
  const ui = await mount($, 'terminal')
  expect(await line(ui)).toContain('⛈️ – · hit – · ctx 70%')
})

test('without a session threshold it falls back to 83 %', async ($, on) => {
  mock.clock(on)
  answerUsage(on, { tokens: 60_000, window: 100_000 })
  await startSession($, on)
  const ui = await mount($, 'terminal')
  expect(await line(ui)).toContain('🌧️ – · hit – · ctx 60%')
})

test('the TTL comes from the transcript once the turn has settled on disk', async ($, on) => {
  const clock = mock.clock(on, { now: 0 })
  on('process.run', () => {
    const row = {
      type: 'assistant',
      timestamp: new Date(0).toISOString(),
      message: {
        usage: {
          input_tokens: 1,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 9,
          cache_creation: { ephemeral_5m_input_tokens: 0, ephemeral_1h_input_tokens: 9 },
        },
      },
    }
    return { value: { exitCode: 0, stdout: JSON.stringify(row), stderr: '', isStdoutTruncated: false, isStderrTruncated: false } }
  })
  on('classic.Stop', () => ({}))
  answerSteps(on)
  await respond($)
  const ui = await mount($, 'terminal')
  expect(await ui.find({ type: 'Text', text: '5 min' })).not.toBe(undefined)

  await $.classic.Stop({ stop_hook_active: false, transcript_path: '/t.jsonl' } as never)
  await clock.advance(2000)

  expect(await ui.find({ type: 'Text', text: '60 min' })).not.toBe(undefined)
})
