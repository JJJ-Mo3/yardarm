/**
 * Tests for the SDK-event → UI-event translator: message streaming, the tool
 * lifecycle (including approvals/suspensions and re-homed tool calls), and
 * session-meta plumbing.
 */
import { describe, expect, it } from 'vitest'
import { EventTranslator } from './event-translator'
import type { AgentControllerEventLike } from '../../../shared/ipc-types'
import type { AgentUIEvent, StoredMessage } from '../../../shared/ui-message'

interface Harness {
  t: EventTranslator
  emitted: AgentUIEvent[]
  persisted: Array<{ message: StoredMessage; final: boolean }>
  metaChanges: Array<Record<string, unknown>>
  threads: string[]
  runStates: boolean[]
}

function makeTranslator(onAgentError?: (text: string) => boolean): Harness {
  const h: Omit<Harness, 't'> = {
    emitted: [],
    persisted: [],
    metaChanges: [],
    threads: [],
    runStates: []
  }
  const t = new EventTranslator({
    // Clone: the translator mutates StoredMessage objects in place.
    emit: (ev) => h.emitted.push(structuredClone(ev)),
    persistMessage: (m, final) =>
      h.persisted.push({ message: structuredClone(m), final: final ?? false }),
    onThreadChanged: (id) => h.threads.push(id),
    onMetaChanged: (m) => h.metaChanges.push(m),
    onRunStateChanged: (r) => h.runStates.push(r),
    onAgentError
  })
  return { t, ...h }
}

/** Assistant message event with the given content parts (sdk v2 shape). */
function msgEvent(
  type: 'message_start' | 'message_update' | 'message_end',
  id: string,
  parts: Array<Record<string, unknown>>,
  createdAt?: unknown
): AgentControllerEventLike {
  return { type, message: { id, role: 'assistant', content: { format: 2, parts }, createdAt } }
}

/** sdk v2 tool-invocation content part. */
function invocation(inv: Record<string, unknown>): Record<string, unknown> {
  return { type: 'tool-invocation', toolInvocation: inv }
}

function lastUpsert(emitted: AgentUIEvent[], id: string): StoredMessage | undefined {
  for (let i = emitted.length - 1; i >= 0; i--) {
    const ev = emitted[i]
    if (ev.type === 'message-upsert' && ev.message.id === id) return ev.message
  }
  return undefined
}

describe('run lifecycle', () => {
  it('tracks running state and emits run-started/run-finished', () => {
    const h = makeTranslator()
    h.t.handle({ type: 'agent_start' })
    expect(h.t.running).toBe(true)
    h.t.handle({ type: 'agent_end', reason: 'completed' })
    expect(h.t.running).toBe(false)
    expect(h.runStates).toEqual([true, false])
    expect(h.emitted.map((e) => e.type)).toEqual(['run-started', 'run-finished'])
    const finished = h.emitted[1]
    expect(finished.type === 'run-finished' && finished.reason).toBe('completed')
  })

  it('agent_end clears pending approvals but leaves suspensions intact', () => {
    const h = makeTranslator()
    h.t.handle({ type: 'agent_start' })
    h.t.handle({ type: 'tool_approval_required', toolCallId: 't1', toolName: 'shell', args: {} })
    h.t.handle({
      type: 'tool_suspended',
      toolCallId: 't2',
      toolName: 'ask_user',
      args: {},
      suspendPayload: { question: 'Which?' }
    })
    expect(h.t.pendingApprovals.size).toBe(1)
    expect(h.t.pendingSuspensions.size).toBe(1)
    h.t.handle({ type: 'agent_end' })
    expect(h.t.pendingApprovals.size).toBe(0)
    // Suspensions survive run end so the answer card stays actionable.
    expect(h.t.pendingSuspensions.size).toBe(1)
    const resolved = h.emitted.filter((e) => e.type === 'approval-resolved')
    expect(resolved).toHaveLength(1)
    expect(resolved[0].type === 'approval-resolved' && resolved[0].toolCallId).toBe('t1')
    expect(h.emitted.some((e) => e.type === 'suspension-resolved')).toBe(false)
  })
})

