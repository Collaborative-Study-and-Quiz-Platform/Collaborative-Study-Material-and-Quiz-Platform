import { useEffect, useRef, useState } from 'react'
import './material-rating.css'

function isValidSummary(summary) {
  return summary && Number.isInteger(summary.ratingCount) && summary.ratingCount >= 0
    && (summary.ratingCount === 0 ? summary.averageRating === null
      : Number.isFinite(summary.averageRating) && summary.averageRating >= 1 && summary.averageRating <= 5)
}

export default function MaterialRating({ material, token, apiBaseUrl, parseResponse, canRate, onSummaryChange }) {
  const summary = isValidSummary(material.ratingSummary) ? material.ratingSummary : null
  const panelId = `material-rating-${material._id}`
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(summary?.myRating || 0)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [unavailable, setUnavailable] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const requests = useRef({ active: false, version: 0, read: null, write: null, unavailable: false })

  useEffect(() => {
    const state = requests.current
    state.active = true
    return () => { state.active = false; ++state.version; state.read?.abort(); state.write?.abort() }
  }, [])

  function cancelRead(state) {
    ++state.version
    state.read?.abort()
    state.read = null
    setLoading(false)
  }
  function markUnavailable(state) {
    state.unavailable = true
    cancelRead(state)
    setUnavailable(true)
    setError('Material is no longer available.')
    setMessage('')
    onSummaryChange(null)
  }
  function confirm(data, requireRating = false) {
    if (!isValidSummary(data) || (requireRating && data.ratingCount === 0)) {
      onSummaryChange(null)
      throw new Error('Rating summary unavailable. Refresh to try again.')
    }
    const next = { averageRating: data.averageRating, ratingCount: data.ratingCount, myRating: data.myRating }
    onSummaryChange(next)
    setSelected(next.myRating || 0)
  }

  async function refresh() {
    const state = requests.current
    if (!state.active || state.write || state.read || state.unavailable) return
    const version = ++state.version
    const controller = new AbortController()
    state.read = controller
    setLoading(true)
    setError('')
    try {
      const data = await parseResponse(await fetch(`${apiBaseUrl}/api/materials/${material._id}/rating`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      }))
      if (!state.active || version !== state.version || controller.signal.aborted || state.unavailable) return
      confirm(data)
    } catch (failure) {
      if (state.active && version === state.version && !controller.signal.aborted && !state.unavailable) {
        if (failure.status === 404) markUnavailable(state)
        else setError(failure.message || 'Unable to load ratings. Please retry.')
      }
    } finally {
      if (state.active && version === state.version) { state.read = null; setLoading(false) }
    }
  }

  async function submit(event) {
    event.preventDefault()
    const state = requests.current
    if (!state.active || !canRate || state.write || state.unavailable) return
    if (!Number.isInteger(selected) || selected < 1 || selected > 5) { setError('Choose 1–5 stars.'); return }
    cancelRead(state)
    const controller = new AbortController()
    state.write = controller
    setSaving(true)
    setError('')
    setMessage('')
    try {
      const data = await parseResponse(await fetch(`${apiBaseUrl}/api/materials/${material._id}/rating`, {
        method: 'PUT', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ rating: selected }),
      }))
      if (!state.active || controller.signal.aborted || state.unavailable) return
      confirm(data, true)
      setMessage(`Rating saved. Average ${data.averageRating.toFixed(1)} out of 5 from ${data.ratingCount} rating${data.ratingCount === 1 ? '' : 's'}.`)
    } catch (failure) {
      if (state.active && !controller.signal.aborted && !state.unavailable) {
        if (failure.status === 404) markUnavailable(state)
        else setError(failure.status ? failure.message : 'Unable to confirm rating. Refresh or retry the same rating.')
      }
    } finally {
      if (state.write === controller) state.write = null
      if (state.active && !controller.signal.aborted) setSaving(false)
    }
  }

  const averageLabel = unavailable ? 'Material unavailable' : !summary ? 'Ratings unavailable'
    : summary.ratingCount === 0 ? 'No ratings yet' : `${summary.averageRating.toFixed(1)} out of 5, ${summary.ratingCount} rating${summary.ratingCount === 1 ? '' : 's'}`
  return (
    <div className="material-rating">
      <span className="material-rating-average" aria-label={averageLabel} title={averageLabel}>
        <span aria-hidden="true">★ </span>
        {unavailable ? 'Unavailable' : !summary ? 'Ratings unavailable' : summary.ratingCount === 0 ? 'No ratings yet'
          : <>{summary.averageRating.toFixed(1)} <small>({summary.ratingCount})</small></>}
      </span>
      {canRate ? <button type="button" className="secondary-button material-icon-button material-rating-toggle"
        title="Rate material" aria-label={`Rate ${material.originalFilename}`} aria-expanded={open} aria-controls={panelId}
        onClick={() => { setOpen((current) => !current); if (!open && !summary && !unavailable) refresh() }}>
        <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true" fill={summary?.myRating ? 'currentColor' : 'none'}>
          <path d="m12 3 2.8 5.7 6.3.9-4.6 4.5 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z" />
        </svg>
      </button> : !summary && !unavailable && <button type="button" className="secondary-button" disabled={loading} onClick={refresh}>Retry ratings</button>}
      {canRate && <section id={panelId} className="material-rating-panel" hidden={!open} aria-label={`Rating for ${material.originalFilename}`}>
        <form onSubmit={submit} noValidate aria-busy={saving}>
          <fieldset disabled={saving || unavailable}>
            <legend>Your rating</legend>
            <div className="material-rating-stars">
              {[1, 2, 3, 4, 5].map((value) => <label key={value} title={`${value} star${value === 1 ? '' : 's'}`}>
                <input type="radio" name={panelId} value={value} aria-label={`${value} star${value === 1 ? '' : 's'}`}
                  checked={selected === value} onChange={() => setSelected(value)} required />
                <span aria-hidden="true" className={value <= selected ? 'selected' : ''}>★</span>
              </label>)}
            </div>
          </fieldset>
          <div className="material-rating-buttons">
            <button type="submit" disabled={saving || unavailable || !selected}>{saving ? 'Saving…' : summary?.myRating ? 'Update rating' : 'Submit rating'}</button>
            <button type="button" className="secondary-button" onClick={refresh} disabled={loading || saving || unavailable}>Refresh rating</button>
          </div>
        </form>
      </section>}
      {(loading || error || message) && <div className="material-rating-feedback">
        {loading && <p role="status">Loading rating…</p>}
        {error && <p className="feedback error" role="alert">{error}</p>}
        {message && <p role="status">{message}</p>}
      </div>}
    </div>
  )
}
