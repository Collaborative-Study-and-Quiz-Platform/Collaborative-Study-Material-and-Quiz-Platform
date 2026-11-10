import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { act, createElement } from 'react'
import { Window } from 'happy-dom'
import { createServer } from 'vite'

const first = { _id: 'one', originalFilename: 'notes.pdf', fileType: 'pdf', downloadCount: 7,
  tags: { course: 'CS', subject: 'OS', topic: 'Threads' } }
const second = { ...first, _id: 'two', originalFilename: 'other.pdf', tags: { ...first.tags, topic: 'Memory' } }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
const parseResponse = async (response) => {
  const data = await response.json()
  if (!response.ok) { const error = new Error(data.message); error.status = response.status; error.fieldErrors = data.errors; throw error }
  return data
}
const deferred = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
const tick = () => new Promise((resolve) => setTimeout(resolve, 10))
const originalFetch = globalThis.fetch
let dom, server, Library, Dialog, createRoot, root, container, materials, calls
const props = { role: 'instructor', token: 'owner-token', apiBaseUrl: '', parseResponse }

before(async () => {
  dom = new Window({ url: 'http://localhost/' })
  for (const name of ['window', 'document', 'HTMLElement', 'Node']) {
    Object.defineProperty(globalThis, name, { configurable: true, value: name === 'window' ? dom : dom[name] })
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  ;({ createRoot } = await import('react-dom/client'))
  server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' })
  Library = (await server.ssrLoadModule('/src/materials/MaterialLibrary.jsx')).default
  Dialog = (await server.ssrLoadModule('/src/materials/MaterialManagementDialog.jsx')).default
})
beforeEach(() => {
  materials = structuredClone([first, second]); calls = []
  container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, ...options })
    const id = url.split('/').pop()
    if (options.method === 'PATCH') {
      const changes = JSON.parse(options.body)
      materials = materials.map((material) => material._id === id ? { ...material,
        originalFilename: changes.originalFilename ?? material.originalFilename,
        tags: { ...material.tags, ...Object.fromEntries(Object.entries(changes).filter(([key]) => key !== 'originalFilename')) } } : material)
      return json({ status: 'success', message: 'Study material updated', material: materials.find((material) => material._id === id) })
    }
    if (options.method === 'DELETE') {
      materials = materials.filter((material) => material._id !== id)
      return json({ status: 'success', message: 'Study material deleted' })
    }
    if (url.endsWith('/view')) return new Response('%PDF-test')
    const params = new URL(url, 'http://localhost').searchParams
    const filtered = materials.filter((material) => {
      if (params.get('keyword') && !material.originalFilename.includes(params.get('keyword'))) return false
      return ['course', 'subject', 'topic'].every((key) => !params.get(key) || material.tags[key] === params.get(key))
    })
    return json({ materials: filtered, count: filtered.length })
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
async function mount(options = props) {
  await act(async () => root.render(createElement(Library, options)))
  await act(async () => { await tick() })
}
async function click(label) {
  await act(async () => container.querySelector(`[aria-label="${label}"]`).click())
}
async function change(id, value) {
  await act(async () => {
    const input = container.querySelector(`#${id}`)
    Object.getOwnPropertyDescriptor(dom.HTMLInputElement.prototype, 'value').set.call(input, value)
    input.dispatchEvent(new dom.Event('input', { bubbles: true }))
  })
}
async function submit(selector = 'dialog form') {
  await act(async () => {
    container.querySelector(selector).dispatchEvent(new dom.Event('submit', { bubbles: true, cancelable: true }))
    await tick()
  })
}
const mutations = () => calls.filter((call) => call.method)

test('instructors see management controls; students retain View/Download without Edit/Delete', async () => {
  await mount()
  assert.ok(container.querySelector('[aria-label="Edit notes.pdf"]'))
  assert.ok(container.querySelector('[aria-label="Delete notes.pdf"]'))
  assert.equal(container.querySelector('[aria-label="Download notes.pdf"]'), null)
  await mount({ ...props, role: 'student' })
  assert.equal(container.querySelector('[aria-label="Edit notes.pdf"]'), null)
  assert.equal(container.querySelector('[aria-label="Delete notes.pdf"]'), null)
  assert.ok(container.querySelector('[aria-label="View notes.pdf"]'))
  assert.ok(container.querySelector('[aria-label="Download notes.pdf"]'))
})
test('edit is prefilled, validates before requests, saves partial metadata and preserves unaffected disclosure/preview nodes', async () => {
  await mount()
  const details = [...container.querySelectorAll('details')]
  details.forEach((element) => { element.open = true })
  await click('View other.pdf')
  const preview = container.querySelector('.material-preview')
  await click('Edit notes.pdf')
  assert.equal(container.querySelector('#edit-material-originalFilename').value, 'notes.pdf')
  assert.equal(document.activeElement.id, 'edit-material-originalFilename')
  await change('edit-material-originalFilename', '../bad.pdf'); await submit()
  assert.equal(mutations().length, 0)
  assert.equal(container.querySelector('#edit-material-originalFilename').getAttribute('aria-invalid'), 'true')
  await change('edit-material-originalFilename', 'renamed.pdf'); await submit()
  await act(async () => { await tick() })
  assert.deepEqual(JSON.parse(mutations()[0].body), { originalFilename: 'renamed.pdf' })
  assert.equal(mutations()[0].method, 'PATCH')
  assert.equal(mutations()[0].headers.Authorization, 'Bearer owner-token')
  assert.ok(container.querySelector('[aria-label="Edit renamed.pdf"]'))
  assert.equal(container.querySelector('.material-preview'), preview)
  assert.equal(preview.open, true)
  for (const element of details) { assert.equal(element.isConnected, true); assert.equal(element.open, true) }
  assert.match(container.textContent, /Study material updated/)
})
test('delete requires confirmation, Cancel/Escape send no mutation and successful removal restores focus', async () => {
  await mount()
  const trigger = container.querySelector('[aria-label="Delete notes.pdf"]')
  trigger.focus(); await click('Delete notes.pdf')
  let dialog = container.querySelector('.material-management-dialog')
  assert.match(dialog.textContent, /notes.pdf/)
  assert.equal(document.activeElement.textContent, 'Cancel')
  await act(async () => dialog.querySelector('[type="button"]').click())
  assert.equal(mutations().length, 0); assert.equal(document.activeElement, trigger)
  await click('Delete notes.pdf')
  await act(async () => container.querySelector('.material-management-dialog').dispatchEvent(new dom.Event('cancel', { cancelable: true })))
  assert.equal(mutations().length, 0)
  await click('Delete notes.pdf'); await submit()
  await act(async () => { await tick() })
  assert.equal(mutations().length, 1); assert.equal(mutations()[0].method, 'DELETE')
  assert.equal(container.querySelector('[aria-label="View notes.pdf"]'), null)
  assert.ok(container.querySelector('[aria-label="View other.pdf"]'))
  assert.match(container.textContent, /Study material deleted/)
  assert.equal(document.activeElement.id, 'library-title')
})
test('pending confirmation guards rapid submits; failures retain the dialog for retry', async () => {
  await mount()
  const waiting = deferred(); const normal = globalThis.fetch
  let signal, attempts = 0
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'DELETE' && ++attempts === 1) { signal = options.signal; return waiting.promise }
    return normal(url, options)
  }
  await click('Delete notes.pdf'); await submit(); await submit()
  assert.equal(attempts, 1)
  assert.equal(container.querySelector('dialog [type="submit"]').disabled, true)
  await act(async () => container.querySelector('dialog').dispatchEvent(new dom.Event('cancel', { cancelable: true })))
  assert.ok(container.querySelector('dialog')); assert.equal(signal.aborted, false)
  await act(async () => { waiting.resolve(json({ message: 'Unable to finish deletion' }, 500)); await tick() })
  assert.match(container.querySelector('[role="alert"]').textContent, /Unable to finish deletion/)
  assert.equal(container.querySelector('dialog [type="submit"]').disabled, false)
  await submit(); await act(async () => { await tick() })
  assert.equal(container.querySelector('.material-management-dialog'), null)
  assert.equal(container.querySelector('[aria-label="View notes.pdf"]'), null)
})
test('mutation refresh preserves applied filters and rebuilds filter options without replacing unaffected rows', async () => {
  await mount()
  await change('material-keyword', 'notes'); await submit('.library-filters')
  assert.equal(container.querySelectorAll('.material-row').length, 1)
  await click('Edit notes.pdf'); await change('edit-material-course', 'IT'); await submit()
  await act(async () => { await tick() })
  assert.equal(container.querySelector('#material-keyword').value, 'notes')
  assert.equal(container.querySelectorAll('.material-row').length, 1)
  assert.ok([...container.querySelector('#material-filter-course').options].some((option) => option.value === 'IT'))
  assert.ok(calls.some((call) => call.url.includes('keyword=notes')))
})
test('background refresh failure keeps existing rows and offers a refresh retry after mutation succeeds', async () => {
  await mount()
  const normal = globalThis.fetch; let fail = true
  globalThis.fetch = async (url, options = {}) => options.method || !fail ? normal(url, options) : json({ message: 'Refresh failed' }, 500)
  const unaffected = container.querySelectorAll('.material-row')[1]
  await click('Delete notes.pdf'); await submit(); await act(async () => { await tick() })
  assert.equal(unaffected.isConnected, true)
  assert.match(container.textContent, /Refresh failed/)
  fail = false
  await act(async () => { [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry materials').click(); await tick() })
  assert.equal(container.querySelector('[aria-label="View notes.pdf"]'), null)
  assert.equal(container.querySelectorAll('.material-row').length, 1)
})
test('unmount cancels management requests and ignores a late mutation response', async () => {
  await mount()
  const normal = globalThis.fetch; const waiting = deferred(); let signal
  globalThis.fetch = (url, options = {}) => {
    if (options.method) { signal = options.signal; return waiting.promise }
    return normal(url, options)
  }
  await click('Delete notes.pdf'); await submit()
  await act(async () => root.render(createElement('p', null, 'Logged out')))
  assert.equal(signal.aborted, true)
  await act(async () => { waiting.resolve(json({ message: 'Old response' })); await tick() })
  assert.equal(container.textContent, 'Logged out')
})

test('lost successful DELETE response followed by 404 reconciles the list while preserving filters, preview and disclosures', async () => {
  await mount()
  await change('material-keyword', 'pdf'); await submit('.library-filters')
  const unaffectedRow = [...container.querySelectorAll('.material-row')].find((row) => row.textContent.includes('other.pdf'))
  const sections = [container.querySelector('.explorer-course'), container.querySelector('.explorer-subject'), unaffectedRow.closest('.explorer-topic')]
  sections.forEach((section) => { section.open = true })
  await click('View other.pdf')
  const preview = container.querySelector('.material-preview')
  const normal = globalThis.fetch
  let attempts = 0
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'DELETE') {
      calls.push({ url, ...options })
      if (++attempts === 1) {
        materials = materials.filter((material) => material._id !== first._id)
        throw new TypeError('Response lost')
      }
      return json({ message: 'Material not found' }, 404)
    }
    return normal(url, options)
  }
  await click('Delete notes.pdf'); await submit()
  assert.match(container.querySelector('.material-management-dialog [role="alert"]').textContent, /Response lost/)
  assert.ok(container.querySelector('[aria-label="View notes.pdf"]'))
  const reads = calls.filter((call) => !call.method).length
  await submit(); await act(async () => { await tick() })
  assert.equal(attempts, 2)
  assert.equal(container.querySelector('.material-management-dialog'), null)
  assert.equal(container.querySelector('[aria-label="View notes.pdf"]'), null)
  assert.equal(container.querySelector('#material-keyword').value, 'pdf')
  assert.equal(container.querySelector('.material-row'), unaffectedRow)
  assert.equal(container.querySelector('.material-preview'), preview)
  assert.equal(preview.open, true)
  for (const section of sections) { assert.equal(section.isConnected, true); assert.equal(section.open, true) }
  assert.equal(container.querySelector('.feedback.success').textContent, 'Material is no longer available. List refreshed.')
  // One filtered refresh and one request to rebuild options, with no duplicate refresh cycle.
  assert.equal(calls.filter((call) => !call.method).length - reads, 2)
  assert.doesNotMatch(container.textContent, /Study material deleted/)
})

test('DELETE 404 after another tab removes the material closes confirmation and refreshes once', async () => {
  await mount(); await click('Delete notes.pdf')
  materials = materials.filter((material) => material._id !== first._id)
  const normal = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'DELETE') { calls.push({ url, ...options }); return json({ message: 'Material not found' }, 404) }
    return normal(url, options)
  }
  const reads = calls.filter((call) => !call.method).length
  await submit(); await act(async () => { await tick() })
  assert.equal(mutations().length, 1)
  assert.equal(container.querySelector('.material-management-dialog'), null)
  assert.equal(container.querySelector('[aria-label="View notes.pdf"]'), null)
  assert.ok(container.querySelector('[aria-label="View other.pdf"]'))
  assert.equal(container.querySelector('.feedback.success').textContent, 'Material is no longer available. List refreshed.')
  assert.equal(calls.filter((call) => !call.method).length - reads, 1)
})

