import { describe, expect, it } from 'vitest'
import {
  bucketForGithubState,
  bucketForGitlabStatus,
  buildFixChecksPrompt,
  countChecks,
  excerptFailedLog,
  failingRunIds,
  gitlabPipelineCheck,
  parseGhChecks,
  parseGitlabJobs,
  parseGitlabMr,
  pickMergeMethod,
  runIdFromCheckLink,
  type PrCheck
} from './pr-checks'

const check = (over: Partial<PrCheck>): PrCheck => ({
  name: 'test',
  state: 'failure',
  bucket: 'fail',
  link: '',
  workflow: '',
  ...over
})

describe('parseGhChecks', () => {
  it('maps rows and sorts failing checks first', () => {
    const out = JSON.stringify([
      {
        name: 'lint',
        state: 'SUCCESS',
        bucket: 'pass',
        link: 'https://github.com/o/r/actions/runs/1/job/2',
        workflow: 'CI'
      },
      { name: 'build', state: 'IN_PROGRESS', bucket: 'pending', link: '', workflow: 'CI' },
      {
        name: 'test',
        state: 'FAILURE',
        bucket: 'fail',
        link: 'https://github.com/o/r/actions/runs/1/job/3',
        workflow: 'CI'
      }
    ])
    expect(parseGhChecks(out)).toEqual([
      {
        name: 'test',
        state: 'failure',
        bucket: 'fail',
        link: 'https://github.com/o/r/actions/runs/1/job/3',
        workflow: 'CI'
      },
      { name: 'build', state: 'in_progress', bucket: 'pending', link: '', workflow: 'CI' },
      {
        name: 'lint',
        state: 'success',
        bucket: 'pass',
        link: 'https://github.com/o/r/actions/runs/1/job/2',
        workflow: 'CI'
      }
    ])
  })

  it('derives the bucket from the state when the field is missing or unknown', () => {
    const out = JSON.stringify([
      { name: 'a', state: 'TIMED_OUT' },
      { name: 'b', state: 'SKIPPED', bucket: 'weird' },
      { name: 'c', state: 'QUEUED' },
      { name: 'd', state: 'CANCELLED' }
    ])
    expect(parseGhChecks(out)?.map((c) => [c.name, c.bucket])).toEqual([
      ['a', 'fail'],
      ['d', 'cancel'],
      ['c', 'pending'],
      ['b', 'skipping']
    ])
  })

  it('returns null for non-JSON or non-array output and skips malformed rows', () => {
    expect(parseGhChecks('')).toBeNull()
    expect(parseGhChecks('no checks reported')).toBeNull()
    expect(parseGhChecks('{"name":"x"}')).toBeNull()
    expect(parseGhChecks('[null, 3, {"state":"SUCCESS"}]')).toEqual([])
  })
})

describe('bucket mapping', () => {
  it('covers GitHub states', () => {
    expect(bucketForGithubState('success')).toBe('pass')
    expect(bucketForGithubState('ERROR')).toBe('fail')
    expect(bucketForGithubState('NEUTRAL')).toBe('skipping')
    expect(bucketForGithubState('PENDING')).toBe('pending')
  })

  it('covers GitLab statuses', () => {
    expect(bucketForGitlabStatus('success')).toBe('pass')
    expect(bucketForGitlabStatus('failed')).toBe('fail')
    expect(bucketForGitlabStatus('failed', true)).toBe('skipping')
    expect(bucketForGitlabStatus('canceled')).toBe('cancel')
    expect(bucketForGitlabStatus('manual')).toBe('skipping')
    expect(bucketForGitlabStatus('running')).toBe('pending')
    expect(bucketForGitlabStatus('created')).toBe('pending')
  })
})

