import { useCallback, useEffect, useRef, useState } from 'react'
import './material-comments.css'

export default function MaterialComments({ materialId, token, apiBaseUrl, parseResponse, panelId }) {
  const [comments, setComments] = useState([])
  const [nextCursor, setNextCursor] = useState(null)
  const [hasLoaded, setHasLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [posting, setPosting] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [unavailable, setUnavailable] = useState(false)
  const requests = useRef({ active: false, version: 0, read: null, post: null, unavailable: false })

  const load = useCallback(async (cursor = null) => {
    const state = requests.current
    if (!state.active || state.post || state.unavailable) return
    const version = ++state.version
    state.read?.abort()
    const controller = new AbortController()
    state.read = controller
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: '20' })
      if (cursor) params.set('cursor', cursor)
      const data = await parseResponse(await fetch(`${apiBaseUrl}/api/materials/${materialId}/comments?${params}`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      }))
      if (!state.active || version !== state.version || controller.signal.aborted || state.unavailable) return
      setComments((current) => cursor
        ? [...current, ...data.comments.filter((comment) => !current.some((item) => item._id === comment._id))]
        : data.comments)
      setNextCursor(data.nextCursor)
      setHasLoaded(true)
    } catch (failure) {
      if (state.active && version === state.version && !controller.signal.aborted && !state.unavailable) {
        if (failure.status === 404) { state.unavailable = true; setUnavailable(true); setComments([]) }
        setError(failure.status === 404 ? 'Material is no longer available.' : failure.message || 'Unable to load comments.')
      }
    } finally {
      if (state.active && version === state.version) { state.read = null; setLoading(false) }
    }
  }, [materialId, token, apiBaseUrl, parseResponse])

  useEffect(() => {
    const state = requests.current
    state.active = true
    const timer = window.setTimeout(() => load(), 0)
    return () => {
      window.clearTimeout(timer)
      state.active = false
      ++state.version
      state.read?.abort()
      state.post?.abort()
    }
  }, [load])

  async function post(event) {
    event.preventDefault()
    const state = requests.current
    if (!state.active || state.post || !hasLoaded || unavailable || state.unavailable) return
    const content = draft.trim()
    if (!content || content.length > 2000) { setError('Enter 1–2000 characters.'); return }
    const controller = new AbortController()
    state.post = controller
    setPosting(true)
    setError('')
    setMessage('')
    try {
      const data = await parseResponse(await fetch(`${apiBaseUrl}/api/materials/${materialId}/comments`, {
        method: 'POST', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      }))
      if (!state.active || controller.signal.aborted || state.unavailable) return
      // Invalidate reads begun before this confirmed write; keep the older-page cursor.
      ++state.version
      state.read?.abort()
      state.read = null
      setLoading(false)
      setComments((current) => [data.comment, ...current.filter((comment) => comment._id !== data.comment._id)])
      setDraft('')
      setError('')
      setMessage('Comment posted.')
    } catch (failure) {
      if (state.active && !controller.signal.aborted && !state.unavailable) {
        if (failure.status === 404) {
          state.unavailable = true
          ++state.version
          state.read?.abort()
          state.read = null
          setLoading(false)
          setUnavailable(true)
          setComments([])
          setNextCursor(null)
        }
        setError(failure.status === 404 ? 'Material is no longer available.'
          : failure.status ? failure.message : 'Unable to confirm comment. Refresh comments before retrying.')
      }
    } finally {
      if (state.post === controller) state.post = null
      if (state.active && !controller.signal.aborted) setPosting(false)
    }
  }

  return (
    <section className="material-comments" id={panelId} aria-labelledby={`${panelId}-title`}>
      <div className="material-comments-heading">
        <h5 id={`${panelId}-title`}>Comments</h5>
        <button type="button" className="secondary-button" onClick={() => load()} disabled={loading || posting || unavailable}>Refresh comments</button>
      </div>
      {loading && <p role="status">{hasLoaded ? 'Refreshing comments…' : 'Loading comments…'}</p>}
      {error && <p className="feedback error" role="alert">{error}</p>}
      {message && <p role="status">{message}</p>}
      {error && !hasLoaded && !unavailable && <button type="button" className="secondary-button" onClick={() => load()} disabled={loading}>Retry comments</button>}
      {hasLoaded && !loading && !error && comments.length === 0 && <p>No comments yet. Start the discussion.</p>}
      <ol className="material-comment-list" aria-label="Material comments">
        {comments.map((comment) => (
          <li key={comment._id}>
            <div className="material-comment-byline">
              <strong>{comment.author?.name || 'Former user'}</strong>
              <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString()}</time>
            </div>
            <p className="material-comment-text">{comment.content}</p>
          </li>
        ))}
      </ol>
      {nextCursor && !unavailable && <button type="button" className="secondary-button" disabled={loading || posting} onClick={() => load(nextCursor)}>Load older comments</button>}
      <form onSubmit={post} noValidate aria-busy={posting}>
        <label htmlFor={`${panelId}-content`}>Your comment</label>
        <textarea id={`${panelId}-content`} value={draft} onChange={(event) => setDraft(event.target.value)}
          rows={3} maxLength={2000} required disabled={posting || unavailable} aria-describedby={`${panelId}-count`} />
        <span id={`${panelId}-count`}>{draft.length}/2000 characters</span>
        <button type="submit" disabled={posting || !hasLoaded || unavailable || !draft.trim()}>{posting ? 'Posting…' : 'Post comment'}</button>
        {posting && <p role="status">Posting comment…</p>}
      </form>
    </section>
  )
}
