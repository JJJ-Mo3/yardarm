/**
 * Tests for the pure Factory work-client helpers: base-URL resolution,
 * failure classification, board-graph queries, and idempotent body builders.
 */
import { describe, expect, it } from 'vitest'
import {
  attentionSourceId,
  type FactoryAttentionItem,
  type FactoryBoard,
  type FactoryWorkItem
} from '../../../shared/factory-work-types'
import { parseEnvFile } from './env-file'
import {
  allowedTransitionTargets,
  baseUrlFromEnv,
  buildStartRunBody,
  buildTransitionBody,
  currentBoardStage,
  failureFromResponse
} from './factory-api'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

describe('baseUrlFromEnv', () => {
  it('uses PORT from the env lines', () => {
    expect(baseUrlFromEnv(parseEnvFile('PORT=5200\n'))).toBe('http://localhost:5200')
  })

  it('defaults to 4111 when PORT is absent', () => {
    expect(baseUrlFromEnv(parseEnvFile('DATABASE_URL=x\n'))).toBe('http://localhost:4111')
  })

  it('last PORT wins on duplicates', () => {
    expect(baseUrlFromEnv(parseEnvFile('PORT=4111\nPORT=9000\n'))).toBe('http://localhost:9000')
  })

  it('falls back on invalid or out-of-range values', () => {
    expect(baseUrlFromEnv(parseEnvFile('PORT=abc\n'))).toBe('http://localhost:4111')
    expect(baseUrlFromEnv(parseEnvFile('PORT=0\n'))).toBe('http://localhost:4111')
    expect(baseUrlFromEnv(parseEnvFile('PORT=70000\n'))).toBe('http://localhost:4111')
    expect(baseUrlFromEnv([])).toBe('http://localhost:4111')
  })
})

describe('failureFromResponse', () => {
  it('maps 401 to auth_required', () => {
    const err = failureFromResponse(401, { error: 'unauthorized' })
    expect(err.code).toBe('auth_required')
    expect(err.status).toBe(401)
  })

  it('maps redirects and opaque status 0 to auth_required', () => {
    expect(failureFromResponse(302, null).code).toBe('auth_required')
    expect(failureFromResponse(0, null).code).toBe('auth_required')
  })

  it('passes server error codes and messages through', () => {
    const err = failureFromResponse(409, { error: 'stale', message: 'Board changed' })
    expect(err.code).toBe('stale')
    expect(err.message).toBe('Board changed')
    expect(err.status).toBe(409)
  })

  it('falls back to http_<status> when the body has no error code', () => {
    expect(failureFromResponse(500, null).code).toBe('http_500')
    expect(failureFromResponse(503, 'nope').code).toBe('http_503')
    expect(failureFromResponse(422, { error: '' }).code).toBe('http_422')
  })
})

const BOARD: FactoryBoard = {
  id: 'work',
  title: 'Work',
  initialPhase: 'intake',
  phases: [
    {
      id: 'intake',
      title: 'Intake',
      kind: 'resting',
      transitions: [
        { outcome: null, to: 'build' },
        { outcome: 'reject', to: 'done' },
        { outcome: 'dup', to: 'done' }
      ]
    },
    {
      id: 'build',
      title: 'Build',
      kind: 'working',
      role: 'work',
      transitions: [{ outcome: null, to: 'done' }]
    },
    { id: 'done', title: 'Done', kind: 'terminal', transitions: [] }
  ]
}

describe('allowedTransitionTargets', () => {
  it('returns deduped transition targets for a phase', () => {
    expect(allowedTransitionTargets(BOARD, 'intake')).toEqual(['build', 'done'])
    expect(allowedTransitionTargets(BOARD, 'done')).toEqual([])
  })

  it('returns [] for an unknown phase', () => {
    expect(allowedTransitionTargets(BOARD, 'nope')).toEqual([])
  })
})

function makeItem(overrides: Partial<FactoryWorkItem> = {}): FactoryWorkItem {
  return {
    id: 'wi-1',
    factoryProjectId: 'p-1',
    board: 'work',
    externalSource: null,
    title: 'Fix the flux capacitor',
    revision: 3,
    ...overrides
  } as FactoryWorkItem
}

