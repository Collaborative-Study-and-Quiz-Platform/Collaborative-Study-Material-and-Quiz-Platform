import { useCallback, useEffect, useState } from 'react'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const registrationDefaults = {
  name: '',
  email: '',
  password: '',
  role: 'student',
}

function getRegistrationErrors(form) {
  const errors = {}
  if (!form.name.trim()) errors.name = 'Name is required.'
  if (!form.email.trim()) {
    errors.email = 'Email is required.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }
  if (!form.password) {
    errors.password = 'Password is required.'
  } else if (form.password.length < 8) {
    errors.password = 'Password must be at least 8 characters.'
  }
  if (!['student', 'instructor'].includes(form.role)) {
    errors.role = 'Select Student or Instructor.'
  }
  return errors
}

function getLoginErrors(form) {
  const errors = {}
  if (!form.email.trim()) {
    errors.email = 'Email is required.'
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) {
    errors.email = 'Enter a valid email address.'
  }
  if (!form.password) errors.password = 'Password is required.'
  return errors
}

function MaterialLibrary({ token }) {
  const [materials, setMaterials] = useState([])
  const [filterOptions, setFilterOptions] = useState({ courses: [], subjects: [], topics: [] })
  const [filters, setFilters] = useState({ keyword: '', course: '', subject: '', topic: '' })
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const loadMaterials = useCallback(async (nextFilters, includeOptions = false) => {
    setIsLoading(true)
    setError('')
    const params = new URLSearchParams()
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value.trim()) params.set(key, value.trim())
    })

    try {
      const data = await parseResponse(await fetch(`${API_BASE_URL}/api/materials?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      }))
      setMaterials(data.materials || [])
      if (includeOptions) {
        setFilterOptions({
          courses: [...new Set((data.materials || []).map((material) => material.tags?.course).filter(Boolean))].sort(),
          subjects: [...new Set((data.materials || []).map((material) => material.tags?.subject).filter(Boolean))].sort(),
          topics: [...new Set((data.materials || []).map((material) => material.tags?.topic).filter(Boolean))].sort(),
        })
      }
    } catch (requestError) {
      setError(requestError.message || 'Unable to load study materials.')
    } finally {
      setIsLoading(false)
    }
  }, [token])

  useEffect(() => {
    const timer = window.setTimeout(() => loadMaterials({ keyword: '', course: '', subject: '', topic: '' }, true), 0)
    return () => window.clearTimeout(timer)
  }, [loadMaterials])

  function updateFilter(event) {
    const { name, value } = event.target
    setFilters((current) => ({ ...current, [name]: value }))
  }

  function submitFilters(event) {
    event.preventDefault()
    loadMaterials(filters)
  }

  function clearFilters() {
    const emptyFilters = { keyword: '', course: '', subject: '', topic: '' }
    setFilters(emptyFilters)
    loadMaterials(emptyFilters)
  }

  return (
    <section className="library" aria-labelledby="library-title">
      <div className="library-heading">
        <div>
          <p className="eyebrow">Learn together</p>
          <h1 id="library-title">Study Material Library</h1>
          <p>Find resources by title, course, subject, or topic.</p>
        </div>
      </div>
      <form className="library-filters" onSubmit={submitFilters}>
        <div className="field library-search">
          <label htmlFor="material-keyword">Search materials</label>
          <input
            id="material-keyword"
            name="keyword"
            type="search"
            value={filters.keyword}
            onChange={updateFilter}
            placeholder="Search by title, course, subject or topic"
          />
        </div>
        {[
          ['course', 'Course', filterOptions.courses],
          ['subject', 'Subject', filterOptions.subjects],
          ['topic', 'Topic', filterOptions.topics],
        ].map(([name, label, options]) => (
          <div className="field" key={name}>
            <label htmlFor={`material-filter-${name}`}>{label}</label>
            <select id={`material-filter-${name}`} name={name} value={filters[name]} onChange={updateFilter}>
              <option value="">All {label.toLowerCase()}s</option>
              {options.map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </div>
        ))}
        <div className="library-actions">
          <button type="submit" disabled={isLoading}>{isLoading ? 'Searching...' : 'Search'}</button>
          <button type="button" className="secondary-button" onClick={clearFilters} disabled={isLoading}>Clear</button>
        </div>
      </form>
      {error && <p className="feedback error" role="alert">{error}</p>}
      <p className="results-count" role="status">{isLoading ? 'Loading materials...' : `${materials.length} material${materials.length === 1 ? '' : 's'} found`}</p>
      {!isLoading && !error && materials.length === 0 && (
        <div className="empty-state">
          <h2>No materials found</h2>
          <p>Try a different keyword or clear the filters to browse the library.</p>
        </div>
      )}
      {!isLoading && materials.length > 0 && (
        <div className="material-grid">
          {materials.map((material) => (
            <article className="material-card" key={material._id}>
              <div className="material-card-top">
                <span className="file-badge">{material.fileType?.toUpperCase() || 'FILE'}</span>
                <time dateTime={material.createdAt}>
                  {material.createdAt ? new Date(material.createdAt).toLocaleDateString() : 'Date unavailable'}
                </time>
              </div>
              <h2>{material.originalFilename}</h2>
              <dl className="material-metadata">
                {material.tags?.course && <><dt>Course</dt><dd>{material.tags.course}</dd></>}
                {material.tags?.subject && <><dt>Subject</dt><dd>{material.tags.subject}</dd></>}
                {material.tags?.topic && <><dt>Topic</dt><dd>{material.tags.topic}</dd></>}
              </dl>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

async function parseResponse(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || 'The request could not be completed.')
    error.status = response.status
    error.fieldErrors = data.errors || {}
    throw error
  }
  return data
}

function App() {
  const [mode, setMode] = useState('register')
  const [registrationForm, setRegistrationForm] = useState(registrationDefaults)
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [feedback, setFeedback] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [session, setSession] = useState(null)
  const [materialForm, setMaterialForm] = useState({ file: null, course: '', subject: '', topic: '' })

  function switchMode(nextMode) {
    setMode(nextMode)
    setFieldErrors({})
    setFeedback(null)
  }

  function updateForm(setForm, event) {
    const { name, value } = event.target
    setForm((current) => ({ ...current, [name]: value }))
    setFieldErrors((current) => ({ ...current, [name]: undefined }))
    setFeedback(null)
  }

  async function handleRegister(event) {
    event.preventDefault()
    const errors = getRegistrationErrors(registrationForm)
    if (Object.keys(errors).length) {
      setFieldErrors(errors)
      setFeedback({ type: 'error', text: 'Please correct the highlighted fields.' })
      return
    }

    setIsSubmitting(true)
    setFeedback(null)
    try {
      await parseResponse(await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...registrationForm,
          name: registrationForm.name.trim(),
          email: registrationForm.email.trim(),
        }),
      }))
      setRegistrationForm(registrationDefaults)
      setFeedback({ type: 'success', text: 'Registration successful. You can now log in.' })
      setMode('login')
    } catch (error) {
      setFieldErrors(error.fieldErrors || {})
      setFeedback({
        type: 'error',
        text: error.status === 409
          ? 'An account with this email already exists.'
          : error.message || 'Unable to reach the server.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  async function handleLogin(event) {
    event.preventDefault()
    const errors = getLoginErrors(loginForm)
    if (Object.keys(errors).length) {
      setFieldErrors(errors)
      setFeedback({ type: 'error', text: 'Please correct the highlighted fields.' })
      return
    }

    setIsSubmitting(true)
    setFeedback(null)
    try {
      const data = await parseResponse(await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: loginForm.email.trim(),
          password: loginForm.password,
        }),
      }))
      setLoginForm({ email: '', password: '' })
      setSession({ token: data.token, user: data.user })
      setFeedback({ type: 'success', text: 'Login successful.' })
    } catch (error) {
      setFieldErrors(error.fieldErrors || {})
      setFeedback({
        type: 'error',
        text: error.status === 401
          ? 'Invalid email or password.'
          : error.message || 'Unable to reach the server.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  function logout() {
    setSession(null)
    setFeedback({ type: 'success', text: 'You have been logged out.' })
  }

  async function handleMaterialUpload(event) {
    event.preventDefault()
    const { file, course, subject, topic } = materialForm
    const extension = file?.name.split('.').pop()?.toLowerCase()
    if (!file || !['pdf', 'docx', 'ppt'].includes(extension)) {
      setFeedback({ type: 'error', text: 'Choose a PDF, DOCX, or PPT file.' })
      return
    }
    if (![course, subject, topic].every((value) => value.trim())) {
      setFeedback({ type: 'error', text: 'Course, subject, and topic are required.' })
      return
    }

    const formData = new FormData()
    formData.append('file', file)
    formData.append('course', course.trim())
    formData.append('subject', subject.trim())
    formData.append('topic', topic.trim())
    setIsSubmitting(true)
    setFeedback(null)
    try {
      await parseResponse(await fetch(`${API_BASE_URL}/api/materials`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${session.token}` },
        body: formData,
      }))
      setMaterialForm({ file: null, course: '', subject: '', topic: '' })
      event.target.reset()
      setFeedback({ type: 'success', text: 'Study material uploaded successfully.' })
    } catch (error) {
      setFeedback({ type: 'error', text: error.message || 'Unable to upload the material.' })
    } finally {
      setIsSubmitting(false)
    }
  }

  if (session) {
    return (
      <main className={session.user.role === 'student' ? 'dashboard-page' : 'auth-page'}>
        {session.user.role === 'student' ? (
          <div className="dashboard-shell">
            <header className="dashboard-header">
              <div>
                <p className="eyebrow">CSQP account</p>
                <p className="session-detail">Welcome, {session.user.name}</p>
              </div>
              <button type="button" className="secondary-button logout-button" onClick={logout}>Log out</button>
            </header>
            <MaterialLibrary token={session.token} />
          </div>
        ) : (
          <section className="auth-card" aria-labelledby="welcome-title">
            <p className="eyebrow">CSQP account</p>
            <h1 id="welcome-title">Welcome back</h1>
            <p className="session-detail">{session.user.name} · {session.user.role}</p>
            {feedback && <p className={`feedback ${feedback.type}`} role="status">{feedback.text}</p>}
            {session.user.role === 'instructor' && (
              <form onSubmit={handleMaterialUpload} noValidate>
                <h2>Upload study material</h2>
                <div className="field">
                  <label htmlFor="material-file">File</label>
                  <input id="material-file" type="file" accept=".pdf,.docx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint" onChange={(event) => setMaterialForm((current) => ({ ...current, file: event.target.files[0] }))} />
                </div>
                {['course', 'subject', 'topic'].map((field) => (
                  <div className="field" key={field}>
                    <label htmlFor={`material-${field}`}>{field[0].toUpperCase() + field.slice(1)}</label>
                    <input id={`material-${field}`} type="text" value={materialForm[field]} onChange={(event) => setMaterialForm((current) => ({ ...current, [field]: event.target.value }))} />
                  </div>
                ))}
                <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Uploading...' : 'Upload material'}</button>
              </form>
            )}
            <button type="button" onClick={logout}>Log out</button>
          </section>
        )}
      </main>
    )
  }

  const isRegistering = mode === 'register'
  const form = isRegistering ? registrationForm : loginForm
  const setForm = isRegistering ? setRegistrationForm : setLoginForm
  const submit = isRegistering ? handleRegister : handleLogin

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-heading">
          <p className="eyebrow">CSQP account</p>
          <h1 id="auth-title">{isRegistering ? 'Create your account' : 'Welcome back'}</h1>
          <p>{isRegistering ? 'Join the Collaborative Study Material and Quiz Platform.' : 'Log in to continue learning.'}</p>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="Account access">
          <button type="button" role="tab" aria-selected={isRegistering} className={isRegistering ? 'active' : ''} onClick={() => switchMode('register')}>Register</button>
          <button type="button" role="tab" aria-selected={!isRegistering} className={!isRegistering ? 'active' : ''} onClick={() => switchMode('login')}>Log in</button>
        </div>

        <form onSubmit={submit} noValidate>
          {isRegistering && (
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" type="text" value={form.name} onChange={(event) => updateForm(setForm, event)} autoComplete="name" aria-invalid={Boolean(fieldErrors.name)} />
              {fieldErrors.name && <p className="field-error">{fieldErrors.name}</p>}
            </div>
          )}
          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" value={form.email} onChange={(event) => updateForm(setForm, event)} autoComplete="email" aria-invalid={Boolean(fieldErrors.email)} />
            {fieldErrors.email && <p className="field-error">{fieldErrors.email}</p>}
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" value={form.password} onChange={(event) => updateForm(setForm, event)} autoComplete={isRegistering ? 'new-password' : 'current-password'} aria-invalid={Boolean(fieldErrors.password)} />
            {isRegistering && <p className="field-help">Use at least 8 characters.</p>}
            {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}
          </div>
          {isRegistering && (
            <fieldset className="role-field">
              <legend>Role</legend>
              <div className="role-options">
                {['student', 'instructor'].map((role) => (
                  <label className="role-option" key={role}>
                    <input type="radio" name="role" value={role} checked={form.role === role} onChange={(event) => updateForm(setForm, event)} />
                    <span>{role[0].toUpperCase() + role.slice(1)}</span>
                  </label>
                ))}
              </div>
              {fieldErrors.role && <p className="field-error">{fieldErrors.role}</p>}
            </fieldset>
          )}
          {feedback && <p className={`feedback ${feedback.type}`} role="alert">{feedback.text}</p>}
          <button type="submit" disabled={isSubmitting}>{isSubmitting ? 'Please wait...' : isRegistering ? 'Create account' : 'Log in'}</button>
        </form>
      </section>
    </main>
  )
}

export default App