describe('message streaming', () => {
  it('upserts through start/update and persists only on message_end', () => {
    const h = makeTranslator()
    h.t.handle(msgEvent('message_start', 'm1', [{ type: 'text', text: 'He' }]))
    h.t.handle(msgEvent('message_update', 'm1', [{ type: 'text', text: 'Hello' }]))
    expect(h.persisted).toHaveLength(0)
    h.t.handle(msgEvent('message_end', 'm1', [{ type: 'text', text: 'Hello!' }]))
    expect(h.persisted).toHaveLength(1)
    expect(h.persisted[0].final).toBe(true)
    expect(h.persisted[0].message.parts).toEqual([{ type: 'text', text: 'Hello!' }])
    const upserts = h.emitted.filter((e) => e.type === 'message-upsert')
    expect(upserts).toHaveLength(3)
    expect(lastUpsert(h.emitted, 'm1')?.parts).toEqual([{ type: 'text', text: 'Hello!' }])
  })

  it('renders reasoning parts and skips empty/unknown items', () => {
    const h = makeTranslator()
    h.t.handle(
      msgEvent('message_end', 'm1', [
        { type: 'reasoning', reasoning: 'hmm' },
        { type: 'text', text: '' },
        { type: 'step-start' },
        { type: 'text', text: 'done' }
      ])
    )
    expect(lastUpsert(h.emitted, 'm1')?.parts).toEqual([
      { type: 'reasoning', text: 'hmm' },
      { type: 'text', text: 'done' }
    ])
  })

  it('ignores non-assistant messages', () => {
    const h = makeTranslator()
    h.t.handle({
      type: 'message_end',
      message: {
        id: 'u1',
        role: 'user',
        content: { format: 2, parts: [{ type: 'text', text: 'hi' }] }
      }
    })
    expect(h.emitted).toHaveLength(0)
    expect(h.persisted).toHaveLength(0)
  })

  it('handles createdAt as number, ISO string, and invalid string', () => {
    const h = makeTranslator()
    h.t.handle(msgEvent('message_end', 'm1', [{ type: 'text', text: 'a' }], 1234))
    expect(lastUpsert(h.emitted, 'm1')?.createdAt).toBe(1234)
    h.t.handle(
      msgEvent('message_end', 'm2', [{ type: 'text', text: 'b' }], '2026-01-02T03:04:05.000Z')
    )
    expect(lastUpsert(h.emitted, 'm2')?.createdAt).toBe(Date.parse('2026-01-02T03:04:05.000Z'))
    const before = Date.now()
    h.t.handle(msgEvent('message_end', 'm3', [{ type: 'text', text: 'c' }], 'not-a-date'))
    expect(lastUpsert(h.emitted, 'm3')?.createdAt).toBeGreaterThanOrEqual(before)
  })
})

describe('tool lifecycle', () => {
  it('streams args, accumulates shell output, and finalizes on tool_end', () => {
    const h = makeTranslator()
    h.t.handle(msgEvent('message_start', 'm1', []))
    h.t.handle({ type: 'tool_input_start', toolCallId: 't1', toolName: 'shell' })
    h.t.handle({ type: 'tool_input_delta', toolCallId: 't1', argsTextDelta: '{"cmd":' })
    h.t.handle({ type: 'tool_input_delta', toolCallId: 't1', argsTextDelta: '"ls"}' })
    h.t.handle({ type: 'tool_start', toolCallId: 't1', toolName: 'shell', args: { cmd: 'ls' } })
    h.t.handle({ type: 'shell_output', toolCallId: 't1', output: 'a.txt\n' })
    h.t.handle({ type: 'shell_output', toolCallId: 't1', output: 'b.txt\n' })
    h.t.handle({ type: 'tool_end', toolCallId: 't1', result: 'ok', isError: false })

    const msg = lastUpsert(h.emitted, 'm1')
    expect(msg?.parts).toHaveLength(1)
    const part = msg?.parts[0]
    expect(part).toMatchObject({
      type: 'tool-call',
      toolCallId: 't1',
      toolName: 'shell',
      args: { cmd: 'ls' },
      outputText: 'a.txt\nb.txt\n',
      result: 'ok',
      status: 'success'
    })
    // tool_end persists the owning message (not final — message_end does that).
    expect(h.persisted).toHaveLength(1)
    expect(h.persisted[0].final).toBe(false)
  })

  it('tolerates partial JSON while args stream', () => {
    const h = makeTranslator()
    h.t.handle(msgEvent('message_start', 'm1', []))
    h.t.handle({ type: 'tool_input_start', toolCallId: 't1', toolName: 'shell' })
    h.t.handle({ type: 'tool_input_delta', toolCallId: 't1', argsTextDelta: '{"cm' })
    let part = lastUpsert(h.emitted, 'm1')?.parts[0]
    expect(part?.type === 'tool-call' && part.args).toBeUndefined()
    h.t.handle({ type: 'tool_input_delta', toolCallId: 't1', argsTextDelta: 'd":"ls"}' })
    part = lastUpsert(h.emitted, 'm1')?.parts[0]
    expect(part?.type === 'tool-call' && part.args).toEqual({ cmd: 'ls' })
  })

  it('marks failed tools as error', () => {
    const h = makeTranslator()
    h.t.handle(msgEvent('message_start', 'm1', []))
    h.t.handle({ type: 'tool_start', toolCallId: 't1', toolName: 'shell', args: {} })
    h.t.handle({ type: 'tool_end', toolCallId: 't1', result: 'boom', isError: true })
    const part = lastUpsert(h.emitted, 'm1')?.parts[0]
    expect(part?.type === 'tool-call' && part.status).toBe('error')
  })

  it('a result invocation never downgrades an error status', () => {
    const h = makeTranslator()
    h.t.handle(
      msgEvent('message_start', 'm1', [
        invocation({ toolCallId: 't1', toolName: 'shell', state: 'call' })
      ])
    )
    h.t.handle({ type: 'tool_end', toolCallId: 't1', result: 'boom', isError: true })
    h.t.handle(
      msgEvent('message_end', 'm1', [
        invocation({ toolCallId: 't1', toolName: 'shell', state: 'result', result: 'late ok' })
      ])
    )
    const part = lastUpsert(h.emitted, 'm1')?.parts[0]
    expect(part?.type === 'tool-call' && part.status).toBe('error')
    expect(part?.type === 'tool-call' && part.result).toBe('late ok')
  })

  it('marks output-error invocations as failed with their errorText', () => {
    const h = makeTranslator()
    h.t.handle(
      msgEvent('message_end', 'm1', [
        invocation({ toolCallId: 't1', toolName: 'shell', state: 'output-error', errorText: 'no' })
      ])
    )
    const part = lastUpsert(h.emitted, 'm1')?.parts[0]
    expect(part?.type === 'tool-call' && part.status).toBe('error')
    expect(part?.type === 'tool-call' && part.result).toBe('no')
  })

  it('re-homes a tool part when mastracode places the call in another message', () => {
    const h = makeTranslator()
    h.t.handle(msgEvent('message_start', 'm1', []))
    h.t.handle({ type: 'tool_start', toolCallId: 't1', toolName: 'shell', args: {} })
    expect(lastUpsert(h.emitted, 'm1')?.parts).toHaveLength(1)
    // The SDK homes the call in m2 — the stale copy in m1 must disappear.
    h.t.handle(
      msgEvent('message_update', 'm2', [
        invocation({ toolCallId: 't1', toolName: 'shell', state: 'call' })
      ])
    )
    expect(lastUpsert(h.emitted, 'm1')?.parts).toHaveLength(0)
    const m2 = lastUpsert(h.emitted, 'm2')
    expect(m2?.parts).toHaveLength(1)
    expect(m2?.parts[0]).toMatchObject({ type: 'tool-call', toolCallId: 't1' })
  })
})

