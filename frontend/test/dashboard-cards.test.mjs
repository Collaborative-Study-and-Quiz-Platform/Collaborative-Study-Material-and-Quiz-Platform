import assert from 'node:assert/strict'
import { after, afterEach, before, beforeEach, test } from 'node:test'
import { Window } from 'happy-dom'
import { createServer } from 'vite'

const dom = new Window({ url: 'http://localhost' })
for (const key of ['window', 'document', 'HTMLElement', 'Node', 'Event', 'MouseEvent']) {
  globalThis[key] = key === 'window' ? dom : dom[key]
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true
const { createElement, act } = await import('react')
const { createRoot } = await import('react-dom/client')
let server, DashboardHome, host, root

before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' })
  DashboardHome = (await server.ssrLoadModule('/src/App.jsx')).DashboardHome
})
beforeEach(() => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
})
afterEach(async () => {
  await act(async () => root.unmount())
  host.remove()
})
after(async () => {
  await server?.close()
  await dom.happyDOM.close()
})

async function verifyCards(role, expected) {
  const destinations = []
  await act(async () => root.render(createElement(DashboardHome, {
    user: { name: 'Dashboard Test' }, role, onNavigate: (page) => destinations.push(page),
  })))
  const grid = host.querySelector('.dashboard-features')
  assert.equal(grid.getAttribute('aria-label'), role === 'student' ? 'Student features' : 'Instructor features')
  const cards = [...grid.querySelectorAll('.dashboard-feature-card')]
  assert.deepEqual(cards.map((card) => card.querySelector('strong').textContent), expected.map(([title]) => title))
  assert.equal(grid.querySelectorAll('.coming-soon-badge').length, 0)
  for (const card of cards) {
    assert.equal(card.tagName, 'BUTTON')
    await act(async () => card.click())
  }
  assert.deepEqual(destinations, expected.map(([, page]) => page))
}

test('student dashboard has exactly four cards and My Bookmarks uses the existing destination', async () => {
  await verifyCards('student', [
    ['Study Materials', 'browse'],
    ['Quizzes', 'take-quizzes'],
    ['My Bookmarks', 'bookmarks'],
    ['Learning Analytics', 'analytics'],
  ])
})

test('instructor dashboard retains exactly the five existing functional cards and destinations', async () => {
  await verifyCards('instructor', [
    ['Upload Study Material', 'upload'],
    ['My Uploads', 'browse'],
    ['Question Bank', 'questions'],
    ['Create Quiz', 'create-quiz'],
    ['Class Analytics', 'analytics'],
  ])
})
