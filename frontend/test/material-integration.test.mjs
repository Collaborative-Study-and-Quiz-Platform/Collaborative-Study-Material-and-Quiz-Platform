import assert from 'node:assert/strict'
import { before, after, beforeEach, afterEach, test } from 'node:test'
import { Window } from 'happy-dom'
import { createServer } from 'vite'
import { createBookmarkState } from '../src/materials/bookmarkState.js'
const dom = new Window({ url: 'http://localhost' })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent']) globalThis[key] = key === 'window' ? dom : dom[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createElement: h, useSyncExternalStore, act } = await import('react')
const { createRoot } = await import('react-dom/client')
const zero = { averageRating: null, ratingCount: 0, myRating: null }
const five = { averageRating: 5, ratingCount: 1, myRating: 5 }
const three = { averageRating: 3, ratingCount: 2, myRating: 5 }
const material = { _id: 'material-one', originalFilename: 'notes.pdf', fileType: 'pdf', tags: { course: 'CS', subject: 'OS', topic: 'Threads' }, ratingSummary: zero }
const response = (data) => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } })
const parseResponse = (res) => res.json()
const deferred = () => { let resolve; const promise = new Promise((r) => { resolve = r }); return { promise, resolve } }
let server, Library, host, root, store
const originalFetch = globalThis.fetch
const tick = async () => act(async () => { await new Promise((r) => setTimeout(r, 20)) })
const click = async (node) => { assert.ok(node); await act(async () => node.click()) }
function Harness({ page = 'browse', role = 'student' }) {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  const bookmarks = { ...state, toggle: store.toggle, downloaded: store.downloaded, reload: store.load,
    rated: store.rated, beginRatingRead: store.beginRatingRead, mergeRatingRead: store.mergeRatingRead }
  return h(Library, { key: page, token: 'session', apiBaseUrl: '', parseResponse, role,
    bookmarks: role === 'student' ? bookmarks : undefined, bookmarksOnly: page === 'bookmarks' })
}
async function mount(page = 'browse', role = 'student') { await act(async () => root.render(h(Harness, { page, role }))); await tick() }
const average = () => host.querySelector('.material-rating-average')?.getAttribute('aria-label')
before(async () => { server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' }); Library = (await server.ssrLoadModule('/src/materials/MaterialLibrary.jsx')).default })
beforeEach(async () => {
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
  globalThis.fetch = async (url, options = {}) => String(url).includes('/rating')
    ? response(five) : response({ materials: [material], count: 1, comments: [], nextCursor: null })
  store = createBookmarkState({ token: 'session', apiBaseUrl: '', parseResponse, request: (...args) => globalThis.fetch(...args) }); await store.load()
})
afterEach(async () => { await act(async () => root.unmount()); store.dispose(); host.remove(); globalThis.fetch = originalFetch })
after(async () => { await server?.close(); await dom.happyDOM.close() })
async function rate() {
  await click(host.querySelector('[aria-label="Rate notes.pdf"]'))
  await click(host.querySelector('input[value="5"]'))
  await act(async () => host.querySelector('.material-rating-panel form').dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true })))
}

test('rating in Browse and Bookmarks synchronizes summaries and preserves comments and row state', async () => {
  await mount()
  for (const label of ['View notes.pdf', 'Download notes.pdf', 'Bookmark notes.pdf', 'Comments on notes.pdf', 'Rate notes.pdf']) assert.ok(host.querySelector(`[aria-label="${label}"]`))
  await click(host.querySelector('[aria-label="Comments on notes.pdf"]')); await tick()
  const row = host.querySelector('.material-row'); const subject = host.querySelector('.explorer-subject'); subject.open = true
  await rate(); assert.equal(average(), '5.0 out of 5, 1 rating')
  assert.equal(host.querySelector('.material-row'), row); assert.equal(subject.open, true)
  assert.equal(host.querySelector('[aria-label="Comments on notes.pdf"]').getAttribute('aria-expanded'), 'true')
  await mount('bookmarks'); assert.equal(average(), '5.0 out of 5, 1 rating'); assert.ok(host.querySelector('input[value="5"]').checked)
  globalThis.fetch = async () => response(three)
  await rate(); assert.equal(average(), '3.0 out of 5, 2 ratings')
  // A subsequent Browse read should return the current server summary.
  globalThis.fetch = async () => response({ materials: [{ ...material, ratingSummary: three }], count: 1 })
  await mount('browse'); assert.equal(average(), '3.0 out of 5, 2 ratings')
})

test('late bookmark refresh cannot overwrite a confirmed rating; later refresh accepts server updates', async () => {
  await mount('bookmarks'); const read = deferred()
  globalThis.fetch = async (url) => String(url).endsWith('/bookmarks') ? read.promise : response(five)
  let pending; await act(async () => { pending = store.load() })
  await rate(); assert.equal(average(), '5.0 out of 5, 1 rating')
  await act(async () => { read.resolve(response({ materials: [material] })); await pending })
  assert.equal(average(), '5.0 out of 5, 1 rating'); assert.equal(store.getSnapshot().materials[0].ratingSummary.myRating, 5)
  globalThis.fetch = async () => response({ materials: [{ ...material, ratingSummary: three }] })
  await act(async () => store.load()); assert.equal(average(), '3.0 out of 5, 2 ratings')
})

test('late Browse search cannot overwrite rating confirmed after the search started', async () => {
  await mount(); const read = deferred()
  globalThis.fetch = async (url) => String(url).includes('/rating') ? response(five) : read.promise
  await act(async () => host.querySelector('.library-filters').dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true })))
  // The existing rows are hidden during a foreground search; confirmation can also arrive from another view.
  await act(async () => store.rated(material._id, five))
  await act(async () => read.resolve(response({ materials: [material], count: 1 })))
  assert.equal(average(), '5.0 out of 5, 1 rating')
})

