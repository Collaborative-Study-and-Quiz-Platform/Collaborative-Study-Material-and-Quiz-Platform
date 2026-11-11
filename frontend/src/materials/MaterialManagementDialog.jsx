import { useEffect, useRef, useState } from 'react'
import './material-management.css'

export default function MaterialManagementDialog({ mode, material, token, apiBaseUrl, parseResponse, onClose, onComplete }) {
  const deleting = mode === 'delete'
  const dialog = useRef(null)
  const initialFocus = useRef(null)
  const request = useRef(null)
  const [form, setForm] = useState(() => ({ originalFilename: material.originalFilename,
    course: material.tags?.course || '', subject: material.tags?.subject || '', topic: material.tags?.topic || '' }))
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  useEffect(() => {
    const previousFocus = document.activeElement
    dialog.current.showModal()
    initialFocus.current?.focus()
    return () => {
      request.current?.abort()
      if (previousFocus?.isConnected) previousFocus.focus()
      else document.getElementById('library-title')?.focus()
    }
  }, [])

  async function submit(event) {
    event.preventDefault()
    if (request.current) return
    const fields = Object.fromEntries(Object.entries(form).map(([name, value]) => [name, value.trim()]))
    if (!deleting) {
      const invalid = {}
      if (!fields.originalFilename || fields.originalFilename.length > 255
        || /[\\/]/.test(fields.originalFilename)
        || [...fields.originalFilename].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
        || fields.originalFilename.lastIndexOf('.') <= 0
        || fields.originalFilename.split('.').pop()?.toLowerCase() !== material.fileType) {
        invalid.originalFilename = 'Enter a safe filename with the original extension (maximum 255 characters).'
      }
      for (const name of ['course', 'subject', 'topic']) {
        if (!fields[name] || fields[name].length > 100) invalid[name] = 'Enter 1–100 characters.'
      }
      setErrors(invalid)
      if (Object.keys(invalid).length) {
        document.getElementById(`edit-material-${Object.keys(invalid)[0]}`)?.focus()
        return
      }
    }
    const changes = Object.fromEntries(Object.entries(fields).filter(([name, value]) =>
      value !== (name === 'originalFilename' ? material.originalFilename : material.tags?.[name])))
    if (!deleting && !Object.keys(changes).length) { onClose(); return }
    const controller = new AbortController()
    request.current = controller
    setPending(true)
    setError('')
    try {
      const data = await parseResponse(await fetch(`${apiBaseUrl}/api/materials/${material._id}`, {
        method: deleting ? 'DELETE' : 'PATCH', signal: controller.signal,
        headers: { Authorization: `Bearer ${token}`, ...(!deleting && { 'Content-Type': 'application/json' }) },
        ...(!deleting && { body: JSON.stringify(changes) }),
      }))
      if (!controller.signal.aborted) onComplete(data)
    } catch (failure) {
      if (!controller.signal.aborted) {
        if (deleting && failure.status === 404) {
          onComplete({ message: 'Material is no longer available. List refreshed.' })
        } else {
          setError(failure.message || 'Unable to save changes. Please retry.')
          setErrors(failure.fieldErrors || {})
        }
      }
    } finally {
      request.current = null
      if (!controller.signal.aborted) setPending(false)
    }
  }

  return (
    <dialog ref={dialog} className="material-management-dialog" aria-labelledby="material-management-title"
      onCancel={(event) => { event.preventDefault(); if (!request.current) onClose() }}>
      <h2 id="material-management-title">{deleting ? 'Delete study material?' : 'Edit study material'}</h2>
      <form onSubmit={submit} noValidate aria-busy={pending}>
        {deleting ? <p>Delete <strong>{material.originalFilename}</strong>? It will be removed from the material library.</p>
          : Object.entries(form).map(([name, value]) => (
            <div className="field" key={name}>
              <label htmlFor={`edit-material-${name}`}>{name === 'originalFilename' ? 'Filename' : name[0].toUpperCase() + name.slice(1)}</label>
              <input ref={name === 'originalFilename' ? initialFocus : undefined} id={`edit-material-${name}`}
                value={value} disabled={pending} required maxLength={name === 'originalFilename' ? 255 : 100}
                aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `edit-material-${name}-error` : undefined}
                onChange={(event) => setForm((current) => ({ ...current, [name]: event.target.value }))} />
              {errors[name] && <p className="field-error" id={`edit-material-${name}-error`}>{errors[name]}</p>}
            </div>
          ))}
        {error && <p className="feedback error" role="alert">{error}</p>}
        {pending && <p role="status">{deleting ? 'Deleting material…' : 'Saving changes…'}</p>}
        <div className="material-management-buttons">
          <button ref={deleting ? initialFocus : undefined} type="button" className="secondary-button" disabled={pending} onClick={onClose}>Cancel</button>
          <button type="submit" disabled={pending}>{deleting ? 'Delete material' : 'Save changes'}</button>
        </div>
      </form>
    </dialog>
  )
}
