import assert from 'node:assert/strict'
import { after, before, beforeEach, afterEach, test } from 'node:test'
import { Window } from 'happy-dom'
import { createServer } from 'vite'
const dom = new Window({ url: 'http://localhost' })
for (const key of ['window', 'document', 'HTMLElement', 'HTMLInputElement', 'Node', 'Event', 'MouseEvent']) globalThis[key] = key === 'window' ? dom : dom[key]
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createElement: h, useState, act } = await import('react')
const { createRoot } = await import('react-dom/client')
let server, Rating, Library, root, host, calls
const originalFetch = globalThis.fetch
const zero = { averageRating: null, ratingCount: 0, myRating: null }
const material = { _id: 'material-one', originalFilename: 'notes.pdf', fileType: 'pdf', mimeType: 'application/pdf', tags: { course: 'CS', subject: 'Algorithms', topic: 'Trees' }, downloadCount: 10 }
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
async function parseResponse(res) { const data = await res.json(); if (!res.ok) throw Object.assign(new Error(data.message || 'Request failed'), { status: res.status }); return data }
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
const tick = async (ms = 0) => { await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)) }) }
async function click(node) { assert.ok(node, 'control exists'); await act(async () => { node.click() }) }
const button = (text) => [...host.querySelectorAll('button')].find((b) => b.textContent === text)
const panel = () => host.querySelector('.material-rating-panel')
const average = () => host.querySelector('.material-rating-average').getAttribute('aria-label')
async function submit(value) {
  if (value) await click(host.querySelector(`input[value="${value}"]`))
  await act(async () => { panel().querySelector('form').dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true })) })
}
function Harness({ initial = zero, id = material._id, token = 'student-a', canRate = true }) {
  const [summary, setSummary] = useState(initial)
  return h(Rating, { material: { ...material, _id: id, ratingSummary: summary }, token, canRate, apiBaseUrl: '', parseResponse, onSummaryChange: setSummary })
}
async function mount(props = {}) { await act(async () => { root.render(h(Harness, { key: `${props.id || material._id}-${props.token || 'student-a'}`, ...props })) }) }
async function open() { await click(host.querySelector('.material-rating-toggle')) }
function mock(handler) { globalThis.fetch = async (url, options = {}) => { calls.push({ url: String(url), ...options }); return handler(String(url), options) } }
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' })
  Rating = (await server.ssrLoadModule('/src/materials/MaterialRating.jsx')).default
  Library = (await server.ssrLoadModule('/src/materials/MaterialLibrary.jsx')).default
})
beforeEach(() => { host = document.createElement('div'); document.body.append(host); root = createRoot(host); calls = []; mock(() => response({ ...zero })) })
afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); globalThis.fetch = originalFetch })
after(async () => { await server?.close(); await dom.happyDOM.close() })

