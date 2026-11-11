import { useEffect, useRef, useState } from 'react'

export function Preview({ material, token, apiBaseUrl, onClose, onDownload, downloading, downloadError, canDownload }) {
  const dialog = useRef(null)
  const [url, setUrl] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    const previousFocus = document.activeElement
    dialog.current.showModal()
    return () => previousFocus?.focus()
  }, [])

  useEffect(() => {
    if (material.fileType !== 'pdf') return
    const controller = new AbortController()
    let objectUrl
    async function load() {
      try {
        const response = await fetch(`${apiBaseUrl}/api/materials/${material._id}/view`, {
          headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
        })
        if (!response.ok) {
          const data = await response.json().catch(() => ({}))
          throw new Error(data.message || 'Unable to preview this material.')
        }
        const blob = await response.blob()
        if (controller.signal.aborted) return
        objectUrl = URL.createObjectURL(blob)
        setUrl(objectUrl)
      } catch (requestError) {
        if (!controller.signal.aborted) setError(requestError.message)
      }
    }
    load()
    return () => {
      controller.abort()
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [material._id, material.fileType, token, apiBaseUrl])

  return (
    <dialog ref={dialog} className="material-preview" aria-labelledby="material-preview-title"
      onCancel={(event) => { event.preventDefault(); onClose() }}>
      <div className="material-preview-heading">
        <h2 id="material-preview-title">{material.originalFilename}</h2>
        <button type="button" className="secondary-button" onClick={onClose} autoFocus>Close preview</button>
      </div>
      {material.fileType === 'pdf' ? (
        error ? <p role="alert">{error}</p> : url
          ? <iframe src={canDownload ? url : `${url}#toolbar=0`} title={`Preview of ${material.originalFilename}`} />
          : <p role="status">Loading preview…</p>
      ) : <p>{canDownload
        ? 'Inline preview is unavailable for DOCX and legacy PPT files. Download the document to open it.'
        : 'Inline preview is unavailable for DOCX and legacy PPT files.'}</p>}
      {downloadError && <p role="alert">{downloadError}</p>}
      {canDownload && <button type="button" onClick={onDownload} disabled={downloading}>
        {downloading ? 'Downloading…' : 'Download material'}
      </button>}
    </dialog>
  )
}

export default function MaterialActions({ material, token, apiBaseUrl, onDownloaded, canDownload, bookmarks, onManage }) {
  const bookmarked = bookmarks?.materials.some((item) => item._id === material._id) ?? false
  const bookmarkPending = bookmarks?.pending.includes(material._id) ?? false
  const [preview, setPreview] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const pending = useRef(null)
  const urls = useRef(new Set())

  useEffect(() => () => {
    pending.current?.abort()
    urls.current.forEach((url) => URL.revokeObjectURL(url))
    urls.current.clear()
  }, [])

  async function download() {
    if (!canDownload || pending.current) return
    const controller = new AbortController()
    pending.current = controller
    setDownloading(true)
    setError('')
    try {
      const response = await fetch(`${apiBaseUrl}/api/materials/${material._id}/download`, {
        headers: { Authorization: `Bearer ${token}` }, signal: controller.signal,
      })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.message || 'Unable to download this material.')
      }
      const blob = await response.blob()
      if (controller.signal.aborted) return
      const url = URL.createObjectURL(blob)
      urls.current.add(url)
      const link = document.createElement('a')
      link.href = url
      link.download = material.originalFilename
      document.body.append(link)
      link.click()
      link.remove()
      window.setTimeout(() => { URL.revokeObjectURL(url); urls.current.delete(url) }, 1000)
      await onDownloaded(material._id)
    } catch (requestError) {
      if (!controller.signal.aborted) setError(requestError.message)
    } finally {
      pending.current = null
      if (!controller.signal.aborted) setDownloading(false)
    }
  }

  return (
    <div className="material-actions">
      <div className="material-action-buttons">
        <button type="button" className="secondary-button material-icon-button"
          aria-label={`View ${material.originalFilename}`} title="View" onClick={() => setPreview(true)}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" />
          </svg>
        </button>
        {canDownload && <button type="button" className="secondary-button material-icon-button"
          aria-label={`Download ${material.originalFilename}`} title="Download" onClick={download} disabled={downloading}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
          </svg>
        </button>}
        {onManage && <>
          <button type="button" className="secondary-button material-icon-button" aria-label={`Edit ${material.originalFilename}`}
            title="Edit" onClick={() => onManage('edit', material)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="m15 4 5 5M4 20l5-1L21 7l-5-5L4 14v6Z" /></svg>
          </button>
          <button type="button" className="secondary-button material-icon-button" aria-label={`Delete ${material.originalFilename}`}
            title="Delete" onClick={() => onManage('delete', material)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M3 6h18M9 6V3h6v3M6 6l1 15h10l1-15M10 10v7m4-7v7" /></svg>
          </button>
        </>}
        {canDownload && bookmarks && <button type="button"
          className="secondary-button material-icon-button material-bookmark-button"
          aria-label={`Bookmark ${material.originalFilename}`}
          aria-pressed={bookmarked}
          title={bookmarked ? 'Remove bookmark' : 'Bookmark'}
          disabled={!bookmarks.ready || bookmarks.loading || bookmarkPending}
          onClick={async (event) => {
            const button = event.currentTarget
            const heading = document.getElementById('library-title')
            await bookmarks.toggle(material)
            window.setTimeout(() => {
              if (!button.isConnected && heading?.isConnected && document.activeElement === document.body) {
                heading.focus()
              }
            }, 0)
          }}>
          <svg viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"
            fill={bookmarked ? 'currentColor' : 'none'}>
            <path d="M6 3h12v18l-6-4-6 4V3Z" />
          </svg>
        </button>}
      </div>
      {bookmarkPending && <p role="status">Updating bookmark…</p>}
      {downloading && <p role="status">Downloading…</p>}
      {error && <p role="alert">{error}</p>}
      {preview && <Preview material={material} token={token} apiBaseUrl={apiBaseUrl}
        onClose={() => setPreview(false)} onDownload={download} downloading={downloading} downloadError={error} canDownload={canDownload} />}
    </div>
  )
}
