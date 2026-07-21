/**
 * Tests for the approval run-budget patch: the shared run options (maxSteps
 * etc.) must be injected into every `agent.sendToolApproval` call, explicit
 * caller options must win, and the per-agent patch must be idempotent while
 * still covering freshly rebuilt agent instances.
 */
import { describe, expect, it } from 'vitest'
import { patchApprovalRunBudget } from './approval-run-budget'

interface FakeAgent {
  sendToolApproval: (options: Record<string, unknown>) => Promise<unknown>
}

interface Fixture {
  session: Parameters<typeof patchApprovalRunBudget>[0]
  calls: Record<string, unknown>[]
  /** How many times buildSharedRunOptions ran — one per (single-)wrapped call. */
  sharedCalls: () => number
}

function makeFixture(agents: FakeAgent[]): Fixture {
  const calls: Record<string, unknown>[] = []
  let shared = 0
  let index = 0
  const session = {
    machinery: {
      getAgent: (): object => agents[Math.min(index++, agents.length - 1)],
      buildSharedRunOptions: (): Record<string, unknown> => {
        shared++
        return { maxSteps: 1000, savePerStep: false, requireToolApproval: true }
      }
    }
  }
  for (const agent of agents) {
    agent.sendToolApproval = async (options) => {
      calls.push(options)
      return undefined
    }
  }
  return { session, calls, sharedCalls: () => shared }
}

function makeAgent(): FakeAgent {
  return { sendToolApproval: async () => undefined }
}

describe('patchApprovalRunBudget', () => {
  it('injects the shared run budget into sendToolApproval', async () => {
    const { session, calls } = makeFixture([makeAgent()])
    patchApprovalRunBudget(session)
    const agent = session.machinery.getAgent() as FakeAgent
    await agent.sendToolApproval({ toolCallId: 'tc1', approved: true })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toMatchObject({
      maxSteps: 1000,
      savePerStep: false,
      toolCallId: 'tc1',
      approved: true
    })
  })

  it('lets explicit caller options win over injected ones', async () => {
    const { session, calls } = makeFixture([makeAgent()])
    patchApprovalRunBudget(session)
    const agent = session.machinery.getAgent() as FakeAgent
    await agent.sendToolApproval({ approved: false, requireToolApproval: false })
    expect(calls[0]).toMatchObject({ maxSteps: 1000, requireToolApproval: false })
  })

  it('does not double-wrap the same agent across repeated getAgent calls', async () => {
    const { session, calls, sharedCalls } = makeFixture([makeAgent()])
    patchApprovalRunBudget(session)
    session.machinery.getAgent()
    const agent = session.machinery.getAgent() as FakeAgent
    await agent.sendToolApproval({ approved: true })
    expect(calls).toHaveLength(1)
    // A double-wrapped method would build the shared options once per layer.
    expect(sharedCalls()).toBe(1)
  })

  it('patches a rebuilt agent instance returned by a later getAgent call', async () => {
    const { session, calls } = makeFixture([makeAgent(), makeAgent()])
    patchApprovalRunBudget(session)
    const first = session.machinery.getAgent() as FakeAgent
    const second = session.machinery.getAgent() as FakeAgent
    expect(second).not.toBe(first)
    await second.sendToolApproval({ toolCallId: 'tc2', approved: true })
    expect(calls[0]).toMatchObject({ maxSteps: 1000, toolCallId: 'tc2' })
  })
})
