import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { act, createElement } from 'react'
import { Window } from 'happy-dom'
import { createServer } from 'vite'

const material = { _id: 'one', originalFilename: 'notes.pdf', fileType: 'pdf', downloadCount: 8,
  tags: { course: 'CS', subject: 'OS', topic: 'Threads' } }
const existing = { _id: 'c1', material: 'one', author: { _id: 'student', name: 'Alice' }, content: 'Existing comment',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
const page = (comments = [], nextCursor = null) => json({ comments, nextCursor, hasMore: Boolean(nextCursor) })
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail }); return { promise, resolve, reject } }
const tick = () => new Promise((resolve) => setTimeout(resolve, 10))
const parseResponse = async (response) => {
  const data = await response.json()
  if (!response.ok) { const error = new Error(data.message || 'Request failed'); error.status = response.status; throw error }
  return data
}
const props = { role: 'student', token: 'student-token', apiBaseUrl: '', parseResponse }
const originalFetch = globalThis.fetch
let dom, server, Library, Panel, createRoot, root, container, calls, comments, serial
before(async () => {
  dom = new Window({ url: 'http://localhost/' })
  for (const name of ['window', 'document', 'HTMLElement', 'Node']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom : dom[name] })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' })
  Library = (await server.ssrLoadModule('/src/materials/MaterialLibrary.jsx')).default
  Panel = (await server.ssrLoadModule('/src/materials/MaterialComments.jsx')).default
})
beforeEach(() => {
  calls = []; comments = []; serial = 1
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, ...options })
    if (new URL(url, 'http://localhost').pathname.endsWith('/comments')) {
      if (options.method === 'POST') {
        const comment = { ...existing, _id: `new-${++serial}`, content: JSON.parse(options.body).content }
        comments = [comment, ...comments]
        return json({ comment, message: 'Comment posted' }, 201)
      }
      return page(comments)
    }
    if (url.endsWith('/view')) return new Response('%PDF-test')
    return json({ materials: [material, { ...material, _id: 'two', originalFilename: 'other.pdf' }], count: 2 })
  }
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove(); globalThis.fetch = originalFetch
})
after(async () => {
  await server?.close(); await dom.happyDOM.close()
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[name]
})
async function mountLibrary(options = props) {
  await act(async () => root.render(createElement(Library, options)))
  await act(async () => { await tick() })
}
async function mountPanel(options = {}) {
  const selected = { ...props, materialId: 'one', panelId: 'test-comments', ...options }
  await act(async () => root.render(createElement(Panel, { ...selected, key: `${selected.materialId}-${selected.token}` })))
  await act(async () => { await tick() })
}
async function clickLabel(label) {
  await act(async () => container.querySelector(`[aria-label="${label}"]`).click())
  await act(async () => { await tick() })
}
async function clickText(text) {
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === text).click())
  await act(async () => { await tick() })
}
async function type(text, selector = '.material-comments textarea') {
  await act(async () => {
    const input = container.querySelector(selector)
    const prototype = input.tagName === 'TEXTAREA' ? dom.HTMLTextAreaElement.prototype : dom.HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(input, text)
    input.dispatchEvent(new dom.Event('input', { bubbles: true }))
  })
}
async function submit(selector = '.material-comments form') {
  await act(async () => { container.querySelector(selector).dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true })); await tick() })
}
const entries = () => [...container.querySelectorAll('.material-comment-text')].map((element) => element.textContent)
const posts = () => calls.filter((call) => call.method === 'POST')

