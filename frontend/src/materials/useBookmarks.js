import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { createBookmarkState } from './bookmarkState'

export default function useBookmarks({ token, studentId, apiBaseUrl, parseResponse, page }) {
  const store = useMemo(() => createBookmarkState({ token, apiBaseUrl, parseResponse, studentId }),
    [token, studentId, apiBaseUrl, parseResponse])
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)
  useEffect(() => {
    store.activate()
    const refresh = () => { if (studentId) store.load() }
    window.addEventListener('focus', refresh)
    return () => { window.removeEventListener('focus', refresh); store.dispose() }
  }, [store, studentId])
  useEffect(() => {
    if (studentId && (page === 'browse' || page === 'bookmarks')) store.load()
  }, [store, studentId, page])
  return { ...state, toggle: store.toggle, reload: store.load, downloaded: store.downloaded }
}