describe('GitLab parsing', () => {
  it('maps pipeline jobs', () => {
    const out = JSON.stringify([
      { name: 'unit', status: 'success', stage: 'test', web_url: 'https://gl/x/-/jobs/1' },
      { name: 'e2e', status: 'failed', stage: 'test', web_url: 'https://gl/x/-/jobs/2' },
      { name: 'flaky', status: 'failed', stage: 'test', allow_failure: true, web_url: '' }
    ])
    expect(parseGitlabJobs(out)).toEqual([
      {
        name: 'e2e',
        state: 'failed',
        bucket: 'fail',
        link: 'https://gl/x/-/jobs/2',
        workflow: 'test'
      },
      {
        name: 'unit',
        state: 'success',
        bucket: 'pass',
        link: 'https://gl/x/-/jobs/1',
        workflow: 'test'
      },
      { name: 'flaky', state: 'failed (allowed)', bucket: 'skipping', link: '', workflow: 'test' }
    ])
    expect(parseGitlabJobs('{"message":"404"}')).toBeNull()
    expect(parseGitlabJobs('oops')).toBeNull()
  })

  it('reads the MR and its head pipeline', () => {
    const out = JSON.stringify({
      iid: 7,
      title: 'Add thing',
      web_url: 'https://gl/x/-/merge_requests/7',
      state: 'opened',
      merge_when_pipeline_succeeds: true,
      head_pipeline: { id: 99, project_id: 5, status: 'running', web_url: 'https://gl/x/p/99' }
    })
    expect(parseGitlabMr(out)).toEqual({
      number: 7,
      title: 'Add thing',
      url: 'https://gl/x/-/merge_requests/7',
      open: true,
      autoMerge: true,
      pipeline: { id: 99, projectId: 5, status: 'running', url: 'https://gl/x/p/99' }
    })
  })

  it('tolerates a missing pipeline, closed MRs and junk', () => {
    const mr = parseGitlabMr(JSON.stringify({ iid: 1, state: 'merged', head_pipeline: null }))
    expect(mr).toMatchObject({ open: false, autoMerge: false, pipeline: null })
    expect(parseGitlabMr('[]')).toBeNull()
    expect(parseGitlabMr('nope')).toBeNull()
    expect(parseGitlabMr('{"title":"no iid"}')).toBeNull()
  })

  it('builds a stand-in row for a pipeline', () => {
    expect(gitlabPipelineCheck({ status: 'failed', url: 'u' })).toEqual({
      name: 'Pipeline',
      state: 'failed',
      bucket: 'fail',
      link: 'u',
      workflow: ''
    })
  })
})

describe('pickMergeMethod', () => {
  it('uses the viewer default when allowed', () => {
    expect(pickMergeMethod('{"viewerDefaultMergeMethod":"SQUASH","squashMergeAllowed":true}')).toBe(
      'squash'
    )
    expect(pickMergeMethod('{"viewerDefaultMergeMethod":"REBASE"}')).toBe('rebase')
  })

  it('falls back to the first allowed method', () => {
    expect(
      pickMergeMethod(
        '{"viewerDefaultMergeMethod":"MERGE","mergeCommitAllowed":false,"squashMergeAllowed":true}'
      )
    ).toBe('squash')
    expect(
      pickMergeMethod(
        '{"mergeCommitAllowed":false,"squashMergeAllowed":false,"rebaseMergeAllowed":true}'
      )
    ).toBe('rebase')
    expect(pickMergeMethod('garbage')).toBe('merge')
    expect(pickMergeMethod('{}')).toBe('merge')
  })
})

