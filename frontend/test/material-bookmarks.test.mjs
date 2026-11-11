import assert from 'node:assert/strict'
import { test, before, after } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'
import { createBookmarkState } from '../src/materials/bookmarkState.js'
const material = { _id: 'one', originalFilename: 'notes.pdf', fileType: 'pdf', tags: { course: 'CS', subject: 'OS', topic: 'Threads' } }
const parseResponse = async (response) => { if (!response.ok) throw new Error('Request failed'); return response.data }
const response = (materials = []) => ({ ok: true, data: { materials } })
let server, Actions, Library
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' })
  Actions = (await server.ssrLoadModule('/src/materials/MaterialActions.jsx')).default
  Library = (await server.ssrLoadModule('/src/materials/MaterialLibrary.jsx')).default
})
after(async () => { await server?.close() })
const render = (component, props) => renderToStaticMarkup(createElement(component, props))
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }

test('bookmark button exposes saved/unsaved state, pending and role restrictions', () => {
  for (const saved of [false, true]) {
    const bookmarks = { materials: saved ? [material] : [], hasLoaded: true, ready: true, loading: false, pending: [] }
    const markup = render(Actions, { material, canDownload: true, bookmarks })
    assert.match(markup, /aria-label="Bookmark notes.pdf"/)
    assert.match(markup, new RegExp(`aria-pressed="${saved}"`))
    assert.match(markup, saved ? /fill="currentColor"/ : /fill="none"/)
    assert.match(markup, /aria-label="View notes.pdf"/)
    assert.match(markup, /aria-label="Download notes.pdf"/)
    for (const state of [{ ...bookmarks, pending: ['one'] }, { ...bookmarks, ready: false }, { ...bookmarks, loading: true }]) {
      assert.match(render(Actions, { material, canDownload: true, bookmarks: state }), /aria-pressed="(?:true|false)"[^>]*disabled=""/)
    }
    assert.doesNotMatch(render(Actions, { material, canDownload: false, bookmarks }), /aria-label="Bookmark/)
  }
})
test('My Bookmarks reuses material actions and accessible loading, empty, error and success states', () => {
  const bookmarks = { materials: [], loading: false, hasLoaded: true, ready: true, error: '', message: '', pending: [] }
  const props = { role: 'student', bookmarksOnly: true, bookmarks }
  assert.match(render(Library, props), /My Bookmarks/)
  assert.match(render(Library, props), /No bookmarks yet/)
  assert.match(render(Library, { ...props, bookmarks: { ...bookmarks, hasLoaded: false, loading: true } }), /Loading study materials/)
  assert.match(render(Library, { ...props, bookmarks: { ...bookmarks, hasLoaded: false, ready: false, error: 'Unavailable' } }), /role="alert">Unavailable/)
  const populated = render(Library, { ...props, bookmarks: { ...bookmarks, materials: [material], message: 'Saved' } })
  assert.match(populated, /role="status">Saved/)
  for (const action of ['View', 'Download', 'Bookmark']) assert.match(populated, new RegExp(`aria-label="${action} notes.pdf"`))
})
test('shared state toggles, blocks duplicate pending clicks and sends authenticated idempotent methods', async () => {
  const write = deferred(); const calls = []
  const store = createBookmarkState({ token: 'student-token', apiBaseUrl: '', parseResponse, request: async (url, options) => {
    calls.push({ url, options }); return options.method ? write.promise : response()
  } })
  await store.load()
  const first = store.toggle(material)
  await store.toggle(material)
  assert.deepEqual(store.getSnapshot().pending, ['one'])
  assert.equal(calls.length, 2)
  write.resolve(response()); await first
  assert.equal(store.getSnapshot().materials[0]._id, 'one')
  assert.match(store.getSnapshot().message, /Bookmarked/)
  await store.toggle(material)
  assert.deepEqual(store.getSnapshot().materials, [])
  assert.deepEqual(calls.slice(1).map(({ options }) => options.method), ['PUT', 'DELETE'])
  assert.equal(calls[1].options.headers.Authorization, 'Bearer student-token')
})
test('older reads cannot overwrite mutations and disposed account responses cannot update state', async () => {
  const oldRead = deferred(); let reads = 0
  const store = createBookmarkState({ token: 'a', apiBaseUrl: '', parseResponse, request: async (_url, options) => {
    if (options.method) return response()
    return ++reads === 1 ? oldRead.promise : response()
  } })
  const oldLoad = store.load(); await store.load(); await store.toggle(material)
  oldRead.resolve(response()); await oldLoad
  assert.equal(store.getSnapshot().materials.length, 1)
  const pending = deferred()
  const previous = createBookmarkState({ token: 'a', apiBaseUrl: '', parseResponse, request: () => pending.promise })
  const loading = previous.load(); previous.dispose(); pending.resolve(response([material])); await loading
  assert.deepEqual(previous.getSnapshot().materials, [])
  const next = createBookmarkState({ token: 'b', apiBaseUrl: '', parseResponse, request: async () => response() })
  await next.load(); assert.deepEqual(next.getSnapshot().materials, [])
})
test('failed writes reconcile ambiguous outcomes and keep accessible error feedback', async () => {
  let reads = 0
  const store = createBookmarkState({ token: 'a', apiBaseUrl: '', parseResponse, request: async (_url, options) => {
    if (options.method) throw new Error('Connection lost')
    return response(++reads === 1 ? [] : [material])
  } })
  await store.load(); await store.toggle(material)
  assert.equal(store.getSnapshot().materials.length, 1)
  assert.equal(store.getSnapshot().error, 'Connection lost')
  assert.equal(store.getSnapshot().ready, true)
})

test('failed refresh disables mutations until retry and concurrent writes keep both results', async () => {
  let fail = true
  const writes = new Map()
  const store = createBookmarkState({ token: 'a', apiBaseUrl: '', parseResponse, request: async (url, options) => {
    if (!options.method) {
      if (fail) throw new Error('Unavailable')
      return response()
    }
    const waiting = deferred(); writes.set(url, waiting); return waiting.promise
  } })
  await store.load(); await store.toggle(material)
  assert.equal(store.getSnapshot().ready, false); assert.equal(writes.size, 0)
  fail = false; await store.load()
  const second = { ...material, _id: 'two' }
  const one = store.toggle(material); const two = store.toggle(second)
  writes.get('/api/materials/two/bookmark').resolve(response()); await two
  writes.get('/api/materials/one/bookmark').resolve(response()); await one
  assert.deepEqual(store.getSnapshot().materials.map((item) => item._id).sort(), ['one', 'two'])
  assert.deepEqual(store.getSnapshot().pending, [])
})
