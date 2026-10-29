
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

function ForgotPassword({ onBack }) {
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage('')
    setError('')
    setLoading(true)
    try {
      const data = await parseResponse(await fetch(
        `${API_BASE_URL}/api/auth/forgot-password`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim() }),
        },
      ))
      setMessage(data.message || 'If an account exists, reset instructions will be sent.')
    } catch (requestError) {
      setError(requestError.message || 'Unable to request a password reset.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="auth-card" aria-labelledby="forgot-title">
      <h1 id="forgot-title">Forgot password?</h1>
      <p>Enter your registered email address to request a reset link.</p>
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="reset-email">Email</label>
          <input
            id="reset-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </div>
        {message && <p className="feedback success" role="status">{message}</p>}
        {error && <p className="feedback error" role="alert">{error}</p>}
        <button type="submit" disabled={loading}>
          {loading ? 'Sending...' : 'Send reset link'}
        </button>
      </form>
      <button type="button" className="secondary-button" onClick={onBack}>
        Back to login
      </button>
    </section>
  )
}

function ResetPassword({ token, onBack }) {
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setMessage('')
    setError('')

    if (!token) {
      setError('The reset link is missing its token.')
      return
    }
    if (password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.')
      return
    }

    setLoading(true)
    try {
      const data = await parseResponse(await fetch(
        `${API_BASE_URL}/api/auth/reset-password`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, newPassword: password }),
        },
      ))
      setMessage(data.message || 'Password reset successfully. You can now log in.')
      setPassword('')
      setConfirmPassword('')
      window.history.replaceState({}, '', window.location.pathname)
    } catch (requestError) {
      setError(requestError.message || 'Unable to reset your password.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="auth-card" aria-labelledby="reset-title">
      <h1 id="reset-title">Reset password</h1>
      <p>Choose a new password with at least 8 characters.</p>
      {!token && <p className="feedback error" role="alert">The reset link is missing its token.</p>}
      <form onSubmit={handleSubmit}>
        <div className="field">
          <label htmlFor="new-password">New password</label>
          <input
            id="new-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            minLength={8}
            required
          />
        </div>
        <div className="field">
          <label htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            minLength={8}
            required
          />
        </div>
        {message && <p className="feedback success" role="status">{message}</p>}
        {error && <p className="feedback error" role="alert">{error}</p>}
        <button type="submit" disabled={loading || !token || Boolean(message)}>
          {loading ? 'Resetting...' : 'Reset password'}
        </button>
      </form>
      <button type="button" className="secondary-button" onClick={onBack}>
        Back to login
      </button>
    </section>
  )
}