describe('currentBoardStage', () => {
  it('returns the first stage matching a board phase', () => {
    expect(currentBoardStage(makeItem({ stages: ['triaged', 'build'] }), BOARD)).toBe('build')
  })

  it('returns null when no stage matches or stages are absent', () => {
    expect(currentBoardStage(makeItem({ stages: ['elsewhere'] }), BOARD)).toBeNull()
    expect(currentBoardStage(makeItem(), BOARD)).toBeNull()
  })
})

describe('buildTransitionBody', () => {
  it('generates a uuid requestId and default cause', () => {
    const body = buildTransitionBody({ board: 'work', stage: 'build', expectedRevision: 3 })
    expect(body.requestId).toMatch(UUID_RE)
    expect(body.cause).toBe('yardarm-board-drag')
    expect(body.board).toBe('work')
    expect(body.stage).toBe('build')
    expect(body.expectedRevision).toBe(3)
    expect(body.reenter).toBeUndefined()
    expect('reenter' in body).toBe(false)
  })

  it('clamps the cause to 256 chars and includes reenter only when true', () => {
    const body = buildTransitionBody({
      board: 'work',
      stage: 'build',
      expectedRevision: 1,
      cause: 'x'.repeat(300),
      reenter: true
    })
    expect(body.cause).toHaveLength(256)
    expect(body.reenter).toBe(true)
  })
})

describe('buildStartRunBody', () => {
  it('generates distinct uuids and clamps fields', () => {
    const item = makeItem({ title: 't'.repeat(600) })
    const body = buildStartRunBody(item, 'a'.repeat(40))
    expect(body.sessionId).toMatch(UUID_RE)
    expect(body.kickoffKey).toMatch(UUID_RE)
    expect(body.sessionId).not.toBe(body.kickoffKey)
    expect(body.threadTitle).toHaveLength(512)
    expect(body.workItem.role).toHaveLength(32)
    expect(body.workItem.id).toBe('wi-1')
    expect(body.workItem.input.title).toHaveLength(500)
  })

  it('includes optional input fields only when present', () => {
    const bare = buildStartRunBody(makeItem({ board: null }), 'work')
    expect('board' in bare.workItem.input).toBe(false)
    expect('externalSource' in bare.workItem.input).toBe(false)
    expect('parentWorkItemId' in bare.workItem.input).toBe(false)
    expect('metadata' in bare.workItem.input).toBe(false)

    const full = buildStartRunBody(
      makeItem({
        externalSource: { type: 'github', externalId: '42' },
        parentWorkItemId: 'wi-0',
        metadata: { a: 1 }
      }),
      'work'
    )
    expect(full.workItem.input.board).toBe('work')
    expect(full.workItem.input.externalSource).toEqual({ type: 'github', externalId: '42' })
    expect(full.workItem.input.parentWorkItemId).toBe('wi-0')
    expect(full.workItem.input.metadata).toEqual({ a: 1 })
  })
})

describe('attentionSourceId', () => {
  function att(overrides: Partial<FactoryAttentionItem>): FactoryAttentionItem {
    return {
      key: 'k',
      kind: 'activity',
      occurrence: 0,
      title: 't',
      ...overrides
    } as FactoryAttentionItem
  }

  it('maps each kind to its per-kind id field', () => {
    expect(attentionSourceId(att({ kind: 'automation-failed', decisionId: 'd1' }))).toBe('d1')
    expect(attentionSourceId(att({ kind: 'automation-proposed', decisionId: 'd2' }))).toBe('d2')
    expect(attentionSourceId(att({ kind: 'mention', commentId: 'c1' }))).toBe('c1')
    expect(attentionSourceId(att({ kind: 'activity', workItemId: 'w1' }))).toBe('w1')
    expect(attentionSourceId(att({ kind: 'supervisor-finding', findingKey: 'f1' }))).toBe('f1')
    expect(attentionSourceId(att({ kind: 'agent-waiting', sessionId: 's1' }))).toBe('s1')
  })

  it('returns null when the id field is missing or the kind is unknown', () => {
    expect(attentionSourceId(att({ kind: 'mention' }))).toBeNull()
    expect(attentionSourceId(att({ kind: 'weird' as FactoryAttentionItem['kind'] }))).toBeNull()
  })
})
