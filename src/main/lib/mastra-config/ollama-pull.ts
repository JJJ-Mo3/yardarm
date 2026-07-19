/**
 * One-click model downloads via Ollama's native `POST /api/pull` streaming
 * API. Jobs live in an in-memory registry; the renderer polls `getPull` for
 * progress. Pulls are resumable server-side, so cancel/app-quit is safe.
 */
import { randomUUID } from 'node:crypto'
import type { PullJob } from '../../../shared/mastra-settings'
import { normalizeFetchError } from './probe-provider'

interface PullJobInternal extends PullJob {
  abort: AbortController
  finishedAt: number | null
}

const jobs = new Map<string, PullJobInternal>()

/** Drop finished jobs after 10 minutes so the registry can't grow forever. */
function prune(): void {
  const cutoff = Date.now() - 10 * 60_000
  for (const [id, job] of jobs) {
    if (job.finishedAt !== null && job.finishedAt < cutoff) jobs.delete(id)
  }
}

/** Ollama's native API lives at the server root, not under /v1. */
function nativeBase(url: string): string {
  return url
    .trim()
    .replace(/\/+$/, '')
    .replace(/\/v\d+$/, '')
}

async function runPull(job: PullJobInternal, baseUrl: string): Promise<void> {
  try {
    const res = await fetch(`${nativeBase(baseUrl)}/api/pull`, {
      method: 'POST',
      body: JSON.stringify({ model: job.model, stream: true }),
      signal: job.abort.signal
    })
    if (!res.ok || !res.body) {
      throw new Error(`HTTP ${res.status} from /api/pull`)
    }
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        const ev = JSON.parse(line) as {
          status?: string
          error?: string
          total?: number
          completed?: number
        }
        if (ev.error) throw new Error(ev.error)
        if (ev.status) job.statusText = ev.status
        if (typeof ev.total === 'number') job.total = ev.total
        if (typeof ev.completed === 'number') job.completed = ev.completed
        if (ev.status === 'success') {
          job.status = 'done'
          job.finishedAt = Date.now()
          return
        }
      }
    }
    // Stream ended without an explicit success line — treat as done.
    job.status = 'done'
    job.finishedAt = Date.now()
  } catch (err) {
    if (job.status === 'cancelled') return
    job.status = 'error'
    job.error = normalizeFetchError(err)
    job.finishedAt = Date.now()
  }
}

export function startPull(baseUrl: string, model: string): string {
  prune()
  const job: PullJobInternal = {
    jobId: randomUUID(),
    model,
    status: 'running',
    statusText: 'starting',
    completed: 0,
    total: 0,
    abort: new AbortController(),
    finishedAt: null
  }
  jobs.set(job.jobId, job)
  void runPull(job, baseUrl)
  return job.jobId
}

export function getPull(jobId: string): PullJob | null {
  prune()
  const job = jobs.get(jobId)
  if (!job) return null
  const { jobId: id, model, status, statusText, completed, total, error } = job
  return { jobId: id, model, status, statusText, completed, total, error }
}

export function cancelPull(jobId: string): void {
  const job = jobs.get(jobId)
  if (!job || job.status !== 'running') return
  job.status = 'cancelled'
  job.finishedAt = Date.now()
  job.abort.abort()
}
