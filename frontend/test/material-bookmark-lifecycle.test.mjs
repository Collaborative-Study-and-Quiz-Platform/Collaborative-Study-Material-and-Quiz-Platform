import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { act, createElement } from 'react'
import { Window } from 'happy-dom'
import { createServer } from 'vite'

const material = { _id: 'one', originalFilename: 'notes.pdf', fileType: 'pdf', downloadCount: 10,
  tags: { course: 'CS', subject: 'OS', topic: 'Threads' } }
const json = (materials = [material]) => new Response(JSON.stringify({ materials, count: materials.length }))
const parseResponse = async (response) => {
  if (!response.ok) throw new Error('Unable to load bookmarks.')
  return response.json()
}
const deferred = () => {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}
const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
const originalFetch = globalThis.fetch
let server, dom, createRoot, Library, useBookmarks, root, container, latest
const props = { token: 'student-token', studentId: 'student-a', apiBaseUrl: '', parseResponse, page: 'bookmarks' }

before(async () => {
  dom = new Window({ url: 'http://localhost/' })
  for (const name of ['window', 'document', 'HTMLElement', 'Node']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom : dom[name] })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' })
  Library = (await server.ssrLoadModule('/src/materials/MaterialLibrary.jsx')).default
  useBookmarks = (await server.ssrLoadModule('/src/materials/useBookmarks.js')).default
})
beforeEach(() => {
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  globalThis.fetch = async () => json()
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  globalThis.fetch = originalFetch
})
after(async () => {
  await server?.close()
  await dom.happyDOM.close()
  for (const name of ['window', 'document', 'HTMLElement', 'Node', 'IS_REACT_ACT_ENVIRONMENT']) delete globalThis[name]
})
function Harness({ both = false, ...options }) {
  const bookmarks = useBookmarks(options)
  latest = bookmarks
  const shared = { ...options, role: 'student', bookmarks }
  return both
    ? createElement('div', null,
      createElement(Library, { ...shared, key: 'browse' }),
      createElement(Library, { ...shared, key: 'bookmarks', bookmarksOnly: true }))
    : createElement(Library, { ...shared, bookmarksOnly: options.page === 'bookmarks' })
}
async function mount(options = props) {
  await act(async () => { root.render(createElement(Harness, options)); await tick() })
  await act(async () => { await tick() })
}
async function focus() {
  await act(async () => window.dispatchEvent(new dom.Event('focus')))
}

test('focus refresh preserves actions, preview, active download and disclosure nodes through success and failure', async () => {
  const download = deferred()
  let refresh, downloadSignal
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/download')) { downloadSignal = options.signal; return download.promise }
    if (url.endsWith('/view')) return new Response('%PDF-test')
    if (url.endsWith('/bookmarks') && refresh) return refresh.promise
    return json()
  }
  await mount()
  const actions = container.querySelector('.material-actions')
  const course = container.querySelector('.explorer-course')
  const subject = container.querySelector('.explorer-subject')
  const topic = container.querySelector('.explorer-topic')
  subject.open = true; topic.open = true
  await act(async () => container.querySelector('[aria-label="View notes.pdf"]').click())
  const dialog = container.querySelector('dialog')
  const previewFrame = dialog.querySelector('iframe')
  const previewUrl = previewFrame.src
  assert.equal(dialog.open, true)
  await act(async () => dialog.lastElementChild.click())
  assert.equal(downloadSignal.aborted, false)
  course.open = false
  refresh = deferred()
  await focus()
  assert.match(container.textContent, /Refreshing bookmarks/)
  assert.equal(container.querySelector('.material-actions'), actions)
  assert.equal(container.querySelector('dialog'), dialog)
  assert.equal(dialog.open, true)
  assert.equal(downloadSignal.aborted, false)
  assert.equal(dialog.querySelector('iframe'), previewFrame)
  assert.equal(previewFrame.src, previewUrl)
  await act(async () => { refresh.resolve(json()); await tick() })
  assert.equal(container.querySelector('.explorer-course'), course)
  assert.equal(course.open, false)
  assert.equal(subject.open, true)
  assert.equal(topic.open, true)
  assert.equal(container.querySelector('dialog'), dialog)
  refresh = deferred()
  await focus()
  await act(async () => { refresh.resolve(new Response('{}', { status: 500 })); await tick() })
  assert.match(container.querySelector('[role="alert"]').textContent, /Unable to load bookmarks/)
  assert.equal(container.querySelector('.material-actions'), actions)
  assert.equal(dialog.open, true)
  assert.equal(downloadSignal.aborted, false)
  assert.equal(container.querySelector('[aria-label="Bookmark notes.pdf"]').disabled, true)
  refresh = undefined
  await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry bookmarks').click(); await tick() })
  assert.equal(container.querySelector('[role="alert"]'), null)
  assert.equal(container.querySelector('.material-actions'), actions)
  assert.equal(course.open, false)
  await act(async () => { download.resolve(new Response('download bytes')); await new Promise((resolve) => setTimeout(resolve, 200)) })
  assert.equal(downloadSignal.aborted, false)
  assert.equal(container.querySelector('dialog'), dialog)
  assert.equal(dialog.lastElementChild.disabled, false)
})

