/**
 * The Preview tab's element picker, as source text. windows/preview-capture.ts
 * injects PICKER_SCRIPT into a verified preview guest with
 * webContents.executeJavaScriptInIsolatedWorld — the preview webview has no
 * preload, so this is the only code the app ever runs inside a previewed page.
 *
 * Rules this file must keep:
 *  - The scripts are fixed at build time. The only interpolations are the
 *    app's own constants below — never a page- or renderer-supplied value.
 *  - The picker removes every listener, its overlay, the cursor override and
 *    its cancel hook on finish or cancel.
 *  - It resolves with a plain JSON-serializable object, which the main process
 *    treats as untrusted (pick-selection.ts validates and caps it).
 *
 * The code is kept as plain ES5-style text rather than a serialized function
 * so bundler transforms can't change what runs in the page. Tests evaluate
 * the same strings against structural fakes (picker-script.test.ts).
 */
import { PICK_STYLE_KEYS } from './pick-selection'

/** In-page pre-clip lengths — a courtesy to keep the IPC payload small; main re-caps. */
const IN_PAGE_CLIP = { short: 400, text: 600, html: 3000, url: 1000, selector: 1200 }

/**
 * `selectorPath(el)`: a readable CSS path for an element. Walks up at most 8
 * ancestors, stopping early at an element with a simple id (or html/body).
 * Each step is `tag`, up to two simple class names, and `:nth-of-type(n)` when
 * same-tag siblings exist. Only needs localName, nodeType, getAttribute,
 * parentElement, firstElementChild and nextElementSibling.
 */
export const SELECTOR_PATH_SOURCE = String.raw`function selectorPath(el) {
  var IDENT = /^[A-Za-z_][A-Za-z0-9_-]*$/
  var parts = []
  var node = el
  while (node && node.nodeType === 1 && parts.length < 8) {
    var tag = String(node.localName || '').toLowerCase()
    if (!IDENT.test(tag)) tag = '*'
    if (tag === 'html' || tag === 'body') {
      parts.unshift(tag)
      break
    }
    var id = node.getAttribute('id')
    if (typeof id === 'string' && IDENT.test(id)) {
      parts.unshift(tag + '#' + id)
      break
    }
    var part = tag
    var classes = String(node.getAttribute('class') || '').split(/\s+/)
    var used = 0
    for (var i = 0; i < classes.length && used < 2; i++) {
      if (IDENT.test(classes[i])) {
        part += '.' + classes[i]
        used++
      }
    }
    var parent = node.parentElement
    if (parent) {
      var same = 0
      var index = 0
      for (var sib = parent.firstElementChild; sib; sib = sib.nextElementSibling) {
        if (sib.localName === node.localName) {
          same++
          if (sib === node) index = same
        }
      }
      if (same > 1) part += ':nth-of-type(' + index + ')'
    }
    parts.unshift(part)
    node = parent
  }
  return parts.join(' > ')
}`

/** Global (in the picker's isolated world) through which a running pick is cancelled. */
const CANCEL_HOOK = '__yardarmPickCancel'

/**
 * Starts a pick and evaluates to a promise of either `{ cancelled: true }` or
 * the element description. Starting a second pick cancels the first.
 */