describe('approvals and suspensions', () => {
  it('tracks an approval through request and tool_end resolution', () => {
    const h = makeTranslator()
    h.t.handle(msgEvent('message_start', 'm1', []))
    h.t.handle({
      type: 'tool_approval_required',
      toolCallId: 't1',
      toolName: 'shell',
      args: { cmd: 'rm x' }
    })
    const req = h.emitted.find((e) => e.type === 'approval-request')
    expect(req?.type === 'approval-request' && req.approval).toMatchObject({
      toolCallId: 't1',
      toolName: 'shell'
    })
    let part = lastUpsert(h.emitted, 'm1')?.parts[0]
    expect(part?.type === 'tool-call' && part.status).toBe('awaiting-approval')
    h.t.handle({ type: 'tool_end', toolCallId: 't1', result: 'ok', isError: false })
    expect(h.t.pendingApprovals.size).toBe(0)
    expect(h.emitted.some((e) => e.type === 'approval-resolved')).toBe(true)
    part = lastUpsert(h.emitted, 'm1')?.parts[0]
    expect(part?.type === 'tool-call' && part.status).toBe('success')
  })

  it('tracks a suspension through request and tool_end resolution', () => {
    const h = makeTranslator()
    h.t.handle(msgEvent('message_start', 'm1', []))
    h.t.handle({
      type: 'tool_suspended',
      toolCallId: 't1',
      toolName: 'ask_user',
      args: {},
      suspendPayload: { question: 'Pick one' },
      resumeSchema: '{"type":"string"}'
    })
    const req = h.emitted.find((e) => e.type === 'suspension-request')
    expect(req?.type === 'suspension-request' && req.suspension).toMatchObject({
      toolCallId: 't1',
      toolName: 'ask_user',
      suspendPayload: { question: 'Pick one' }
    })
    h.t.handle({ type: 'tool_end', toolCallId: 't1', result: 'User answered: A', isError: false })
    expect(h.t.pendingSuspensions.size).toBe(0)
    expect(h.emitted.some((e) => e.type === 'suspension-resolved')).toBe(true)
  })
})

