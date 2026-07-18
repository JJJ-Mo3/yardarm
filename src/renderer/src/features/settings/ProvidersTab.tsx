import React, { useState } from 'react'
import { Pencil, Trash2 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'

interface Draft {
  name: string
  url: string
  apiKey: string
  models: string
}

const EMPTY: Draft = { name: '', url: '', apiKey: '', models: '' }

export function ProvidersTab(): React.JSX.Element {
  const utils = trpc.useUtils()
  const settings = trpc.mastraSettings.get.useQuery()
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [editing, setEditing] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)

  const onSaved = (): void => {
    setDirty(true)
    setDraft(EMPTY)
    setEditing(null)
    utils.mastraSettings.get.invalidate()
  }
  const upsert = trpc.mastraSettings.upsertCustomProvider.useMutation({ onSuccess: onSaved })
  const remove = trpc.mastraSettings.removeCustomProvider.useMutation({
    onSuccess: () => {
      setDirty(true)
      utils.mastraSettings.get.invalidate()
    }
  })
  const applyRestart = trpc.mastraSettings.applyRestart.useMutation({
    onSuccess: () => setDirty(false)
  })

  const providers = settings.data?.customProviders ?? []
  const modelList = draft.models
    .split(/[\n,]/)
    .map((m) => m.trim())
    .filter(Boolean)
  const canSave = draft.name.trim() && draft.url.trim() && modelList.length > 0

  const error = settings.error ?? upsert.error ?? remove.error ?? applyRestart.error

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-muted-foreground">
        Custom OpenAI-compatible providers, stored in mastracode&apos;s <code>settings.json</code>{' '}
        (shared with the CLI).
      </div>

      <div className="space-y-1">
        {providers.map((p) => (
          <div
            key={p.name}
            className="flex items-center gap-2 rounded border border-border px-2 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{p.name}</div>
              <div className="truncate font-mono text-[10px] text-muted-foreground">
                {p.url} · {p.models.length} model{p.models.length === 1 ? '' : 's'}
                {p.apiKey ? ' · key set' : ''}
              </div>
            </div>
            <button
              title="Edit provider"
              className="text-muted-foreground hover:text-foreground cursor-pointer"
              onClick={() => {
                setEditing(p.name)
                setDraft({
                  name: p.name,
                  url: p.url,
                  apiKey: p.apiKey ?? '',
                  models: p.models.join(', ')
                })
              }}
            >
              <Pencil size={12} />
            </button>
            <button
              title="Remove provider"
              className="text-muted-foreground hover:text-destructive cursor-pointer"
              onClick={() => {
                if (confirm(`Remove custom provider "${p.name}"?`)) {
                  remove.mutate({ name: p.name })
                }
              }}
            >
              <Trash2 size={12} />
            </button>
          </div>
        ))}
        {!settings.isLoading && providers.length === 0 && (
          <div className="text-xs text-muted-foreground">No custom providers configured.</div>
        )}
      </div>

      <div className="space-y-2 rounded border border-border p-2">
        <div className="text-xs font-medium">{editing ? `Edit ${editing}` : 'Add provider'}</div>
        <Input
          placeholder="Name (e.g. my-llm)"
          value={draft.name}
          disabled={!!editing}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <Input
          placeholder="Base URL (e.g. http://localhost:11434/v1)"
          value={draft.url}
          onChange={(e) => setDraft({ ...draft, url: e.target.value })}
        />
        <Input
          type="password"
          placeholder="API key (optional)"
          value={draft.apiKey}
          onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
        />
        <Input
          placeholder="Model ids, comma-separated"
          value={draft.models}
          onChange={(e) => setDraft({ ...draft, models: e.target.value })}
        />
        <div className="flex justify-end gap-2">
          {editing && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(null)
                setDraft(EMPTY)
              }}
            >
              Cancel
            </Button>
          )}
          <Button
            size="sm"
            disabled={!canSave || upsert.isPending}
            onClick={() =>
              upsert.mutate({
                name: draft.name.trim(),
                url: draft.url.trim(),
                apiKey: draft.apiKey.trim() || undefined,
                models: modelList
              })
            }
          >
            {editing ? 'Save' : 'Add'}
          </Button>
        </div>
      </div>

      {error && <div className="text-xs text-destructive selectable">{error.message}</div>}

      {dirty && (
        <div className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
          <span className="flex-1 text-[11px]">Saved. Restart agents to apply.</span>
          <Button
            size="sm"
            className="h-6 px-2 text-[11px]"
            disabled={applyRestart.isPending}
            onClick={() => applyRestart.mutate()}
          >
            Restart agents
          </Button>
        </div>
      )}
    </div>
  )
}