test('instructor retains View, Edit/Delete, Comments and read-only Rating controls', async () => {
  await mount('browse', 'instructor')
  for (const label of ['View notes.pdf', 'Edit notes.pdf', 'Delete notes.pdf', 'Comments on notes.pdf']) assert.ok(host.querySelector(`[aria-label="${label}"]`))
  for (const label of ['Download notes.pdf', 'Bookmark notes.pdf', 'Rate notes.pdf']) assert.equal(host.querySelector(`[aria-label="${label}"]`), null)
  assert.equal(average(), 'No ratings yet')
})

test('rating confirmations for unbookmarked materials survive bookmark additions and reads', async () => {
  const read = deferred(); const state = createBookmarkState({ token: 's', apiBaseUrl: '', parseResponse, request: async () => read.promise })
  const pending = state.load(); state.rated(material._id, five)
  read.resolve(response({ materials: [material] })); await pending
  assert.deepEqual(state.getSnapshot().materials[0].ratingSummary, five)
  state.dispose()
  const fresh = createBookmarkState({ token: 'new', apiBaseUrl: '', parseResponse })
  assert.deepEqual(fresh.getSnapshot().ratingSummaries, {}); fresh.dispose()
})

test('new server votes update radio selection without discarding an unchanged-vote draft', async () => {
  await mount('bookmarks')
  await click(host.querySelector('[aria-label="Rate notes.pdf"]'))
  await click(host.querySelector('input[value="4"]'))
  await act(async () => store.rated(material._id, { ...three, myRating: null }))
  assert.equal(host.querySelector('input:checked').value, '4')
  await act(async () => store.rated(material._id, { ...three, myRating: 2 }))
  assert.equal(host.querySelector('input:checked').value, '2')
})

async function openRatingWithVote(summary = five) {
  store.rated(material._id, summary)
  await mount('bookmarks')
  await click(host.querySelector('[aria-label="Rate notes.pdf"]'))
  await click(host.querySelector('input[value="4"]'))
}
const checkedVote = () => host.querySelector('input:checked')?.value ?? null
const publishVote = (myRating) => act(async () => store.rated(material._id, { ...three, myRating }))
const submitRating = () => act(async () => host.querySelector('.material-rating-panel form')
  .dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true })))

test('confirmed votes 5 -> 2 -> 5 never resurrect an unsubmitted draft of 4', async () => {
  await openRatingWithVote()
  assert.equal(checkedVote(), '4')
  await publishVote(2)
  assert.equal(checkedVote(), '2')
  await publishVote(5)
  assert.equal(checkedVote(), '5')
})

test('confirmed unrated -> rated -> unrated transitions discard stale drafts', async () => {
  await openRatingWithVote(zero)
  assert.equal(checkedVote(), '4')
  await publishVote(2)
  assert.equal(checkedVote(), '2')
  await publishVote(null)
  assert.equal(checkedVote(), null)
  assert.equal(host.querySelector('button[type="submit"]').disabled, true)
  await publishVote(5)
  await click(host.querySelector('input[value="4"]'))
  await publishVote(null)
  await publishVote(5)
  assert.equal(checkedVote(), '5')
})

test('unchanged votes preserve drafts across summary updates and unavailable-summary recovery', async () => {
  await openRatingWithVote()
  await publishVote(5)
  assert.equal(checkedVote(), '4')
  await act(async () => store.rated(material._id, null))
  assert.equal(checkedVote(), '4')
  await publishVote(5)
  assert.equal(checkedVote(), '4')
  await publishVote(2)
  assert.equal(checkedVote(), '2')
})

test('asynchronous rating refresh with an unchanged confirmed vote preserves the draft', async () => {
  await openRatingWithVote()
  const read = deferred()
  globalThis.fetch = async () => read.promise
  await click([...host.querySelectorAll('button')].find((button) => button.textContent === 'Refresh rating'))
  assert.equal(checkedVote(), '4')
  await act(async () => read.resolve(response(three)))
  assert.equal(checkedVote(), '4')
  assert.equal(average(), '3.0 out of 5, 2 ratings')
})

test('pending submission keeps its payload and applies its confirmed result after external vote changes', async () => {
  await openRatingWithVote()
  const write = deferred()
  const payloads = []
  globalThis.fetch = async (_url, options) => { payloads.push(JSON.parse(options.body)); return write.promise }
  await submitRating()
  assert.equal(host.querySelector('fieldset').disabled, true)
  await publishVote(2)
  await publishVote(5)
  assert.equal(checkedVote(), '5')
  await submitRating()
  assert.deepEqual(payloads, [{ rating: 4 }])
  await act(async () => write.resolve(response({ averageRating: 4, ratingCount: 1, myRating: 4 })))
  assert.equal(checkedVote(), '4')
  assert.equal(host.querySelector('fieldset').disabled, false)
  assert.match(host.textContent, /Rating saved/)
  await publishVote(5)
  assert.equal(checkedVote(), '5')
})

for (const changed of [false, true]) test(`failed submission ${changed ? 'does not restore an invalidated draft' : 'preserves a draft when the confirmed vote is unchanged'}`, async () => {
  await openRatingWithVote()
  let fail
  const write = new Promise((_resolve, reject) => { fail = reject })
  let calls = 0
  globalThis.fetch = async () => { ++calls; return write }
  await submitRating()
  if (changed) { await publishVote(2); await publishVote(5) }
  else await publishVote(5)
  await act(async () => fail(new Error('Network failure')))
  assert.equal(checkedVote(), changed ? '5' : '4')
  assert.equal(host.querySelector('fieldset').disabled, false)
  assert.match(host.textContent, /Unable to confirm rating/)
  assert.equal(calls, 1)
})
