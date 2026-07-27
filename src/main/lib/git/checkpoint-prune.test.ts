import { describe, expect, it } from 'vitest'
import { collectKeepShas, pruneEligibleShas } from './checkpoint-prune'

describe('collectKeepShas', () => {
  it('keeps stash shas from message refs and named rows, skipping nulls', () => {
    const keep = collectKeepShas(
      [
        JSON.stringify({ head: 'h1', stash: 'aaa' }),
        JSON.stringify({ head: 'h2', stash: null }),
        null
      ],
      ['bbb', null]
    )
    expect(keep).toEqual(new Set(['aaa', 'bbb']))
  })

  it('ignores malformed checkpoint refs', () => {
    expect(collectKeepShas(['not json'], [])).toEqual(new Set())
  })
})

describe('pruneEligibleShas', () => {
  it('returns only pinned shas nothing references', () => {
    const keep = new Set(['aaa', 'bbb'])
    expect(pruneEligibleShas(['aaa', 'ccc', 'ddd', 'bbb'], keep)).toEqual(['ccc', 'ddd'])
  })

  it('returns nothing when everything is referenced', () => {
    expect(pruneEligibleShas(['aaa'], new Set(['aaa']))).toEqual([])
  })
})
