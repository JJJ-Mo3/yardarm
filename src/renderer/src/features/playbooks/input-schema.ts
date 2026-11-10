/**
 * Derive a simple input form from a stored workflow definition's JSON-schema
 * `inputSchema`. Only flat objects of string/number/boolean properties get a
 * form; anything else (unparseable JSON, missing/non-object schema, nested or
 * exotic property types) returns null and the UI falls back to a raw-JSON
 * textarea. Pure and renderer-local — unit-tested.
 */
export interface InputField {
  key: string
  type: 'string' | 'number' | 'boolean'
  required: boolean
  description?: string
}

const SIMPLE_TYPES = new Set(['string', 'number', 'boolean'])

export function parseInputFields(definitionJson: string): InputField[] | null {
  let def: unknown
  try {
    def = JSON.parse(definitionJson)
  } catch {
    return null
  }
  if (typeof def !== 'object' || def === null) return null
  const schema = (def as Record<string, unknown>).inputSchema
  if (typeof schema !== 'object' || schema === null) return null
  const s = schema as Record<string, unknown>
  if (s.type !== 'object') return null
  const props = s.properties
  if (typeof props !== 'object' || props === null || Array.isArray(props)) return null
  const required = Array.isArray(s.required) ? s.required.filter((r) => typeof r === 'string') : []
  const fields: InputField[] = []
  for (const [key, raw] of Object.entries(props as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null) return null
    const p = raw as Record<string, unknown>
    if (typeof p.type !== 'string' || !SIMPLE_TYPES.has(p.type)) return null
    fields.push({
      key,
      type: p.type as InputField['type'],
      required: required.includes(key),
      ...(typeof p.description === 'string' ? { description: p.description } : {})
    })
  }
  return fields
}

/** Prompt asking the chat's agent to build + save a workflow for a playbook. */
export function buildDraftWorkflowPrompt(description: string): string {
  return `Use your workflow tools (create_workflow / save_workflow) to build and save a reusable workflow that: ${description.trim()}

Keep the input schema flat (string/number/boolean properties) when possible so it can be run from a simple form. Report the saved workflow id when done.`
}
