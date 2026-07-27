/** Tests for the pure Connectors catalog helpers. */
import { describe, expect, it } from 'vitest'
import { CONNECTORS, connectorState, gitlabMcpUrl } from './connector-catalog'
import type { ConnectorDef } from './connector-catalog'

function byId(id: string): ConnectorDef {
  const def = CONNECTORS.find((c) => c.id === id)
  if (!def) throw new Error(`missing connector ${id}`)
  return def
}

describe('gitlabMcpUrl', () => {
  it('builds the endpoint for gitlab.com', () => {
    expect(gitlabMcpUrl('https://gitlab.com')).toBe('https://gitlab.com/api/v4/mcp')
  })

  it('strips trailing slashes and paths down to the origin', () => {
    expect(gitlabMcpUrl('https://gitlab.example.com/')).toBe(
      'https://gitlab.example.com/api/v4/mcp'
    )
    expect(gitlabMcpUrl('https://gitlab.example.com/group/project')).toBe(
      'https://gitlab.example.com/api/v4/mcp'
    )
  })

  it('preserves non-default ports', () => {
    expect(gitlabMcpUrl('https://gitlab.internal:8443')).toBe(
      'https://gitlab.internal:8443/api/v4/mcp'
    )
  })

  it('returns null for empty, garbage, and non-http inputs', () => {
    expect(gitlabMcpUrl('')).toBeNull()
    expect(gitlabMcpUrl('   ')).toBeNull()
    expect(gitlabMcpUrl('not a url')).toBeNull()
    expect(gitlabMcpUrl('ftp://gitlab.com')).toBeNull()
  })
})

describe('catalog integrity', () => {
  it('has unique ids and server names', () => {
    const ids = CONNECTORS.map((c) => c.id)
    const names = CONNECTORS.map((c) => c.serverName)
    expect(new Set(ids).size).toBe(CONNECTORS.length)
    expect(new Set(names).size).toBe(CONNECTORS.length)
  })

  it('has non-empty copy and docs links on every entry', () => {
    for (const c of CONNECTORS) {
      expect(c.title.length).toBeGreaterThan(0)
      expect(c.description.length).toBeGreaterThan(0)
      expect(c.docsUrl.startsWith('https://')).toBe(true)
    }
  })

  it('builds a url or command config for every entry', () => {
    for (const c of CONNECTORS) {
      const cfg = c.build({})
      expect(Boolean(cfg.url) || Boolean(cfg.command)).toBe(true)
    }
  })

  it('honors the GitLab instance URL and falls back to gitlab.com', () => {
    const gitlab = byId('gitlab')
    expect(gitlab.build({}).url).toBe('https://gitlab.com/api/v4/mcp')
    expect(gitlab.build({ instanceUrl: 'https://gitlab.example.com' }).url).toBe(
      'https://gitlab.example.com/api/v4/mcp'
    )
  })
})

describe('tokenAlt builds', () => {
  it('GitHub token alt sets a bearer header on the hosted endpoint', () => {
    const cfg = byId('github').tokenAlt!.build('tok123')
    expect(cfg.url).toBe('https://api.githubcopilot.com/mcp/')
    expect(cfg.headers).toEqual({ Authorization: 'Bearer tok123' })
  })

  it('Netlify token alt runs the local npx server with the token env', () => {
    const cfg = byId('netlify').tokenAlt!.build('tok456')
    expect(cfg.command).toBe('npx')
    expect(cfg.args).toEqual(['-y', '@netlify/mcp'])
    expect(cfg.env).toEqual({ NETLIFY_PERSONAL_ACCESS_TOKEN: 'tok456' })
  })
})

describe('connectorState', () => {
  const github = byId('github')
  const gitlab = byId('gitlab')
  const netlify = byId('netlify')

  it('reports none when the server name is absent', () => {
    expect(connectorState(github, {})).toBe('none')
  })

  it('reports managed for the built OAuth config', () => {
    expect(connectorState(github, { github: github.build({}) })).toBe('managed')
  })

  it('reports managed for token variants regardless of secret values', () => {
    expect(connectorState(github, { github: github.tokenAlt!.build('secret') })).toBe('managed')
    expect(connectorState(netlify, { netlify: netlify.tokenAlt!.build('secret') })).toBe('managed')
  })

  it('reports managed for GitLab self-managed instance variants', () => {
    expect(
      connectorState(gitlab, {
        gitlab: gitlab.build({ instanceUrl: 'https://gitlab.example.com' })
      })
    ).toBe('managed')
  })

  it('reports custom for same-name servers with a different url or command', () => {
    expect(connectorState(github, { github: { url: 'https://example.com/mcp' } })).toBe('custom')
    expect(connectorState(github, { github: { command: 'node', args: ['server.js'] } })).toBe(
      'custom'
    )
    expect(connectorState(netlify, { netlify: { command: 'npx', args: ['-y', 'other'] } })).toBe(
      'custom'
    )
  })
})