test('PATCH 404 remains an error without completing or refreshing the list', async () => {
  await mount(); await click('Edit notes.pdf'); await change('edit-material-topic', 'Processes')
  const normal = globalThis.fetch
  globalThis.fetch = async (url, options = {}) => {
    if (options.method === 'PATCH') { calls.push({ url, ...options }); return json({ message: 'Material not found' }, 404) }
    return normal(url, options)
  }
  const reads = calls.filter((call) => !call.method).length
  await submit()
  const dialog = container.querySelector('.material-management-dialog')
  assert.equal(dialog.open, true)
  assert.match(dialog.querySelector('[role="alert"]').textContent, /Material not found/)
  assert.equal(dialog.querySelector('[type="submit"]').disabled, false)
  assert.ok(container.querySelector('[aria-label="View notes.pdf"]'))
  assert.equal(container.querySelector('.feedback.success'), null)
  assert.equal(calls.filter((call) => !call.method).length, reads)
})

test('DELETE 200 and 404 invoke the completion callback exactly once and close exactly once', async () => {
  for (const status of [200, 404]) {
    let completed = 0, cancelled = 0, requests = 0
    const message = status === 200 ? 'Study material deleted' : 'Material is no longer available. List refreshed.'
    globalThis.fetch = async () => { ++requests; return json({ message: status === 200 ? message : 'Material not found' }, status) }
    await act(async () => root.render(createElement(Dialog, { ...props, mode: 'delete', material: first,
      onClose: () => { ++cancelled },
      onComplete: (data) => { ++completed; root.render(createElement('p', { role: 'status' }, data.message)) },
    })))
    await submit()
    assert.equal(completed, 1)
    assert.equal(cancelled, 0)
    assert.equal(requests, 1)
    assert.equal(container.querySelector('dialog'), null)
    assert.equal(container.querySelector('[role="status"]').textContent, message)
    await act(async () => { await tick() })
    assert.equal(completed, 1)
  }
})
