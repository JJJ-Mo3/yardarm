import React, { useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { trpc } from '../../lib/trpc'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Tip } from '../../components/ui/tooltip'
import { useConfirm } from '../../components/ConfirmDialog'
import { AddLocalProviderDialog } from './AddLocalProviderDialog'
import { OAuthSection } from './OAuthSection'

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
  const [wizardOpen, setWizardOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [detecting, setDetecting] = useState(false)
  const [detectError, setDetectError] = useState<string | null>(null)
  const confirmDialog = useConfirm()

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
    onSuccess: () => {
      setDirty(false)
      // Fresh hosts re-read settings.json at boot — refetch the model catalog.
      utils.agent.listModels.invalidate()
    }
  })

  const providers = settings.data?.customProviders ?? []
  const modelList = draft.models
    .split(/[\n,]/)
    .map((m) => m.trim())
    .filter(Boolean)
  const canSave = draft.name.trim() && draft.url.trim() && modelList.length > 0

  const error = settings.error ?? upsert.error ?? remove.error ?? applyRestart.error

  const doDetect = async (): Promise<void> => {
    setDetecting(true)
    setDetectError(null)
    try {
      const res = await utils.client.mastraSettings.probeProvider.query({
        url: draft.url.trim(),
        apiKey: draft.apiKey.trim() || undefined
      })
      if (!res.ok) {
        setDetectError(res.error ?? 'Could not reach server')
        return
      }
      if (draft.models.trim()) {
        const ok = await confirmDialog({
          title: 'Replace model list?',
          description: `Found ${res.models.length} model${res.models.length === 1 ? '' : 's'} on the server. Replace the current list?`,
          confirmLabel: 'Replace'
        })
        if (!ok) return
      }
      setDraft((d) => ({ ...d, url: res.url, models: res.models.join(', ') }))
    } catch (err) {
      setDetectError(err instanceof Error ? err.message : String(err))
    } finally {
      setDetecting(false)
    }
  }

  return (
    <div className="space-y-4">
      <OAuthSection />

      <div className="space-y-1 border-t border-border pt-3">
        <div className="text-xs font-medium">Local & custom providers</div>
        <div className="text-[11px] text-muted-foreground">
          Custom OpenAI-compatible providers, stored in mastracode&apos;s <code>settings.json</code>{' '}
          (shared with the CLI).
        </div>
      </div>

      <Tip content="Guided setup for a model running on your machine (Ollama, LM Studio, and more)">
        <Button size="sm" onClick={() => setWizardOpen(true)}>
          <Plus size={13} className="mr-1" />
          Add local model
        </Button>
      </Tip>
      <AddLocalProviderDialog
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        existingNames={providers.map((p) => p.name)}
      />

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
            <Tip content="Edit this provider's URL, key, and model list">
              <button
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
            </Tip>
            <Tip content="Remove this provider — its models disappear from the model list">
              <button
                className="text-muted-foreground hover:text-destructive cursor-pointer"
                onClick={() => {
                  void confirmDialog({
                    title: 'Remove provider?',
                    description: `Custom provider "${p.name}" will be removed from settings.json.`,
                    confirmLabel: 'Remove'
                  }).then((ok) => {
                    if (ok) remove.mutate({ name: p.name })
                  })
                }}
              >
                <Trash2 size={12} />
              </button>
            </Tip>
          </div>
        ))}
        {!settings.isLoading && providers.length === 0 && (
          <div className="text-xs text-muted-foreground">No custom providers configured.</div>
        )}
      </div>

      {!manualOpen && !editing ? (
        <button
          className="text-[11px] text-muted-foreground underline hover:text-foreground cursor-pointer"
          onClick={() => setManualOpen(true)}
        >
          Add manually (advanced)
        </button>
      ) : (
        <div className="space-y-2 rounded border border-border p-2">
          <div className="text-xs font-medium">{editing ? `Edit ${editing}` : 'Add provider'}</div>
          <Input
            placeholder="Name (e.g. my-llm)"
            value={draft.name}
            disabled={!!editing}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <div className="flex items-center gap-2">
            <Input
              className="flex-1"
              placeholder="Base URL (e.g. http://localhost:11434/v1)"
              value={draft.url}
              onChange={(e) => setDraft({ ...draft, url: e.target.value })}
            />
            <Tip content="Test the server and fill in its model list">
              <span className="inline-flex">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={detecting || !draft.url.trim()}
                  onClick={() => void doDetect()}
                >
                  {detecting ? 'Detecting…' : 'Detect'}
                </Button>
              </span>
            </Tip>
          </div>
          {detectError && <div className="text-xs text-destructive selectable">{detectError}</div>}
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
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(null)
                setDraft(EMPTY)
                setManualOpen(false)
                setDetectError(null)
              }}
            >
              Cancel
            </Button>
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
      )}

      {error && <div className="text-xs text-destructive selectable">{error.message}</div>}

      {dirty && (
        <div className="flex items-center gap-2 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1.5">
          <span className="flex-1 text-[11px]">Saved. Restart agents to apply.</span>
          <Tip content="Restart all agent processes now so the saved providers take effect">
            <span className="inline-flex">
              <Button
                size="sm"
                className="h-6 px-2 text-[11px]"
                disabled={applyRestart.isPending}
                onClick={() => applyRestart.mutate()}
              >
                Restart agents
              </Button>
            </span>
          </Tip>
        </div>
      )}
    </div>
  )
}