test('initial loading/error remains blocking until retry succeeds', async () => {
  let read = deferred()
  globalThis.fetch = () => read.promise
  await mount()
  assert.match(container.textContent, /Loading study materials/)
  assert.equal(container.querySelector('.material-explorer'), null)
  await act(async () => { read.resolve(new Response('{}', { status: 500 })); await tick() })
  assert.equal(container.querySelector('.material-explorer'), null)
  assert.equal(container.querySelector('.empty-state'), null)
  assert.match(container.querySelector('[role="alert"]').textContent, /Unable to load bookmarks/)
  read = deferred()
  await act(async () => [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry bookmarks').click())
  assert.match(container.textContent, /Loading study materials/)
  await act(async () => { read.resolve(json([])); await tick() })
  assert.match(container.textContent, /No bookmarks yet/)
})

test('download responses reconcile both rendered views and stale responses cannot lower counts', async () => {
  let count = 10
  let bookmarkCount = 10
  globalThis.fetch = async (url) => {
    if (url.endsWith('/download')) return new Response('download bytes')
    return json([{ ...material, downloadCount: url.endsWith('/bookmarks') ? bookmarkCount : count }])
  }
  await mount({ ...props, page: 'browse', both: true })
  const counts = () => [...container.querySelectorAll('.material-row-content p')].map((p) => p.textContent.match(/\d+ downloads/)[0])
  assert.deepEqual(counts(), ['10 downloads', '10 downloads'])
  count = 21
  const browseDownload = container.querySelector('[aria-label="Download notes.pdf"]')
  await act(async () => { browseDownload.click(); await new Promise((resolve) => setTimeout(resolve, 200)) })
  assert.deepEqual(counts(), ['21 downloads', '21 downloads'])
  count = 12
  await act(async () => { browseDownload.click(); await new Promise((resolve) => setTimeout(resolve, 200)) })
  assert.deepEqual(counts(), ['22 downloads', '22 downloads'])
  bookmarkCount = 9
  await focus()
  await act(async () => { await tick() })
  assert.equal(latest.materials[0].downloadCount, 22)
  assert.deepEqual(counts(), ['22 downloads', '22 downloads'])
  // A download initiated in My Bookmarks must also reconcile its rendered count.
  count = 30
  await act(async () => { container.querySelectorAll('[aria-label="Download notes.pdf"]')[1].click(); await new Promise((resolve) => setTimeout(resolve, 200)) })
  assert.equal(latest.materials[0].downloadCount, 30)
  assert.deepEqual(counts(), ['30 downloads', '30 downloads'])
})

test('token transition issues one read; navigation/focus revalidate and account changes reject old responses', async () => {
  const calls = []
  const nextAccount = deferred()
  let delayed
  globalThis.fetch = async (url, options = {}) => {
    if (url.endsWith('/bookmarks')) {
      calls.push({ token: options.headers.Authorization, signal: options.signal })
      if (delayed) return delayed.promise
      return options.headers.Authorization === 'Bearer student-b-token' ? nextAccount.promise : json()
    }
    return json()
  }
  await mount()
  assert.equal(calls.length, 1)
  await mount({ ...props, token: 'refreshed-token' })
  assert.equal(calls.length, 2)
  assert.equal(calls[1].token, 'Bearer refreshed-token')
  await mount({ ...props, token: 'refreshed-token', page: 'browse' })
  assert.equal(calls.length, 3)
  delayed = deferred()
  await focus()
  assert.equal(calls.length, 4)
  const old = delayed
  delayed = undefined
  await mount({ ...props, token: 'student-b-token', studentId: 'student-b' })
  assert.equal(calls.length, 5)
  assert.equal(calls[3].signal.aborted, true)
  assert.equal(container.querySelector('.material-row'), null)
  assert.match(container.textContent, /Loading study materials/)
  await act(async () => { old.resolve(json([material])); await tick() })
  assert.equal(container.querySelector('.material-row'), null)
  assert.deepEqual(latest.materials, [])
  await act(async () => { nextAccount.resolve(json([])); await tick() })
  assert.match(container.textContent, /No bookmarks yet/)
  await mount({ ...props, token: undefined, studentId: null })
  assert.equal(calls.length, 5)
  await focus()
  assert.equal(calls.length, 5)
})