function MaterialLibrary({ token }) {
  const [materials, setMaterials] = useState([])
  const [filterOptions, setFilterOptions] = useState({
    courses: [], subjects: [], topics: [],
  })
  const [filters, setFilters] = useState({
    keyword: '', course: '', subject: '', topic: '',
  })
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
      const data = await parseResponse(await fetch(
        `${API_BASE_URL}/api/materials?${params}`,
        { headers: { Authorization: `Bearer ${token}` } },
      ))
      setMaterials(data.materials || [])
      if (includeOptions) {
        setFilterOptions({
          courses: [...new Set((data.materials || []).map((m) => m.tags?.course).filter(Boolean))].sort(),
          subjects: [...new Set((data.materials || []).map((m) => m.tags?.subject).filter(Boolean))].sort(),
          topics: [...new Set((data.materials || []).map((m) => m.tags?.topic).filter(Boolean))].sort(),
        })
      }
    } catch (requestError) {
      setError(requestError.message || 'Unable to load study materials.')
    } finally {
      setIsLoading(false)
    }
  }, [token])

  useEffect(() => {
    const timer = window.setTimeout(
      () => loadMaterials({ keyword: '', course: '', subject: '', topic: '' }, true),
      0,
    )
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
            <select
              id={`material-filter-${name}`}
              name={name}
              value={filters[name]}
              onChange={updateFilter}
            >
              <option value="">All {label.toLowerCase()}s</option>
              {options.map((option) => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        ))}

        <div className="library-actions">
          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Searching...' : 'Search'}
          </button>
          <button type="button" className="secondary-button" onClick={clearFilters} disabled={isLoading}>
            Clear
          </button>
        </div>
      </form>

      {error && <p className="feedback error" role="alert">{error}</p>}
      <p className="results-count" role="status">
        {isLoading ? 'Loading materials...' : `${materials.length} material${materials.length === 1 ? '' : 's'} found`}
      </p>

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

function App() {
  const [mode, setMode] = useState('register')
  const [registrationForm, setRegistrationForm] = useState(registrationDefaults)
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [feedback, setFeedback] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [session, setSession] = useState(null)
  const [forgotPasswordMode, setForgotPasswordMode] = useState(false)
  const [resetToken, setResetToken] = useState(
    () => new URLSearchParams(window.location.search).get('token') || '',
  )
  const [materialForm, setMaterialForm] = useState({
    file: null, course: '', subject: '', topic: '',
  })

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

  if (window.location.pathname === '/reset-password') {
    return (
      <main className="auth-page">
        <ResetPassword
          token={resetToken}
          onBack={() => {
            window.history.pushState({}, '', '/')
            setResetToken('')
            setForgotPasswordMode(false)
            setMode('login')
            setFeedback(null)
          }}
        />
      </main>
    )
  }

  if (forgotPasswordMode && !session) {
    return (
      <main className="auth-page">
        <ForgotPassword
          onBack={() => {
            setForgotPasswordMode(false)
            setMode('login')
            setFeedback(null)
          }}
        />
      </main>
    )
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
                  <input
                    id="material-file"
                    type="file"
                    accept=".pdf,.docx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint"
                    onChange={(event) => setMaterialForm((current) => ({
                      ...current, file: event.target.files[0],
                    }))}
                  />
                </div>
                {['course', 'subject', 'topic'].map((field) => (
                  <div className="field" key={field}>
                    <label htmlFor={`material-${field}`}>
                      {field[0].toUpperCase() + field.slice(1)}
                    </label>
                    <input
                      id={`material-${field}`}
                      type="text"
                      value={materialForm[field]}
                      onChange={(event) => setMaterialForm((current) => ({
                        ...current, [field]: event.target.value,
                      }))}
                    />
                  </div>
                ))}
                <button type="submit" disabled={isSubmitting}>
                  {isSubmitting ? 'Uploading...' : 'Upload material'}
                </button>
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
          <p>
            {isRegistering
              ? 'Join the Collaborative Study Material and Quiz Platform.'
              : 'Log in to continue learning.'}
          </p>
        </div>

        <div className="auth-tabs" role="tablist" aria-label="Account access">
          <button type="button" role="tab" aria-selected={isRegistering}
            className={isRegistering ? 'active' : ''} onClick={() => switchMode('register')}>
            Register
          </button>
          <button type="button" role="tab" aria-selected={!isRegistering}
            className={!isRegistering ? 'active' : ''} onClick={() => switchMode('login')}>
            Log in
          </button>
        </div>

        <form onSubmit={submit} noValidate>
          {isRegistering && (
            <div className="field">
              <label htmlFor="name">Name</label>
              <input id="name" name="name" type="text" value={form.name}
                onChange={(event) => updateForm(setForm, event)} autoComplete="name"
                aria-invalid={Boolean(fieldErrors.name)} />
              {fieldErrors.name && <p className="field-error">{fieldErrors.name}</p>}
            </div>
          )}

          <div className="field">
            <label htmlFor="email">Email</label>
            <input id="email" name="email" type="email" value={form.email}
              onChange={(event) => updateForm(setForm, event)} autoComplete="email"
              aria-invalid={Boolean(fieldErrors.email)} />
            {fieldErrors.email && <p className="field-error">{fieldErrors.email}</p>}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input id="password" name="password" type="password" value={form.password}
              onChange={(event) => updateForm(setForm, event)}
              autoComplete={isRegistering ? 'new-password' : 'current-password'}
              aria-invalid={Boolean(fieldErrors.password)} />
            {isRegistering && <p className="field-help">Use at least 8 characters.</p>}
            {fieldErrors.password && <p className="field-error">{fieldErrors.password}</p>}
          </div>

          {isRegistering && (
            <fieldset className="role-field">
              <legend>Role</legend>
              <div className="role-options">
                {['student', 'instructor'].map((role) => (
                  <label className="role-option" key={role}>
                    <input type="radio" name="role" value={role} checked={form.role === role}
                      onChange={(event) => updateForm(setForm, event)} />
                    <span>{role[0].toUpperCase() + role.slice(1)}</span>
                  </label>
                ))}
              </div>
              {fieldErrors.role && <p className="field-error">{fieldErrors.role}</p>}
            </fieldset>
          )}

          {feedback && <p className={`feedback ${feedback.type}`} role="alert">{feedback.text}</p>}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Please wait...' : isRegistering ? 'Create account' : 'Log in'}
          </button>
        </form>

        {!isRegistering && (
          <button type="button" className="secondary-button"
            onClick={() => {
              setForgotPasswordMode(true)
              setFeedback(null)
              setFieldErrors({})
            }}>
            Forgot password?
          </button>
        )}
      </section>
    </main>
  )
}

export default App
