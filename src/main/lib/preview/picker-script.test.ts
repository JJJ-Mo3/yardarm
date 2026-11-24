/**
 * The picker ships as source text, so these tests evaluate that exact text:
 * the selector builder against a structural fake DOM, and the whole picker
 * against a fake window/document to check event swallowing and cleanup.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parsePickResult, PICK_STYLE_KEYS } from './pick-selection'
import { PICKER_CANCEL_SCRIPT, PICKER_SCRIPT, SELECTOR_PATH_SOURCE } from './picker-script'

interface FakeEl {
  nodeType: number
  localName: string
  attrs: Record<string, string>
  parentElement: FakeEl | null
  firstElementChild: FakeEl | null
  nextElementSibling: FakeEl | null
  getAttribute(name: string): string | null
}

/** Build a fake element; children are linked the way the selector walks them. */
function el(
  localName: string,
  attrs: Record<string, string> = {},
  children: FakeEl[] = []
): FakeEl {
  const node: FakeEl = {
    nodeType: 1,
    localName,
    attrs,
    parentElement: null,
    firstElementChild: children[0] ?? null,
    nextElementSibling: null,
    getAttribute: (name) => (name in attrs ? attrs[name] : null)
  }
  children.forEach((child, i) => {
    child.parentElement = node
    child.nextElementSibling = children[i + 1] ?? null
  })
  return node
}

const selectorPath = new Function(`${SELECTOR_PATH_SOURCE}; return selectorPath`)() as (
  node: unknown
) => string

describe('selectorPath', () => {
  it('walks up to body with tags, classes and nth-of-type', () => {
    const target = el('button', { class: 'btn primary large' })
    const other = el('button', { class: 'btn' })
    const card = el('div', { class: 'card' }, [el('h2'), other, target])
    el('html', {}, [el('body', {}, [el('main', {}, [card])])])
    expect(selectorPath(target)).toBe('body > main > div.card > button.btn.primary:nth-of-type(2)')
  })

  it('anchors at the nearest simple id', () => {
    const target = el('span')
    el('body', {}, [el('div', { id: 'app' }, [el('p', {}, [target])])])
    expect(selectorPath(target)).toBe('div#app > p > span')
    expect(selectorPath(target.parentElement?.parentElement)).toBe('div#app')
  })

  it('skips ids and classes that are not simple identifiers', () => {
    const target = el('a', { id: '1:bad id', class: 'hover:bg-red w-1/2 ok "x' })
    el('body', {}, [target])
    expect(selectorPath(target)).toBe('body > a.ok')
  })

  it('only adds nth-of-type when same-tag siblings exist', () => {
    const a = el('li')
    const b = el('li')
    const only = el('span')
    el('body', {}, [el('ul', {}, [a, b]), only])
    expect(selectorPath(a)).toBe('body > ul > li:nth-of-type(1)')
    expect(selectorPath(b)).toBe('body > ul > li:nth-of-type(2)')
    expect(selectorPath(only)).toBe('body > span')
  })

  it('limits the depth for deeply nested elements', () => {
    let node = el('i')
    const target = node
    for (let d = 0; d < 30; d++) node = el('div', {}, [node])
    expect(selectorPath(target).split(' > ')).toHaveLength(8)
  })

  it('handles detached, odd and missing nodes', () => {
    expect(selectorPath(el('section'))).toBe('section')
    expect(selectorPath(el('my-widget'))).toBe('my-widget')
    expect(selectorPath(el('we"ird'))).toBe('*')
    expect(selectorPath(el('html'))).toBe('html')
    expect(selectorPath(null)).toBe('')
    expect(selectorPath({ nodeType: 3 })).toBe('')
  })
})

type Listener = (e: Record<string, unknown>) => void

interface FiredEvent {
  preventDefault: ReturnType<typeof vi.fn>
  stopImmediatePropagation: ReturnType<typeof vi.fn>
}

/** Minimal window/document pair that records listeners and overlay nodes. */
function fakePage(target: unknown): {
  win: Record<string, unknown>
  doc: Record<string, unknown>
  listeners: Map<string, Listener[]>
  children: unknown[]
  root: { style: { cursor: string } }
  fire: (type: string, init?: Record<string, unknown>) => FiredEvent
} {
  const listeners = new Map<string, Listener[]>()
  const children: unknown[] = []
  const root = {
    style: { cursor: 'help' },
    appendChild(node: { parentNode: unknown }) {
      children.push(node)
      node.parentNode = root
    },
    removeChild(node: { parentNode: unknown }) {
      children.splice(children.indexOf(node), 1)
      node.parentNode = null
    }
  }
  const doc = {
    documentElement: root,
    createElement: () => ({ style: {}, parentNode: null }),
    elementFromPoint: () => target
  }
  const win: Record<string, unknown> = {
    location: { href: 'http://localhost:5173/' },
    innerWidth: 1024,
    innerHeight: 768,
    getComputedStyle: () => ({ getPropertyValue: (k: string) => `value-of-${k}` }),
    requestAnimationFrame: (cb: () => void) => setTimeout(cb, 16),
    addEventListener(type: string, fn: Listener) {
      listeners.set(type, [...(listeners.get(type) ?? []), fn])
    },
    removeEventListener(type: string, fn: Listener) {
      listeners.set(
        type,
        (listeners.get(type) ?? []).filter((f) => f !== fn)
      )
    }
  }
  const fire: ReturnType<typeof fakePage>['fire'] = (type, init = {}) => {
    const e = {
      clientX: 10,
      clientY: 10,
      ...init,
      preventDefault: vi.fn(),
      stopImmediatePropagation: vi.fn()
    }
    for (const fn of [...(listeners.get(type) ?? [])]) fn(e)
    return e
  }
  return { win, doc, listeners, children, root, fire }
}