test('comments are lazy, row-local and accessible; students and instructors retain existing file restrictions', async () => {
  await mountLibrary()
  assert.equal(calls.filter((call) => call.url.includes('/comments')).length, 0)
  const toggle = container.querySelector('[aria-label="Comments on notes.pdf"]')
  assert.equal(toggle.getAttribute('aria-expanded'), 'false')
  assert.equal(document.getElementById(toggle.getAttribute('aria-controls')).hidden, true)
  await clickLabel('Comments on notes.pdf')
  assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  const panel = container.querySelector('.material-comments')
  const controlled = document.getElementById(toggle.getAttribute('aria-controls'))
  assert.equal(controlled.hidden, false)
  assert.equal(controlled.contains(panel), true)
  assert.match(panel.textContent, /No comments yet/)
  assert.equal(container.querySelectorAll('.material-comments').length, 1)
  assert.equal(panel.closest('.material-row').querySelector('h4').textContent, 'notes.pdf')
  const textarea = panel.querySelector('textarea')
  assert.equal(panel.querySelector('label').htmlFor, textarea.id)
  assert.equal(textarea.maxLength, 2000)
  assert.ok(container.querySelector('[aria-label="Download notes.pdf"]'))
  await clickLabel('Comments on notes.pdf')
  assert.equal(container.querySelector('.material-comments'), null)
  await mountLibrary({ ...props, role: 'instructor' })
  assert.ok(container.querySelector('[aria-label="Comments on notes.pdf"]'))
  assert.equal(container.querySelector('[aria-label="Download notes.pdf"]'), null)
  await mountLibrary({ ...props, role: 'admin' })
  assert.equal(container.querySelector('[aria-label="Comments on notes.pdf"]'), null)
})
test('initial loading, failure and retry are distinct from an empty successful page', async () => {
  let read = deferred()
  globalThis.fetch = () => read.promise
  await mountPanel()
  assert.match(container.textContent, /Loading comments/)
  assert.doesNotMatch(container.textContent, /No comments yet/)
  await act(async () => { read.resolve(json({ message: 'Load failed' }, 500)); await tick() })
  assert.match(container.querySelector('[role="alert"]').textContent, /Load failed/)
  assert.doesNotMatch(container.textContent, /No comments yet/)
  read = deferred()
  await clickText('Retry comments')
  await act(async () => { read.resolve(page()); await tick() })
  assert.match(container.textContent, /No comments yet/)
})
test('POST immediately prepends the confirmed comment without reload and clears the successful draft', async () => {
  comments = [existing]
  await mountPanel(); await type('  A new explanation  ')
  const before = calls.length
  await submit()
  assert.deepEqual(entries(), ['A new explanation', 'Existing comment'])
  assert.equal(container.querySelector('textarea').value, '')
  assert.match(container.textContent, /Comment posted/)
  assert.match(container.textContent, /Alice/)
  assert.ok(container.querySelector('time[datetime]'))
  assert.equal(calls.length - before, 1)
  assert.deepEqual(JSON.parse(posts()[0].body), { content: 'A new explanation' })
  assert.equal(posts()[0].headers.Authorization, 'Bearer student-token')
})
test('pending POST guards duplicate submissions and preserves the draft after a validation error', async () => {
  await mountPanel(); await type('Keep my draft')
  const waiting = deferred(); let attempts = 0
  globalThis.fetch = async (_url, options = {}) => { if (options.method === 'POST') ++attempts; return waiting.promise }
  await submit(); await submit()
  assert.equal(attempts, 1)
  assert.equal(container.querySelector('textarea').disabled, true)
  assert.equal(container.querySelector('[type="submit"]').disabled, true)
  await act(async () => { waiting.resolve(json({ message: 'Please revise this comment' }, 400)); await tick() })
  assert.equal(container.querySelector('textarea').value, 'Keep my draft')
  assert.equal(container.querySelector('textarea').disabled, false)
  assert.match(container.querySelector('[role="alert"]').textContent, /Please revise/)
  assert.equal(attempts, 1)
})
test('ambiguous network failure is never automatically reposted; refresh can reveal the saved comment', async () => {
  await mountPanel(); await type('Saved before the response was lost')
  const normal = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    const result = await normal(url, options)
    if (options.method === 'POST') throw new TypeError('Connection lost')
    return result
  }
  await submit(); await act(async () => { await tick() })
  assert.equal(posts().length, 1)
  assert.equal(container.querySelector('textarea').value, 'Saved before the response was lost')
  assert.match(container.querySelector('[role="alert"]').textContent, /Refresh comments before retrying/)
  await clickText('Refresh comments')
  assert.deepEqual(entries(), ['Saved before the response was lost'])
  assert.equal(posts().length, 1)
})
test('refresh and older-page loading are bounded, deduplicated and leave confirmed data on errors', async () => {
  let fail = false
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, ...options })
    if (fail) return json({ message: 'Refresh unavailable' }, 500)
    const cursor = new URL(url, 'http://localhost').searchParams.get('cursor')
    return cursor ? page([existing, { ...existing, _id: 'older', content: 'Older comment' }]) : page([existing], 'older-page')
  }
  await mountPanel(); await type('Unsaved draft')
  await clickText('Load older comments')
  assert.deepEqual(entries(), ['Existing comment', 'Older comment'])
  assert.equal(new URL(calls[1].url, 'http://localhost').searchParams.get('cursor'), 'older-page')
  assert.equal(new URL(calls[1].url, 'http://localhost').searchParams.get('limit'), '20')
  fail = true; await clickText('Refresh comments')
  assert.deepEqual(entries(), ['Existing comment', 'Older comment'])
  assert.equal(container.querySelector('textarea').value, 'Unsaved draft')
  assert.match(container.querySelector('[role="alert"]').textContent, /Refresh unavailable/)
})
test('a stale refresh cannot replace a newly posted comment or corrupt its older-page cursor', async () => {
  comments = [existing]
  const normal = globalThis.fetch
  let refresh; let readSignal
  globalThis.fetch = async (url, options = {}) => {
    if (!options.method && refresh) { readSignal = options.signal; return refresh.promise }
    if (!options.method) return page([existing], 'older-page')
    return normal(url, options)
  }
  await mountPanel(); await type('New confirmed comment')
  refresh = deferred(); await clickText('Refresh comments')
  await submit()
  assert.equal(readSignal.aborted, true)
  await act(async () => { refresh.resolve(page([])); await tick() })
  assert.deepEqual(entries(), ['New confirmed comment', 'Existing comment'])
  assert.ok([...container.querySelectorAll('button')].some((button) => button.textContent === 'Load older comments'))
})
test('plain text rendering never creates markup and missing authors have a safe fallback', async () => {
  const text = '<img src=x onerror=alert(1)> **plain text**\n<b>not bold</b>'
  comments = [{ ...existing, author: null, content: text }]
  await mountPanel()
  assert.deepEqual(entries(), [text])
  assert.equal(container.querySelector('.material-comment-list img'), null)
  assert.equal(container.querySelector('.material-comment-list b'), null)
  assert.match(container.textContent, /Former user/)
})
test('missing parent disables posting and refresh instead of displaying an empty discussion', async () => {
  globalThis.fetch = async () => json({ message: 'Material not found' }, 404)
  await mountPanel()
  assert.match(container.querySelector('[role="alert"]').textContent, /Material is no longer available/)
  assert.equal(container.querySelector('textarea').disabled, true)
  assert.equal(container.querySelector('[type="submit"]').disabled, true)
  assert.doesNotMatch(container.textContent, /No comments yet/)
})
test('material/session changes cancel old reads, reset drafts and reject stale responses', async () => {
  comments = [existing]
  await mountPanel(); await type('Private old draft')
  const old = deferred(); let oldSignal
  globalThis.fetch = async (_url, options) => { oldSignal = options.signal; return old.promise }
  await clickText('Refresh comments')
  const next = deferred()
  globalThis.fetch = async () => next.promise
  await mountPanel({ materialId: 'two', token: 'new-session-token' })
  assert.equal(oldSignal.aborted, true)
  assert.deepEqual(entries(), [])
  assert.equal(container.querySelector('textarea').value, '')
  await act(async () => { old.resolve(page([existing])); await tick() })
  assert.deepEqual(entries(), [])
  await act(async () => { next.resolve(page([{ ...existing, _id: 'new', content: 'New session material' }])); await tick() })
  assert.deepEqual(entries(), ['New session material'])
})
test('closing the panel aborts an in-flight POST and ignores its eventual response', async () => {
  await mountLibrary(); await clickLabel('Comments on notes.pdf'); await type('Pending comment')
  const waiting = deferred(); let signal
  globalThis.fetch = async (_url, options) => { signal = options.signal; return waiting.promise }
  await submit(); await clickLabel('Comments on notes.pdf')
  assert.equal(signal.aborted, true)
  await act(async () => { waiting.resolve(json({ comment: { ...existing, content: 'Late response' } }, 201)); await tick() })
  assert.equal(container.querySelector('.material-comments'), null)
  assert.doesNotMatch(container.textContent, /Late response/)
})
test('comment interactions preserve material filters, disclosure nodes, preview and an active download', async () => {
  await mountLibrary(); await type('pdf', '#material-keyword'); await submit('.library-filters')
  const sections = [...container.querySelectorAll('details')]
  sections.forEach((section) => { section.open = true })
  const actions = container.querySelectorAll('.material-actions')[1]
  await clickLabel('View other.pdf')
  const preview = container.querySelector('.material-preview')
  const normal = globalThis.fetch; const download = deferred(); let signal
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/download')) { signal = options.signal; return download.promise }
    return normal(url, options)
  }
  await clickLabel('Download other.pdf')
  const reads = calls.filter((call) => !call.url.includes('/comments')).length
  await clickLabel('Comments on notes.pdf'); await type('Discussion without navigation'); await submit(); await clickText('Refresh comments')
  assert.equal(container.querySelector('#material-keyword').value, 'pdf')
  assert.equal(container.querySelectorAll('.material-actions')[1], actions)
  assert.equal(container.querySelector('.material-preview'), preview)
  assert.equal(preview.open, true)
  assert.equal(signal.aborted, false)
  for (const section of sections) { assert.equal(section.isConnected, true); assert.equal(section.open, true) }
  assert.equal(calls.filter((call) => !call.url.includes('/comments')).length, reads)
  await act(async () => { download.resolve(new Response('download bytes')); await new Promise((resolve) => setTimeout(resolve, 200)) })
  assert.equal(signal.aborted, false)
})

