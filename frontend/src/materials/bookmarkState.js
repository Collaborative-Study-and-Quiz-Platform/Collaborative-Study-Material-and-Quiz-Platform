import { updateDownloadCount, withDownloadCount } from './materialCounts.js'

// One store per authenticated session; shared by both material pages.
export function createBookmarkState({ token, apiBaseUrl, parseResponse, request = fetch }) {
  let state = { materials: [], loading: true, hasLoaded: false, ready: false, error: '', message: '', pending: [] }
  let revision = 0
  let readController
  let disposed = false
  const pending = new Set()
  const listeners = new Set()
  function update(changes) {
    if (disposed) return
    state = { ...state, ...changes }
    listeners.forEach((listener) => listener())
  }
  async function load() {
    if (disposed || pending.size) return
    const version = ++revision
    readController?.abort()
    readController = new AbortController()
    update({ loading: true, error: '' })
    try {
      const data = await parseResponse(await request(`${apiBaseUrl}/api/materials/bookmarks`, {
        headers: { Authorization: `Bearer ${token}` }, signal: readController.signal,
      }))
      if (version === revision) {
        const knownCounts = new Map(state.materials.map((material) => [material._id, material.downloadCount]))
        update({ materials: data.materials.map((material) => withDownloadCount(material, knownCounts.get(material._id))),
          ready: true, hasLoaded: true, loading: false })
      }
    } catch (error) {
      if (version === revision && error.name !== 'AbortError') {
        update({ loading: false, ready: false, error: error.message || 'Unable to load bookmarks.' })
      }
    }
  }
  async function toggle(material) {
    const id = material._id
    if (disposed || !state.ready || state.loading || pending.has(id)) return
    const saved = state.materials.some((item) => item._id === id)
    ++revision
    readController?.abort()
    pending.add(id)
    update({ pending: [...pending], error: '', message: '' })
    try {
      await parseResponse(await request(`${apiBaseUrl}/api/materials/${id}/bookmark`, {
        method: saved ? 'DELETE' : 'PUT', headers: { Authorization: `Bearer ${token}` },
      }))
      update({ materials: saved ? state.materials.filter((item) => item._id !== id)
        : [material, ...state.materials.filter((item) => item._id !== id)],
      message: `${saved ? 'Removed bookmark for' : 'Bookmarked'} ${material.originalFilename}.` })
    } catch (error) {
      // A lost response may follow a successful write. Require reconciliation.
      update({ ready: false, error: error.message || 'Unable to update bookmark.' })
    } finally {
      pending.delete(id)
      update({ pending: [...pending] })
      if (!state.ready && !pending.size && !disposed) {
        const message = state.error
        await load()
        if (state.ready) update({ error: message })
      }
    }
  }
  return {
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
    getSnapshot: () => state,
    load,
    toggle,
    downloaded(id, count) {
      update({ materials: updateDownloadCount(state.materials, id, count) })
    },
    activate() { disposed = false },
    dispose() { disposed = true; ++revision; readController?.abort() },
  }
}