describe('session meta and misc events', () => {
  it('forwards mode/model changes to meta + session-meta', () => {
    const h = makeTranslator()
    h.t.handle({ type: 'mode_changed', modeId: 'plan' })
    h.t.handle({ type: 'model_changed', modelId: 'openai/gpt-x' })
    expect(h.metaChanges).toEqual([{ mode: 'plan' }, { modelId: 'openai/gpt-x' }])
    const metas = h.emitted.filter((e) => e.type === 'session-meta')
    expect(metas.map((e) => e.type === 'session-meta' && e.meta)).toEqual([
      { mode: 'plan' },
      { modelId: 'openai/gpt-x' }
    ])
  })

  it('emits task lists from task_updated and state_changed', () => {
    const h = makeTranslator()
    h.t.handle({ type: 'task_updated', tasks: [{ id: '1', content: 'do it' }] })
    expect(h.t.tasks).toEqual([{ id: '1', content: 'do it' }])
    h.t.handle({
      type: 'state_changed',
      state: { yolo: true, thinkingLevel: 'high', tasks: [{ id: '2' }] }
    })
    expect(h.t.tasks).toEqual([{ id: '2' }])
    expect(h.metaChanges.at(-1)).toEqual({ yolo: true, thinkingLevel: 'high' })
    expect(h.emitted.filter((e) => e.type === 'task-list')).toHaveLength(2)
  })

  it('forwards thread ids from thread_created and thread_changed', () => {
    const h = makeTranslator()
    h.t.handle({ type: 'thread_created', thread: { id: 'th1' } })
    h.t.handle({ type: 'thread_changed', threadId: 'th2' })
    expect(h.threads).toEqual(['th1', 'th2'])
  })

  it('surfaces errors as info events, with the max-output hint appended', () => {
    const h = makeTranslator()
    h.t.handle({ type: 'error', error: { message: 'plain failure' } })
    h.t.handle({
      type: 'error',
      error: { message: 'The model stopped because it reached its maximum output length.' }
    })
    const infos = h.emitted.filter((e) => e.type === 'info')
    expect(infos[0].type === 'info' && infos[0].text).toBe('plain failure')
    expect(infos[0].type === 'info' && infos[0].level).toBe('error')
    expect(infos[1].type === 'info' && infos[1].text).toContain('context')
  })

  it('replaces the raw error with an info line when onAgentError says it will recover', () => {
    const seen: string[] = []
    const h = makeTranslator((text) => {
      seen.push(text)
      return true
    })
    h.t.handle({
      type: 'error',
      error: { message: 'This model does not support assistant message prefill.' }
    })
    expect(seen).toEqual(['This model does not support assistant message prefill.'])
    const infos = h.emitted.filter((e) => e.type === 'info')
    expect(infos).toHaveLength(1)
    expect(infos[0].type === 'info' && infos[0].level).toBe('info')
    expect(infos[0].type === 'info' && infos[0].text).toContain('continuing automatically')
    expect(infos[0].type === 'info' && infos[0].text).not.toContain('prefill.')
  })

  it('emits the original error when onAgentError declines to recover', () => {
    const h = makeTranslator(() => false)
    h.t.handle({ type: 'error', error: { message: 'rate limit exceeded' } })
    const infos = h.emitted.filter((e) => e.type === 'info')
    expect(infos[0].type === 'info' && infos[0].level).toBe('error')
    expect(infos[0].type === 'info' && infos[0].text).toBe('rate limit exceeded')
  })

  it('appends the manual prefill remedy when no recovery hook is wired', () => {
    const h = makeTranslator()
    h.t.handle({
      type: 'error',
      error: {
        message:
          'This model does not support assistant message prefill. The conversation must ' +
          'end with a user message.'
      }
    })
    const infos = h.emitted.filter((e) => e.type === 'info')
    expect(infos[0].type === 'info' && infos[0].level).toBe('error')
    expect(infos[0].type === 'info' && infos[0].text).toContain('Send any message')
  })

  it('routes om_* to om-progress, subagent deltas into the owning tool, unknowns to raw', () => {
    const h = makeTranslator()
    h.t.handle({ type: 'om_observation', note: 'x' })
    const om = h.emitted.find((e) => e.type === 'om-progress')
    expect(om?.type === 'om-progress' && om.om.kind).toBe('observation')

    h.t.handle(msgEvent('message_start', 'm1', []))
    h.t.handle({ type: 'tool_start', toolCallId: 't1', toolName: 'task', args: {} })
    h.t.handle({ type: 'subagent_text_delta', toolCallId: 't1', textDelta: 'sub says hi' })
    const part = lastUpsert(h.emitted, 'm1')?.parts[0]
    expect(part?.type === 'tool-call' && part.outputText).toBe('sub says hi')

    h.t.handle({ type: 'mystery_future_event', payload: 1 })
    expect(h.emitted.some((e) => e.type === 'raw')).toBe(true)
  })
})
