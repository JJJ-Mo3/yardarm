/**
 * Curated catalog for the Settings → Connectors tab: one-click integrations
 * with common dev platforms via their official MCP servers. Pure module (no
 * React) so the endpoint builders and state detection are unit-testable.
 * Endpoints verified against each platform's official docs (July 2026).
 */

/** Renderer-side mirror of the mcp.json server shape (see main's McpServerConfig). */
export interface ConnectorServerConfig {
  command?: string
  args?: string[]
  env?: Record<string, string>
  url?: string
  headers?: Record<string, string>
  [key: string]: unknown
}

export interface ConnectorTokenAlt {
  /** Toggle label, e.g. "Use a personal access token instead". */
  label: string
  /** Where to create the token / where it is stored. */
  hint: string
  build: (token: string) => ConnectorServerConfig
}

export interface ConnectorDef {
  id: string
  title: string
  description: string
  docsUrl: string
  /** Key written into mcp.json's mcpServers map. */
  serverName: string
  /** GitLab self-managed instances need a base URL input. */
  needsInstanceUrl?: boolean
  /**
   * The platform's OAuth server doesn't support dynamic client registration
   * (RFC 7591), so the MCP browser sign-in flow cannot work — the token form
   * (tokenAlt, required) is the only connect path.
   */
  tokenOnly?: boolean
  build: (opts: { instanceUrl?: string }) => ConnectorServerConfig
  tokenAlt?: ConnectorTokenAlt
}

/**
 * Normalize a GitLab instance URL to its MCP endpoint, or null when the
 * input isn't a valid http(s) URL (drives inline validation in the UI).
 */
export function gitlabMcpUrl(instance: string): string | null {
  const trimmed = instance.trim()
  if (!trimmed) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  return `${parsed.origin}/api/v4/mcp`
}

export const CONNECTORS: ConnectorDef[] = [
  {
    id: 'github',
    title: 'GitHub',
    description: 'Repos, issues, pull requests, and CI via the official GitHub MCP server.',
    docsUrl: 'https://github.com/github/github-mcp-server',
    serverName: 'github',
    // GitHub's OAuth server has no dynamic client registration, so the MCP
    // browser sign-in handshake is impossible — a personal access token is
    // the only way in (verified July 2026).
    tokenOnly: true,
    build: () => ({ url: 'https://api.githubcopilot.com/mcp/' }),
    tokenAlt: {
      label: 'Personal access token',
      hint: 'GitHub\u2019s MCP server doesn\u2019t support browser sign-in — connect with a personal access token from github.com/settings/tokens (needs repo access). Stored in ~/.mastracode/mcp.json (shared with the CLI).',
      build: (token) => ({
        url: 'https://api.githubcopilot.com/mcp/',
        headers: { Authorization: `Bearer ${token}` }
      })
    }
  },
  {
    id: 'gitlab',
    title: 'GitLab',
    description:
      'Projects, merge requests, issues, and pipelines via the official GitLab MCP server.',
    docsUrl: 'https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_server/',
    serverName: 'gitlab',
    needsInstanceUrl: true,
    build: ({ instanceUrl }) => ({
      url: gitlabMcpUrl(instanceUrl ?? 'https://gitlab.com') ?? 'https://gitlab.com/api/v4/mcp'
    })
  },
  {
    id: 'supabase',
    title: 'Supabase',
    description: 'Databases, auth, and edge functions via the official Supabase MCP server.',
    docsUrl: 'https://supabase.com/docs/guides/getting-started/mcp',
    serverName: 'supabase',
    build: () => ({ url: 'https://mcp.supabase.com/mcp' })
  },
  {
    id: 'netlify',
    title: 'Netlify',
    description: 'Deploys, sites, and environment variables via the official Netlify MCP server.',
    docsUrl: 'https://docs.netlify.com/build/build-with-ai/netlify-mcp-server/',
    serverName: 'netlify',
    build: () => ({ url: 'https://netlify-mcp.netlify.app/mcp' }),
    tokenAlt: {
      label: 'Use a personal access token instead',
      hint: 'Create a token in Netlify user settings → Applications. Runs the local server via npx; stored in ~/.mastracode/mcp.json (shared with the CLI).',
      build: (token) => ({
        command: 'npx',
        args: ['-y', '@netlify/mcp'],
        env: { NETLIFY_PERSONAL_ACCESS_TOKEN: token }
      })
    }
  },
  {
    id: 'vercel',
    title: 'Vercel',
    description: 'Deployments, projects, and logs via the official Vercel MCP server.',
    docsUrl: 'https://vercel.com/docs/mcp/vercel-mcp',
    serverName: 'vercel',
    // No /mcp path — https://mcp.vercel.com is the documented endpoint.
    build: () => ({ url: 'https://mcp.vercel.com' })
  },
  {
    id: 'sentry',
    title: 'Sentry',
    description: 'Errors, issues, and traces via the official Sentry MCP server.',
    docsUrl: 'https://docs.sentry.io/product/sentry-mcp/',
    serverName: 'sentry',
    build: () => ({ url: 'https://mcp.sentry.dev/mcp' })
  }
]

export type ConnectorState = 'none' | 'managed' | 'custom'

/**
 * How an mcp.json entry relates to a connector: absent, matching one of the
 * connector's own config shapes (header/env values ignored so token entries
 * and GitLab instance variants still count), or a user-defined config with
 * the same name — which the Connectors tab must never clobber.
 */
export function connectorState(
  def: ConnectorDef,
  servers: Record<string, ConnectorServerConfig>
): ConnectorState {
  const entry = servers[def.serverName]
  if (!entry) return 'none'
  const candidates: ConnectorServerConfig[] = [def.build({})]
  if (def.needsInstanceUrl && entry.url && gitlabMcpUrl(entry.url) === entry.url) {
    candidates.push({ url: entry.url })
  }
  if (def.tokenAlt) candidates.push(def.tokenAlt.build(''))
  for (const c of candidates) {
    if (c.url) {
      if (entry.url === c.url && !entry.command) return 'managed'
    } else if (c.command) {
      if (
        entry.command === c.command &&
        JSON.stringify(entry.args ?? []) === JSON.stringify(c.args ?? []) &&
        !entry.url
      )
        return 'managed'
    }
  }
  return 'custom'
}