test('a parent 404 during an in-flight POST remains authoritative over a late 201 response', async () => {
  comments = [existing]
  await mountPanel(); await type('Racing with removal')
  const read = deferred(); const write = deferred()
  globalThis.fetch = async (_url, options = {}) => options.method === 'POST' ? write.promise : read.promise
  await clickText('Refresh comments'); await submit()
  await act(async () => { read.resolve(json({ message: 'Material not found' }, 404)); await tick() })
  await act(async () => { write.resolve(json({ comment: { ...existing, _id: 'late', content: 'Late creation' } }, 201)); await tick() })
  assert.deepEqual(entries(), [])
  assert.match(container.querySelector('[role="alert"]').textContent, /Material is no longer available/)
  assert.equal(container.querySelector('textarea').disabled, true)
  assert.doesNotMatch(container.textContent, /Comment posted/)
})

for (const outcome of ['success', 'HTTP failure', 'network failure']) {
  test(`POST 404 remains terminal after a pending GET ${outcome}`, async () => {
    comments = [existing]
    await mountPanel(); await type('Draft while removal races')
    const read = deferred(); const write = deferred()
    let readSignal, writes = 0
    globalThis.fetch = async (_url, options = {}) => {
      if (options.method === 'POST') { ++writes; return write.promise }
      readSignal = options.signal
      return read.promise
    }
    await clickText('Refresh comments'); await submit()
    assert.match(container.textContent, /Refreshing comments/)
    await act(async () => { write.resolve(json({ message: 'Material not found' }, 404)); await tick() })
    const assertTerminal = () => {
      assert.deepEqual(entries(), [])
      assert.equal(container.querySelector('[role="alert"]').textContent, 'Material is no longer available.')
      assert.equal(container.querySelector('textarea').disabled, true)
      assert.equal(container.querySelector('textarea').value, 'Draft while removal races')
      assert.equal(container.querySelector('[type="submit"]').disabled, true)
      assert.equal([...container.querySelectorAll('button')].find((button) => button.textContent === 'Refresh comments').disabled, true)
      assert.doesNotMatch(container.textContent, /Loading comments|Refreshing comments|Posting comment|Comment posted|No comments yet|Load older comments/)
    }
    assert.equal(readSignal.aborted, true)
    assertTerminal()
    // The fake transport ignores AbortSignal so late handlers really execute.
    await act(async () => {
      if (outcome === 'success') read.resolve(page([existing], 'stale-cursor'))
      else if (outcome === 'HTTP failure') read.resolve(json({ message: 'Stale read failed' }, 500))
      else read.reject(new TypeError('Stale network failure'))
      await tick()
    })
    assertTerminal()
    await submit()
    assert.equal(writes, 1)
  })
}

