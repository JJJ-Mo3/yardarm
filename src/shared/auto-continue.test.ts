import { describe, it, expect } from 'vitest'
import {
  resolveAutoContinue,
  countUnfinishedTasks,
  tasksFingerprint,
  buildTasksContinuePrompt,
  AUTO_CONTINUE_MAX_ROUNDS
} from './auto-continue'

describe('resolveAutoContinue', () => {
  it('uses the subchat override when set', () => {
    expect(resolveAutoContinue(true, false)).toBe(true)
    expect(resolveAutoContinue(false, true)).toBe(false)
  })

  it('falls back to the global value when the override is null/undefined', () => {
    expect(resolveAutoContinue(null, true)).toBe(true)
    expect(resolveAutoContinue(undefined, true)).toBe(true)
    expect(resolveAutoContinue(null, false)).toBe(false)
  })

  it('defaults off for absent or non-boolean global values', () => {
    expect(resolveAutoContinue(null, undefined)).toBe(false)
    expect(resolveAutoContinue(null, 'yes')).toBe(false)
    expect(resolveAutoContinue(undefined, 1)).toBe(false)
  })
})

describe('countUnfinishedTasks', () => {
  it('counts pending and in-progress tasks', () => {
    expect(
      countUnfinishedTasks([
        { id: '1', status: 'pending' },
        { id: '2', status: 'in_progress' },
        { id: '3', status: 'completed' }
      ])
    ).toBe(2)
  })

  it('treats missing status as unfinished and cancelled as finished', () => {
    expect(countUnfinishedTasks([{ id: '1' }, { id: '2', status: 'cancelled' }])).toBe(1)
  })

  it('returns 0 for an empty list', () => {
    expect(countUnfinishedTasks([])).toBe(0)
  })
})

describe('tasksFingerprint', () => {
  it('changes when a status changes', () => {
    const before = tasksFingerprint([{ id: '1', status: 'pending' }])
    const after = tasksFingerprint([{ id: '1', status: 'completed' }])
    expect(before).not.toBe(after)
  })

  it('changes when tasks are added', () => {
    const before = tasksFingerprint([{ id: '1', status: 'pending' }])
    const after = tasksFingerprint([
      { id: '1', status: 'pending' },
      { id: '2', status: 'pending' }
    ])
    expect(before).not.toBe(after)
  })

  it('is stable for identical lists and falls back to content for id-less tasks', () => {
    const tasks = [{ content: 'write docs', status: 'pending' }]
    expect(tasksFingerprint(tasks)).toBe(tasksFingerprint([...tasks]))
  })
})

describe('buildTasksContinuePrompt', () => {
  it('wraps the prompt in a system-reminder and pluralizes', () => {
    const one = buildTasksContinuePrompt(1)
    expect(one.startsWith('<system-reminder>')).toBe(true)
    expect(one.endsWith('</system-reminder>')).toBe(true)
    expect(one).toContain('1 unfinished task.')
    expect(buildTasksContinuePrompt(3)).toContain('3 unfinished tasks.')
  })
})

describe('AUTO_CONTINUE_MAX_ROUNDS', () => {
  it('is a sane positive budget', () => {
    expect(AUTO_CONTINUE_MAX_ROUNDS).toBeGreaterThan(0)
  })
})
