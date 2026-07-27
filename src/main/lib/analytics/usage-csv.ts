/**
 * Pure CSV builder for the Analytics export (day × model usage aggregates).
 * Electron-free so it can be unit-tested.
 */
import { estimateCostUSD } from '../../../shared/model-prices'

export interface UsageCsvRow {
  day: string
  modelId: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

function csvField(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function buildUsageCsv(rows: UsageCsvRow[]): string {
  const header = 'day,model,input_tokens,output_tokens,total_tokens,estimated_cost_usd'
  const lines = rows.map((r) => {
    const cost = estimateCostUSD(r.modelId, r)
    return [
      r.day,
      r.modelId,
      r.inputTokens,
      r.outputTokens,
      r.totalTokens,
      cost == null ? '' : cost.toFixed(4)
    ]
      .map(csvField)
      .join(',')
  })
  return [header, ...lines].join('\n') + '\n'
}
