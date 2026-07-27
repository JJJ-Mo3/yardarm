import { describe, expect, it } from 'vitest'
import { buildUsageCsv } from './usage-csv'

describe('buildUsageCsv', () => {
  it('emits only the header for no rows', () => {
    expect(buildUsageCsv([])).toBe('day,model,input_tokens,output_tokens,total_tokens\n')
  })

  it('emits one line per row with token counts', () => {
    const csv = buildUsageCsv([
      {
        day: '2026-07-27',
        modelId: 'anthropic/claude-sonnet-4-5',
        inputTokens: 1_000_000,
        outputTokens: 100_000,
        totalTokens: 1_100_000
      },
      {
        day: '2026-07-27',
        modelId: 'mystery/model-x',
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15
      }
    ])
    const lines = csv.trimEnd().split('\n')
    expect(lines[1]).toBe('2026-07-27,anthropic/claude-sonnet-4-5,1000000,100000,1100000')
    expect(lines[2]).toBe('2026-07-27,mystery/model-x,10,5,15')
  })

  it('quotes fields containing commas or quotes', () => {
    const csv = buildUsageCsv([
      {
        day: '2026-01-01',
        modelId: 'weird,"model"',
        inputTokens: 1,
        outputTokens: 2,
        totalTokens: 3
      }
    ])
    expect(csv.split('\n')[1]).toBe('2026-01-01,"weird,""model""",1,2,3')
  })
})