function run(script: string, page: ReturnType<typeof fakePage>): unknown {
  return new Function('window', 'document', `return ${script}`)(page.win, page.doc)
}

const liveListeners = (page: ReturnType<typeof fakePage>): number =>
  [...page.listeners.values()].reduce((n, l) => n + l.length, 0)

describe('PICKER_SCRIPT', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  const button = (): unknown => {
    const node = el('button', { id: 'save', class: 'btn primary' })
    el('body', {}, [node])
    return Object.assign(node, {
      innerText: '  Save \n changes ',
      outerHTML: '<button id="save" class="btn primary">Save changes</button>',
      getBoundingClientRect: () => ({ left: 20, top: 30, width: 100, height: 40 })
    })
  }

  it('installs an overlay and listeners, then selects on click and cleans up', async () => {
    const page = fakePage(button())
    const result = run(PICKER_SCRIPT, page) as Promise<unknown>
    expect(page.children).toHaveLength(1)
    expect(page.root.style.cursor).toBe('crosshair')
    expect(liveListeners(page)).toBeGreaterThan(5)
    expect(typeof page.win.__yardarmPickCancel).toBe('function')

    page.fire('mousemove')
    const down = page.fire('mousedown')
    expect(down.preventDefault).toHaveBeenCalled()
    expect(down.stopImmediatePropagation).toHaveBeenCalled()
    const click = page.fire('click')
    expect(click.preventDefault).toHaveBeenCalled()
    expect(click.stopImmediatePropagation).toHaveBeenCalled()

    expect(liveListeners(page)).toBe(0)
    expect(page.children).toHaveLength(0)
    expect(page.root.style.cursor).toBe('help')
    expect('__yardarmPickCancel' in page.win).toBe(false)

    await vi.advanceTimersByTimeAsync(300)
    const raw = await result
    // Must survive structured-clone/JSON transport unchanged.
    expect(JSON.parse(JSON.stringify(raw))).toEqual(raw)
    const parsed = parsePickResult(raw)
    if (parsed.kind !== 'picked') throw new Error('expected a pick')
    expect(parsed.element).toMatchObject({
      selector: 'button#save',
      tag: 'button',
      id: 'save',
      classes: ['btn', 'primary'],
      text: 'Save changes',
      url: 'http://localhost:5173/',
      box: { x: 20, y: 30, width: 100, height: 40 },
      viewport: { width: 1024, height: 768 }
    })
    expect(parsed.element.styles.map(([k]) => k)).toEqual([...PICK_STYLE_KEYS])
  })

  it('cancels on Escape but leaves other keys alone', async () => {
    const page = fakePage(button())
    const result = run(PICKER_SCRIPT, page) as Promise<unknown>
    const other = page.fire('keydown', { key: 'a' })
    expect(other.preventDefault).not.toHaveBeenCalled()
    expect(liveListeners(page)).toBeGreaterThan(0)
    const esc = page.fire('keydown', { key: 'Escape' })
    expect(esc.preventDefault).toHaveBeenCalled()
    expect(liveListeners(page)).toBe(0)
    expect(page.children).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(300)
    expect(await result).toEqual({ cancelled: true })
  })

  it('is cancelled by the cancel script and by a second pick', async () => {
    const page = fakePage(button())
    const first = run(PICKER_SCRIPT, page) as Promise<unknown>
    const second = run(PICKER_SCRIPT, page) as Promise<unknown>
    expect(page.children).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(300)
    expect(await first).toEqual({ cancelled: true })

    expect(run(PICKER_CANCEL_SCRIPT, page)).toBeUndefined()
    expect(liveListeners(page)).toBe(0)
    expect(page.children).toHaveLength(0)
    await vi.advanceTimersByTimeAsync(300)
    expect(await second).toEqual({ cancelled: true })
    // Idempotent once nothing is running.
    expect(run(PICKER_CANCEL_SCRIPT, page)).toBeUndefined()
  })

  it('selects on release when no click follows (disabled controls)', async () => {
    const page = fakePage(button())
    const result = run(PICKER_SCRIPT, page) as Promise<unknown>
    page.fire('pointerup')
    expect(liveListeners(page)).toBeGreaterThan(0)
    await vi.advanceTimersByTimeAsync(500)
    expect(liveListeners(page)).toBe(0)
    expect(parsePickResult(await result).kind).toBe('picked')
  })

  it('resolves as cancelled when describing the element throws', async () => {
    const page = fakePage({
      getBoundingClientRect: () => {
        throw new Error('boom')
      }
    })
    const result = run(PICKER_SCRIPT, page) as Promise<unknown>
    page.fire('click')
    await vi.advanceTimersByTimeAsync(300)
    expect(await result).toEqual({ cancelled: true })
    expect(liveListeners(page)).toBe(0)
  })
})
