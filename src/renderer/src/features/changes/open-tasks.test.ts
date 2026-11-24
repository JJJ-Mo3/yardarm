import { describe, expect, it } from 'vitest'
import { openTasks, openTasksWarning } from './open-tasks'

describe('openTasks', () => {
  it('keeps pending, in-progress and status-less tasks', () => {
    const tasks = [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
      { content: 'd' },
      { content: 'e', status: 'cancelled' }
    ]
    expect(openTasks(tasks).map((t) => t.content)).toEqual(['b', 'c', 'd'])
  })
})

describe('openTasksWarning', () => {
  it('is null when nothing is open', () => {
    expect(openTasksWarning([])).toBeNull()
    expect(openTasksWarning([{ content: 'a', status: 'completed' }])).toBeNull()
  })

  it('uses the singular for one task', () => {
    expect(openTasksWarning([{ content: 'Write tests', status: 'pending' }])).toBe(
      '1 task is still open: Write tests'
    )
  })

  it('lists the open tasks', () => {
    expect(
      openTasksWarning([
        { content: 'Write tests', status: 'pending' },
        { content: 'Done', status: 'completed' },
        { content: 'Update docs', status: 'in_progress' },
        { content: 'Run lint', status: 'pending' }
      ])
    ).toBe('3 tasks are still open: Write tests; Update docs; Run lint')
  })

  it('counts tasks beyond the listed ones and shortens long titles', () => {
    const tasks = Array.from({ length: 5 }, (_, i) => ({ content: `Task ${i + 1}` }))
    expect(openTasksWarning(tasks)).toBe(
      '5 tasks are still open: Task 1; Task 2; Task 3; and 2 more'
    )
    const long = openTasksWarning([{ content: `${'x'.repeat(80)}\nsecond line` }]) ?? ''
    expect(long).toBe(`1 task is still open: ${'x'.repeat(59)}…`)
  })

  it('falls back to the count when tasks have no text', () => {
    expect(openTasksWarning([{ status: 'pending' }, { content: '  ' }])).toBe(
      '2 tasks are still open.'
    )
  })
})