describe('run ids', () => {
  it('extracts the Actions run id from a check link', () => {
    expect(runIdFromCheckLink('https://github.com/o/r/actions/runs/123456/job/789')).toBe('123456')
    expect(runIdFromCheckLink('https://github.com/o/r/actions/runs/42')).toBe('42')
    expect(runIdFromCheckLink('https://ci.example.com/build/9')).toBeNull()
    expect(runIdFromCheckLink('https://github.com/o/r/actions/runs/12abc')).toBeNull()
  })

  it('collects distinct run ids of failing checks only, capped', () => {
    const checks = [
      check({ link: 'https://github.com/o/r/actions/runs/1/job/1' }),
      check({ link: 'https://github.com/o/r/actions/runs/1/job/2' }),
      check({ bucket: 'pass', link: 'https://github.com/o/r/actions/runs/9/job/1' }),
      check({ link: 'https://external/ci' }),
      check({ link: 'https://github.com/o/r/actions/runs/2/job/1' }),
      check({ link: 'https://github.com/o/r/actions/runs/3/job/1' })
    ]
    expect(failingRunIds(checks)).toEqual(['1', '2'])
    expect(failingRunIds(checks, 5)).toEqual(['1', '2', '3'])
  })
})

describe('excerptFailedLog', () => {
  it('strips timestamps and colors and keeps the tail', () => {
    const raw = [
      'test\tRun tests\t2026-01-02T03:04:05.1234567Z first line',
      'test\tRun tests\t2026-01-02T03:04:06.1234567Z \u001b[31mError: boom\u001b[0m',
      '',
      'test\tRun tests\t2026-01-02T03:04:07.1234567Z exit code 1'
    ].join('\n')
    expect(excerptFailedLog(raw)).toBe(
      [
        'test\tRun tests\tfirst line',
        'test\tRun tests\tError: boom',
        'test\tRun tests\texit code 1'
      ].join('\n')
    )
  })

  it('truncates by line count and by characters, marking the cut', () => {
    const raw = Array.from({ length: 100 }, (_, i) => `line ${i}`).join('\n')
    const byLines = excerptFailedLog(raw, 3)
    expect(byLines).toBe('…\nline 97\nline 98\nline 99')
    const byChars = excerptFailedLog(raw, 100, 20)
    expect(byChars.startsWith('…\n')).toBe(true)
    expect(byChars.endsWith('line 99')).toBe(true)
    expect(byChars.length).toBeLessThanOrEqual(22)
    expect(excerptFailedLog('')).toBe('')
  })
})

describe('countChecks', () => {
  it('tallies by bucket', () => {
    expect(
      countChecks([
        check({}),
        check({ bucket: 'pass' }),
        check({ bucket: 'pass' }),
        check({ bucket: 'pending' }),
        check({ bucket: 'skipping' }),
        check({ bucket: 'cancel' })
      ])
    ).toEqual({ pass: 2, fail: 1, pending: 1, other: 2 })
  })
})

describe('buildFixChecksPrompt', () => {
  it('lists failing checks with links and appends log excerpts', () => {
    const prompt = buildFixChecksPrompt({
      ref: 'PR #12',
      url: 'https://github.com/o/r/pull/12',
      failing: [
        check({
          name: 'unit',
          workflow: 'CI',
          link: 'https://github.com/o/r/actions/runs/1/job/2'
        }),
        check({ name: 'deploy-preview' })
      ],
      logs: [
        { runId: '1', excerpt: 'Error: ```boom```' },
        { runId: '2', excerpt: '   ' }
      ]
    })
    expect(prompt).toContain('failing on PR #12 (https://github.com/o/r/pull/12):')
    expect(prompt).toContain('- CI / unit — https://github.com/o/r/actions/runs/1/job/2')
    expect(prompt).toContain('- deploy-preview\n')
    expect(prompt).toContain('End of the failed log for run 1:\n````\nError: ```boom```\n````')
    expect(prompt).not.toContain('run 2')
    expect(prompt).toContain('fix the underlying cause')
  })

  it('works without logs', () => {
    const prompt = buildFixChecksPrompt({
      ref: 'MR !3',
      url: 'https://gl/x/-/merge_requests/3',
      failing: [check({ name: 'e2e', workflow: 'test' })]
    })
    expect(prompt).toContain('- test / e2e')
    expect(prompt).not.toContain('failed log')
  })
})
