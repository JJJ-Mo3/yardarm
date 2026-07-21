/**
 * GitHub Releases API client for the in-app updater. The repo is public, so
 * unauthenticated requests are fine (60/hr rate limit vs. a check every 4h).
 * 404 means "no releases yet" and is treated as up to date, not an error.
 */
const RELEASES_LATEST_URL = 'https://api.github.com/repos/JJJ-Mo3/yardarm/releases/latest'

export interface ReleaseAsset {
  name: string
  browser_download_url: string
  size: number
}

export interface ReleaseInfo {
  tagName: string
  htmlUrl: string
  body: string
  assets: ReleaseAsset[]
}

export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  // Lazy so this module stays importable from vitest (the pure picker below).
  const { net } = await import('electron')
  const res = await net.fetch(RELEASES_LATEST_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
      'User-Agent': 'yardarm-updater'
    },
    signal: AbortSignal.timeout(10_000)
  })
  if (res.status === 404) return null
  if (!res.ok) throw new Error(`GitHub API responded ${res.status}`)
  const json = (await res.json()) as {
    tag_name?: string
    html_url?: string
    body?: string
    assets?: Array<{ name?: string; browser_download_url?: string; size?: number }>
  }
  if (!json.tag_name) throw new Error('GitHub API returned a release without a tag')
  return {
    tagName: json.tag_name,
    htmlUrl: json.html_url ?? 'https://github.com/JJJ-Mo3/yardarm/releases',
    body: json.body ?? '',
    assets: (json.assets ?? []).flatMap((a) =>
      a.name && a.browser_download_url && typeof a.size === 'number'
        ? [{ name: a.name, browser_download_url: a.browser_download_url, size: a.size }]
        : []
    )
  }
}

/**
 * Picks the mac zip asset for this machine's architecture. electron-builder's
 * artifactName pins ours to `Yardarm-<version>-<arch>.zip`, but accept the
 * default `-<arch>-mac.zip` / looser shapes too so a hand-cut release still works.
 */
export function pickMacZipAsset(assets: ReleaseAsset[], arch: string): ReleaseAsset | null {
  const zips = assets.filter((a) => a.name.toLowerCase().endsWith('.zip'))
  const byName = (test: (n: string) => boolean): ReleaseAsset | undefined =>
    zips.find((a) => test(a.name.toLowerCase()))
  return (
    byName((n) => n.endsWith(`-${arch}.zip`)) ??
    byName((n) => n.endsWith(`-${arch}-mac.zip`)) ??
    byName((n) => n.includes(arch)) ??
    byName((n) => n.includes('mac') || n.includes('darwin')) ??
    null
  )
}
