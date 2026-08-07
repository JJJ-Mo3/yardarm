/** Tests for submit_plan rejection feedback splitting. */
import { describe, expect, it } from 'vitest'
import { splitPlanRejectionFeedback } from './plan-rejection'

describe('splitPlanRejectionFeedback', () => {
  it('passes through resumes for other tools', () => {
    const data = { action: 'rejected', feedback: 'change it' }
    expect(splitPlanRejectionFeedback('ask_user', data)).toEqual({
      resumeData: data,
      feedback: null
    })
    expect(splitPlanRejectionFeedback(undefined, data)).toEqual({
      resumeData: data,
      feedback: null
    })
  })

  it('passes through approvals untouched', () => {
    const data = { action: 'approved', path: '/p.md', title: 'T', plan: '# P' }
    expect(splitPlanRejectionFeedback('submit_plan', data)).toEqual({
      resumeData: data,
      feedback: null
    })
  })

  it('passes through non-object and feedback-less resumes', () => {
    expect(splitPlanRejectionFeedback('submit_plan', null)).toEqual({
      resumeData: null,
      feedback: null
    })
    expect(splitPlanRejectionFeedback('submit_plan', 'raw')).toEqual({
      resumeData: 'raw',
      feedback: null
    })
    const noFeedback = { action: 'rejected' }
    expect(splitPlanRejectionFeedback('submit_plan', noFeedback)).toEqual({
      resumeData: noFeedback,
      feedback: null
    })
  })

  it('strips and trims feedback from a rejection, keeping other keys', () => {
    const split = splitPlanRejectionFeedback('submit_plan', {
      action: 'rejected',
      feedback: '  use tabs instead  ',
      path: '/plan.md',
      title: 'My plan',
      plan: '# My plan'
    })
    expect(split.feedback).toBe('use tabs instead')
    expect(split.resumeData).toEqual({
      action: 'rejected',
      path: '/plan.md',
      title: 'My plan',
      plan: '# My plan'
    })
  })

  it('strips whitespace-only feedback but delivers nothing', () => {
    const split = splitPlanRejectionFeedback('submit_plan', {
      action: 'rejected',
      feedback: '   '
    })
    expect(split.feedback).toBeNull()
    expect(split.resumeData).toEqual({ action: 'rejected' })
  })

  it('does not mutate the input resume', () => {
    const data = { action: 'rejected', feedback: 'x' }
    splitPlanRejectionFeedback('submit_plan', data)
    expect(data.feedback).toBe('x')
  })
})