export const PICKER_SCRIPT = String.raw`(function () {
  if (typeof window.${CANCEL_HOOK} === 'function') window.${CANCEL_HOOK}()

  ${SELECTOR_PATH_SOURCE}

  var STYLE_KEYS = ${JSON.stringify(PICK_STYLE_KEYS)}
  var CLIP = ${JSON.stringify(IN_PAGE_CLIP)}

  function clip(value, max) {
    var s = typeof value === 'string' ? value : ''
    return s.length > max ? s.slice(0, max) : s
  }

  function describe(el) {
    var rect = el.getBoundingClientRect()
    var computed = window.getComputedStyle(el)
    var styles = {}
    for (var i = 0; i < STYLE_KEYS.length; i++) {
      styles[STYLE_KEYS[i]] = clip(computed.getPropertyValue(STYLE_KEYS[i]), CLIP.short)
    }
    var classes = String(el.getAttribute('class') || '').split(/\s+/).slice(0, 20)
    for (var j = 0; j < classes.length; j++) classes[j] = clip(classes[j], CLIP.short)
    var text = typeof el.innerText === 'string' ? el.innerText : el.textContent
    return {
      cancelled: false,
      selector: clip(selectorPath(el), CLIP.selector),
      tag: clip(String(el.localName || '').toLowerCase(), CLIP.short),
      id: clip(el.getAttribute('id'), CLIP.short),
      classes: classes,
      text: clip(String(text || '').replace(/\s+/g, ' ').trim(), CLIP.text),
      html: clip(el.outerHTML, CLIP.html),
      url: clip(String(window.location.href), CLIP.url),
      box: { x: rect.left, y: rect.top, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      styles: styles
    }
  }

  return new Promise(function (resolve) {
    var root = document.documentElement
    var overlay = document.createElement('div')
    overlay.style.cssText =
      'position:fixed;z-index:2147483647;pointer-events:none;box-sizing:border-box;' +
      'margin:0;padding:0;border:2px solid #3b82f6;border-radius:2px;' +
      'background:rgba(59,130,246,0.18);display:none;left:0;top:0;width:0;height:0'
    var previousCursor = root.style.cursor
    var current = null
    var done = false
    var releaseTimer = 0

    function elementAt(e) {
      var el = document.elementFromPoint(e.clientX, e.clientY)
      return el && el !== overlay ? el : current
    }

    function highlight() {
      if (!current) return
      var rect = current.getBoundingClientRect()
      overlay.style.display = 'block'
      overlay.style.left = rect.left + 'px'
      overlay.style.top = rect.top + 'px'
      overlay.style.width = rect.width + 'px'
      overlay.style.height = rect.height + 'px'
    }

    function swallow(e) {
      e.preventDefault()
      e.stopImmediatePropagation()
    }

    function choose(el) {
      var result = { cancelled: true }
      if (el) {
        try {
          result = describe(el)
        } catch (err) {}
      }
      finish(result)
    }

    function onMove(e) {
      current = elementAt(e)
      highlight()
    }

    // A click normally follows the release and selects. Disabled controls
    // never get a click event, so the release arms a short fallback.
    function onRelease(e) {
      swallow(e)
      var el = elementAt(e)
      clearTimeout(releaseTimer)
      releaseTimer = setTimeout(function () {
        choose(el)
      }, 120)
    }

    function onClick(e) {
      swallow(e)
      choose(elementAt(e))
    }

    function onKey(e) {
      if (e.key !== 'Escape') return
      swallow(e)
      finish({ cancelled: true })
    }

    var listeners = [
      ['mousemove', onMove],
      ['scroll', highlight],
      ['pointerup', onRelease],
      ['click', onClick],
      ['keydown', onKey],
      ['pointerdown', swallow],
      ['mousedown', swallow],
      ['mouseup', swallow],
      ['touchstart', swallow],
      ['touchend', swallow],
      ['dblclick', swallow],
      ['auxclick', swallow],
      ['contextmenu', swallow]
    ]

    function finish(result) {
      if (done) return
      done = true
      clearTimeout(releaseTimer)
      for (var i = 0; i < listeners.length; i++) {
        window.removeEventListener(listeners[i][0], listeners[i][1], true)
      }
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
      root.style.cursor = previousCursor
      delete window.${CANCEL_HOOK}
      // Give the overlay's removal a chance to paint before the main process
      // screenshots the element; the timer covers pages that aren't painting.
      window.requestAnimationFrame(function () {
        window.requestAnimationFrame(function () {
          resolve(result)
        })
      })
      setTimeout(function () {
        resolve(result)
      }, 250)
    }

    window.${CANCEL_HOOK} = function () {
      finish({ cancelled: true })
    }
    for (var i = 0; i < listeners.length; i++) {
      window.addEventListener(listeners[i][0], listeners[i][1], { capture: true, passive: false })
    }
    root.style.cursor = 'crosshair'
    root.appendChild(overlay)
  })
})()`

/** Cancels a running pick (no-op when none is active). Evaluates to undefined. */
export const PICKER_CANCEL_SCRIPT = `(function () {
  if (typeof window.${CANCEL_HOOK} === 'function') window.${CANCEL_HOOK}()
})()`