test('compact zero/average display, expand/collapse and accessible native radios', async () => {
  await mount(); assert.equal(average(), 'No ratings yet'); assert.equal(panel().hidden, true)
  await open(); assert.equal(panel().hidden, false)
  const toggle = host.querySelector('.material-rating-toggle')
  assert.equal(toggle.getAttribute('aria-controls'), panel().id); assert.equal(toggle.getAttribute('aria-expanded'), 'true')
  assert.equal(panel().querySelector('legend').textContent, 'Your rating')
  for (let n = 1; n <= 5; n++) {
    const radio = host.querySelector(`input[value="${n}"]`)
    assert.equal(radio.type, 'radio'); assert.equal(radio.getAttribute('aria-label'), `${n} star${n === 1 ? '' : 's'}`); assert.equal(radio.name, panel().id)
  }
  await click(host.querySelector('input[value="4"]')); assert.equal(host.querySelector('input:checked').value, '4')
  await open(); assert.equal(panel().hidden, true); assert.equal(calls.length, 0)
  await mount({ token: 'other', initial: { averageRating: 4.5, ratingCount: 2, myRating: 5 } })
  assert.equal(average(), '4.5 out of 5, 2 ratings'); assert.equal(host.querySelector('input:checked').value, '5')
})
test('authoritative create/update, two students and persistence preserve exact count', async () => {
  const votes = new Map()
  const summary = (token) => ({ averageRating: votes.size ? [...votes.values()].reduce((a, b) => a + b, 0) / votes.size : null, ratingCount: votes.size, myRating: votes.get(token) || null })
  mock((url, opts) => { const token = opts.headers.Authorization; if (opts.method === 'PUT') votes.set(token, JSON.parse(opts.body).rating); return response(summary(token)) })
  await mount(); await open(); await submit(5); assert.equal(average(), '5.0 out of 5, 1 rating')
  await mount({ token: 'student-b', initial: summary('Bearer student-b') }); await open(); await submit(1); assert.equal(average(), '3.0 out of 5, 2 ratings')
  await mount({ token: 'student-a', initial: summary('Bearer student-a') }); await open(); await submit(3); assert.equal(average(), '2.0 out of 5, 2 ratings')
  assert.match(host.textContent, /Rating saved/)
  await mount({ token: 'new-session', initial: summary('Bearer student-a') }); assert.equal(average(), '2.0 out of 5, 2 ratings')
  assert.deepEqual(calls.map((c) => JSON.parse(c.body)), [{ rating: 5 }, { rating: 1 }, { rating: 3 }])
})
test('instructor sees compact read-only averages without submission controls', async () => {
  await mount({ canRate: false, initial: { averageRating: 3, ratingCount: 2, myRating: null } })
  assert.equal(average(), '3.0 out of 5, 2 ratings'); assert.equal(host.querySelector('form, input, .material-rating-toggle'), null); assert.equal(calls.length, 0)
})
test('pending PUT prevents duplicates and replaces summary with server result', async () => {
  const write = deferred(); mock(() => write.promise)
  await mount(); await open(); await submit(5); await submit()
  assert.equal(calls.length, 1); assert.equal(panel().querySelector('fieldset').disabled, true); assert.equal(button('Saving…').disabled, true)
  await act(async () => { write.resolve(response({ averageRating: 3.25, ratingCount: 4, myRating: 5 })) })
  assert.equal(average(), '3.3 out of 5, 4 ratings'); assert.equal(panel().querySelector('fieldset').disabled, false)
})
test('failed PUT preserves selection/data and remains retryable without automatic retries', async () => {
  let attempt = 0
  mock(() => { if (++attempt === 1) throw new TypeError('Network lost'); if (attempt === 2) return response({ message: 'Database unavailable' }, 500); return response({ averageRating: 4, ratingCount: 1, myRating: 4 }) })
  await mount(); await open(); await submit(4)
  assert.match(host.textContent, /Unable to confirm rating/); assert.equal(calls.length, 1); assert.equal(host.querySelector('input:checked').value, '4'); assert.equal(average(), 'No ratings yet')
  await submit(); assert.match(host.textContent, /Database unavailable/); assert.equal(calls.length, 2)
  await submit(); assert.equal(average(), '4.0 out of 5, 1 rating'); assert.equal(calls.length, 3)
})
test('unknown summary loads lazily with loading/error feedback and refresh retry', async () => {
  const read = deferred(); let attempt = 0
  mock(() => ++attempt === 1 ? read.promise : response({ averageRating: 2, ratingCount: 1, myRating: 2 }))
  await mount({ initial: null }); assert.equal(calls.length, 0); await open(); assert.equal(calls.length, 1); assert.match(host.textContent, /Loading rating/)
  await act(async () => { read.resolve(response({ message: 'Try later' }, 500)) })
  assert.match(host.textContent, /Try later/); assert.equal(button('Refresh rating').disabled, false)
  await click(button('Refresh rating')); assert.equal(average(), '2.0 out of 5, 1 rating'); assert.equal(host.querySelector('input:checked').value, '2')
})
for (const outcome of ['success', 'failure']) test(`late GET ${outcome} cannot overwrite successful PUT or flags`, async () => {
  const read = deferred(); mock((url, opts) => opts.method === 'PUT' ? response({ averageRating: 4, ratingCount: 3, myRating: 5 }) : read.promise)
  await mount(); await open(); await click(button('Refresh rating')); await submit(5)
  assert.equal(calls[0].signal.aborted, true); assert.equal(average(), '4.0 out of 5, 3 ratings')
  await act(async () => { if (outcome === 'success') read.resolve(response({ averageRating: 1, ratingCount: 1, myRating: 1 })); else read.reject(new Error('Old failure')) })
  assert.equal(average(), '4.0 out of 5, 3 ratings'); assert.match(host.textContent, /Rating saved/); assert.equal(host.querySelector('[role="alert"]'), null); assert.equal(button('Refresh rating').disabled, false)
})
for (const outcome of ['success', 'failure']) test(`PUT 404 stays authoritative over late GET ${outcome}, fresh scope recovers`, async () => {
  const read = deferred(); mock((url, opts) => opts.method === 'PUT' ? response({ message: 'Material not found' }, 404) : read.promise)
  await mount({ initial: { averageRating: 3, ratingCount: 2, myRating: null } }); await open(); await click(button('Refresh rating')); await submit(5)
  assert.equal(average(), 'Material unavailable'); assert.equal(panel().querySelector('fieldset').disabled, true)
  await act(async () => { if (outcome === 'success') read.resolve(response({ averageRating: 3, ratingCount: 2, myRating: 2 })); else read.reject(new Error('Old error')) })
  assert.equal(average(), 'Material unavailable'); assert.equal(host.querySelector('[role="alert"]').textContent, 'Material is no longer available.')
  assert.equal(button('Refresh rating').disabled, true); assert.doesNotMatch(host.textContent, /Loading rating|Old error/)
  mock(() => response({ averageRating: 5, ratingCount: 1, myRating: 5 }))
  await mount({ id: 'new-material', token: 'new-student', initial: null }); await open(); assert.equal(average(), '5.0 out of 5, 1 rating'); assert.equal(panel().querySelector('fieldset').disabled, false)
})
test('material/session changes abort writes and ignore old account responses', async () => {
  const write = deferred(); mock(() => write.promise)
  await mount(); await open(); await submit(5); const signal = calls[0].signal
  await mount({ token: 'student-b', id: 'other-material' }); assert.equal(signal.aborted, true)
  await act(async () => { write.resolve(response({ averageRating: 5, ratingCount: 1, myRating: 5 })) })
  assert.equal(average(), 'No ratings yet'); assert.equal(host.querySelector('input:checked'), null); assert.doesNotMatch(host.textContent, /Rating saved/)
})
test('rating preserves filters, mounted rows/actions, preview and expanded disclosures', async () => {
  const download = deferred()
  mock((url, opts) => opts.method === 'PUT' ? response({ averageRating: 5, ratingCount: 1, myRating: 5 })
    : url.includes('/download') ? download.promise
    : url.includes('/view') ? new Response(new Blob(['pdf'], { type: 'application/pdf' }))
      : response({ materials: [{ ...material, ratingSummary: zero }], count: 1 }))
  await act(async () => { root.render(h(Library, { token: 'student-a', apiBaseUrl: '', parseResponse, role: 'student' })) }); await tick(20)
  const row = host.querySelector('.material-row'); assert.ok(row); const actions = row.querySelector('.material-actions')
  const disclosures = [...host.querySelectorAll('details')]; disclosures.forEach((d) => { d.open = true })
  const select = host.querySelector('#material-filter-course')
  await act(async () => { select.value = 'CS'; select.dispatchEvent(new dom.Event('change', { bubbles: true })) })
  await click(host.querySelector('[aria-label="View notes.pdf"]'))
  const preview = host.querySelector('dialog'); assert.ok(preview)
  const downloadButton = host.querySelector('[aria-label="Download notes.pdf"]')
  await click(downloadButton)
  const downloadSignal = calls.find((c) => c.url.includes('/download')).signal
  await open(); await submit(5)
  assert.equal(host.querySelector('.material-row'), row); assert.equal(row.querySelector('.material-actions'), actions); assert.equal(host.querySelector('dialog'), preview)
  assert.equal(select.value, 'CS'); disclosures.forEach((d) => assert.equal(d.open, true)); assert.equal(calls.filter((c) => c.url.startsWith('/api/materials?')).length, 1)
  assert.equal(average(), '5.0 out of 5, 1 rating')
  assert.equal(downloadSignal.aborted, false); assert.equal(downloadButton.disabled, true)
  await act(async () => { download.resolve(new Response(new Blob(['pdf'], { type: 'application/pdf' }))) })
  await tick(180)
  assert.equal(downloadButton.disabled, false); assert.equal(host.querySelector('dialog'), preview)
  assert.equal(average(), '5.0 out of 5, 1 rating')
})