for (const [scope, options] of [['material', { materialId: 'two' }], ['session', { token: 'new-session-token' }]]) {
  test(`a fresh ${scope} can load normally after terminal unavailability while the old GET finishes`, async () => {
    comments = [existing]
    await mountPanel(); await type('Old scope draft')
    const oldRead = deferred(); const write = deferred()
    globalThis.fetch = async (_url, request = {}) => request.method === 'POST' ? write.promise : oldRead.promise
    await clickText('Refresh comments'); await submit()
    await act(async () => { write.resolve(json({ message: 'Material not found' }, 404)); await tick() })
    assert.match(container.querySelector('[role="alert"]').textContent, /Material is no longer available/)
    const freshRead = deferred()
    globalThis.fetch = async () => freshRead.promise
    await mountPanel(options)
    const assertFreshLoading = () => {
      assert.deepEqual(entries(), [])
      assert.equal(container.querySelector('[role="alert"]'), null)
      assert.equal(container.querySelector('textarea').value, '')
      assert.match(container.textContent, /Loading comments/)
      assert.equal(container.querySelector('[type="submit"]').disabled, true)
    }
    assertFreshLoading()
    await act(async () => { oldRead.resolve(page([existing])); await tick() })
    assertFreshLoading()
    await act(async () => { freshRead.resolve(page([{ ...existing, _id: 'fresh', content: 'Fresh discussion' }])); await tick() })
    assert.deepEqual(entries(), ['Fresh discussion'])
    assert.equal(container.querySelector('textarea').disabled, false)
    await type('New scope draft')
    assert.equal(container.querySelector('[type="submit"]').disabled, false)
    assert.doesNotMatch(container.textContent, /Loading comments|Material is no longer available/)
  })
}

test('a late POST error cannot overwrite a GET-confirmed unavailable message', async () => {
  comments = [existing]
  await mountPanel(); await type('Racing draft')
  const read = deferred(); const write = deferred()
  globalThis.fetch = async (_url, options = {}) => options.method === 'POST' ? write.promise : read.promise
  await clickText('Refresh comments'); await submit()
  await act(async () => { read.resolve(json({ message: 'Material not found' }, 404)); await tick() })
  await act(async () => { write.resolve(json({ message: 'Late server failure' }, 500)); await tick() })
  assert.deepEqual(entries(), [])
  assert.equal(container.querySelector('[role="alert"]').textContent, 'Material is no longer available.')
  assert.equal(container.querySelector('textarea').disabled, true)
  assert.doesNotMatch(container.textContent, /Late server failure|Refreshing comments|Posting comment/)
})
