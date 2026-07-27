/**
 * Pure CSV builder for the Analytics export (day × model usage aggregates).
 * Electron-free so it can be unit-tested.
 */
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
  const header = 'day,model,input_tokens,output_tokens,total_tokens'
  const lines = rows.map((r) =>
    [r.day, r.modelId, r.inputTokens, r.outputTokens, r.totalTokens].map(csvField).join(',')
  )
  return [header, ...lines].join('\n') + '\n'
}