test('library session changes hide old own votes and ignore delayed previous-account list reads', async () => {
  const oldRead = deferred(); let oldSignal
  mock((url, opts) => {
    if (opts.headers.Authorization === 'Bearer student-a') { oldSignal = opts.signal; return oldRead.promise }
    return response({ materials: [{ ...material, ratingSummary: { averageRating: 3, ratingCount: 2, myRating: 1 } }], count: 1 })
  })
  const render = async (token) => { await act(async () => { root.render(h(Library, { token, apiBaseUrl: '', parseResponse, role: 'student' })) }); await tick(20) }
  await render('student-a'); assert.equal(host.querySelector('.material-row'), null)
  await render('student-b'); assert.equal(oldSignal.aborted, true)
  await open(); assert.equal(host.querySelector('input:checked').value, '1')
  await act(async () => { oldRead.resolve(response({ materials: [{ ...material, ratingSummary: { averageRating: 5, ratingCount: 1, myRating: 5 } }], count: 1 })) })
  assert.equal(average(), '3.0 out of 5, 2 ratings'); assert.equal(host.querySelector('input:checked').value, '1')
  const nextRead = deferred(); mock(() => nextRead.promise)
  await act(async () => { root.render(h(Library, { token: 'student-c', apiBaseUrl: '', parseResponse, role: 'student' })) })
  assert.equal(host.querySelector('.material-row'), null, 'old vote is hidden before the new read completes')
  await tick(20)
  await act(async () => { nextRead.resolve(response({ materials: [{ ...material, ratingSummary: { averageRating: 3, ratingCount: 2, myRating: null } }], count: 1 })) })
  await open(); assert.equal(host.querySelector('input:checked'), null)
})

