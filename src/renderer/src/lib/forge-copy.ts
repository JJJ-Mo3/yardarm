/**
 * Provider-aware UI copy for repo-forge features (PRs on GitHub, MRs on
 * GitLab). Defaults to GitHub wording while the provider is unknown/loading so
 * existing copy never flashes to something odd.
 */
import type { RepoProvider } from '@shared/ipc-types'

export interface ForgeCopy {
  /** Short noun: 'PR' | 'MR'. */
  short: 'PR' | 'MR'
  /** Long noun: 'pull request' | 'merge request'. */
  long: 'pull request' | 'merge request'
  cli: 'gh' | 'glab'
  host: 'GitHub' | 'GitLab'
  /** Number prefix in references: '#' (PR #5) | '!' (MR !5). */
  refPrefix: '#' | '!'
  /** Install URL for the provider's CLI. */
  cliUrl: string
}

export function forgeCopy(provider: RepoProvider | null | undefined): ForgeCopy {
  if (provider === 'gitlab') {
    return {
      short: 'MR',
      long: 'merge request',
      cli: 'glab',
      host: 'GitLab',
      refPrefix: '!',
      cliUrl: 'https://gitlab.com/gitlab-org/cli'
    }
  }
  return {
    short: 'PR',
    long: 'pull request',
    cli: 'gh',
    host: 'GitHub',
    refPrefix: '#',
    cliUrl: 'https://cli.github.com'
  }
}
