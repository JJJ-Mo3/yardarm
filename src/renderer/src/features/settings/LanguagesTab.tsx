/**
 * Settings → Languages: optional language-server pack downloads for IDE
 * diagnostics. TypeScript/JavaScript is built in; Go/Rust/Ruby use external
 * toolchain binaries from PATH; the packs here cover the rest. Download jobs
 * run in the main process (lspPacks router) and are polled while active.
 */
import React from 'react'
import { Download, Trash2, X } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Tip } from '../../components/ui/tooltip'

export function LanguagesTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const packs = trpc.lspPacks.list.useQuery(undefined, {
    refetchInterval: (query) =>
      query.state.data?.some((p) => p.phase === 'downloading' || p.phase === 'extracting')
        ? 750
        : false
  })
  const invalidate = (): void => void utils.lspPacks.list.invalidate()
  const download = trpc.lspPacks.download.useMutation({ onSuccess: invalidate })
  const cancel = trpc.lspPacks.cancel.useMutation({ onSuccess: invalidate })
  const remove = trpc.lspPacks.remove.useMutation({ onSuccess: invalidate })

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted-foreground">
        Language servers power the problems panel in the Files IDE. TypeScript and JavaScript
        support is built in; Go, Rust, and Ruby use tools from your PATH (gopls, rust-analyzer,
        ruby-lsp). The optional servers below are one-time downloads — they also work offline
        afterwards.
      </div>
      <div className="space-y-1.5">
        {packs.isLoading && <div className="text-xs text-muted-foreground">Loading…</div>}
        {packs.error && (
          <div className="text-xs text-destructive selectable">{packs.error.message}</div>
        )}
        {(packs.data ?? []).map((p) => {
          const busy = p.phase === 'downloading' || p.phase === 'extracting'
          const updateAvailable =
            p.installedVersion !== undefined && p.installedVersion !== p.version
          return (
            <div key={p.id} className="space-y-1.5 rounded border border-border px-2.5 py-2">
              <div className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-medium">{p.name}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {p.languages.join(', ')} · ~{p.approxSizeMb} MB
                  </div>
                </div>
                {busy ? (
                  <>
                    <span className="text-[11px] text-muted-foreground">
                      {p.phase === 'downloading'
                        ? `Downloading… ${Math.round((p.progress ?? 0) * 100)}%`
                        : 'Installing…'}
                    </span>
                    <Tip content="Cancel this download">
                      <span className="inline-flex">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px]"
                          disabled={cancel.isPending}
                          onClick={() => cancel.mutate({ packId: p.id })}
                        >
                          <X size={12} />
                          Cancel
                        </Button>
                      </span>
                    </Tip>
                  </>
                ) : p.installedVersion ? (
                  <>
                    <span className="text-[11px] text-muted-foreground">
                      Installed (v{p.installedVersion})
                    </span>
                    {updateAvailable && (
                      <Tip
                        content={`Download v${p.version}, the version this Yardarm release expects`}
                      >
                        <span className="inline-flex">
                          <Button
                            size="sm"
                            className="h-6 px-2 text-[11px]"
                            onClick={() => download.mutate({ packId: p.id })}
                          >
                            <Download size={12} />
                            Update to v{p.version}
                          </Button>
                        </span>
                      </Tip>
                    )}
                    <Tip content="Delete this language server from disk — a server already running keeps working until its chat closes">
                      <span className="inline-flex">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[11px]"
                          disabled={remove.isPending}
                          onClick={() => remove.mutate({ packId: p.id })}
                        >
                          <Trash2 size={12} />
                          Remove
                        </Button>
                      </span>
                    </Tip>
                  </>
                ) : (
                  <Tip
                    content={`Download the ${p.name} language server (~${p.approxSizeMb} MB, one time) from the Yardarm GitHub release`}
                  >
                    <span className="inline-flex">
                      <Button
                        size="sm"
                        className="h-6 px-2 text-[11px]"
                        disabled={download.isPending}
                        onClick={() => download.mutate({ packId: p.id })}
                      >
                        <Download size={12} />
                        {p.phase === 'error' ? 'Retry' : 'Download'}
                      </Button>
                    </span>
                  </Tip>
                )}
              </div>
              {p.phase === 'downloading' && (
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${Math.round((p.progress ?? 0) * 100)}%` }}
                  />
                </div>
              )}
              {p.phase === 'extracting' && (
                <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full w-full animate-pulse rounded-full bg-primary/60" />
                </div>
              )}
              {p.phase === 'error' && p.error && (
                <div className="text-[11px] text-destructive selectable">{p.error}</div>
              )}
            </div>
          )
        })}
      </div>
      {(download.error || cancel.error || remove.error) && (
        <div className="text-xs text-destructive selectable">
          {(download.error ?? cancel.error ?? remove.error)?.message}
        </div>
      )}
    </div>
  )
}