for (const invalid of [null, '4.5', -1, 6]) {
  test(`malformed average ${JSON.stringify(invalid)} renders unavailable and a malformed PUT remains recoverable`, async () => {
    const malformed = { averageRating: invalid, ratingCount: 1, myRating: 4 }
    await mount({ initial: malformed })
    assert.equal(average(), 'Ratings unavailable')
    mock(() => response({ averageRating: 4, ratingCount: 1, myRating: 4 }))
    await open(); assert.equal(average(), '4.0 out of 5, 1 rating')
    mock(() => response(malformed))
    await submit(5)
    assert.equal(average(), 'Ratings unavailable'); assert.match(host.textContent, /Unable to confirm rating/)
    assert.equal(host.querySelector('input:checked').value, '5')
    assert.doesNotMatch(host.textContent, /Rating saved/)
    mock(() => response({ averageRating: 5, ratingCount: 1, myRating: 5 }))
    await click(button('Refresh rating')); assert.equal(average(), '5.0 out of 5, 1 rating')
  })
}
test('zero-vote GET stays distinct from unavailable; unexpected zero-vote PUT does not format null', async () => {
  await mount({ initial: null }); mock(() => response(zero)); await open()
  assert.equal(average(), 'No ratings yet')
  await submit(5)
  assert.equal(average(), 'Ratings unavailable'); assert.match(host.textContent, /Unable to confirm rating/)
  assert.equal(panel().querySelector('fieldset').disabled, false)
  await click(button('Refresh rating')); assert.equal(average(), 'No ratings yet')
})
