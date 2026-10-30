
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

function groupMaterials(materials) {
  const courses = new Map()

  materials.forEach((material) => {
    const courseName = material.tags?.course || 'Course unavailable'
    const subjectName = material.tags?.subject || 'Subject unavailable'
    const topicName = material.tags?.topic || 'Topic unavailable'

    if (!courses.has(courseName)) courses.set(courseName, new Map())
    const subjects = courses.get(courseName)
    if (!subjects.has(subjectName)) subjects.set(subjectName, new Map())
    const topics = subjects.get(subjectName)
    if (!topics.has(topicName)) topics.set(topicName, [])
    topics.get(topicName).push(material)
  })

  return [...courses.entries()].map(([name, subjects]) => ({
    name,
    materialCount: [...subjects.values()].reduce(
      (total, topics) => total + [...topics.values()].reduce((count, items) => count + items.length, 0),
      0,
    ),
    subjects: [...subjects.entries()].map(([subjectName, topics]) => ({
      name: subjectName,
      materialCount: [...topics.values()].reduce((count, items) => count + items.length, 0),
      topics: [...topics.entries()].map(([topicName, items]) => ({
        name: topicName,
        materials: items,
      })),
    })),
  }))
}

function formatFileSize(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return ''
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function MaterialRow({ material }) {
  const fileSize = formatFileSize(material.fileSize)
  const uploadedDate = material.createdAt
    ? new Date(material.createdAt).toLocaleDateString()
    : ''

  return (
    <article className="material-row">
      <span className="file-badge">{material.fileType?.toUpperCase() || 'FILE'}</span>
      <div className="material-row-content">
        <h4>{material.originalFilename || 'Filename unavailable'}</h4>
        <p>
          {[
            material.mimeType,
            fileSize && `Size ${fileSize}`,
            uploadedDate && `Uploaded ${uploadedDate}`,
          ].filter(Boolean).join(' · ') || 'Additional file details unavailable'}
        </p>
      </div>
    </article>
  )
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
  const [resultCount, setResultCount] = useState(0)
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
      const nextMaterials = Array.isArray(data.materials) ? data.materials : []
      setMaterials(nextMaterials)
      setResultCount(Number.isFinite(data.count) ? data.count : nextMaterials.length)
      if (includeOptions) {
        setFilterOptions({
          courses: [...new Set(nextMaterials.map((m) => m.tags?.course).filter(Boolean))].sort(),
          subjects: [...new Set(nextMaterials.map((m) => m.tags?.subject).filter(Boolean))].sort(),
          topics: [...new Set(nextMaterials.map((m) => m.tags?.topic).filter(Boolean))].sort(),
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

  const courseGroups = groupMaterials(materials)

  return (
    <section className="library" aria-labelledby="library-title">
      <div className="library-heading">
        <div>
          <p className="eyebrow">Study resources</p>
          <h1 id="library-title">Browse materials</h1>
          <p>Search materials shared by instructors.</p>
        </div>
      </div>

      <form className="library-filters filter-panel" onSubmit={submitFilters}>
        <div className="field library-search">
          <label htmlFor="material-keyword">Keyword</label>
          <input
            id="material-keyword"
            name="keyword"
            type="search"
            value={filters.keyword}
            onChange={updateFilter}
            placeholder="File name, course, subject, topic"
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
      <p className="results-count" role="status" aria-live="polite">
        {isLoading
          ? 'Loading materials...'
          : error
            ? 'Materials unavailable.'
            : `${resultCount} material${resultCount === 1 ? '' : 's'} in ${courseGroups.length} course${courseGroups.length === 1 ? '' : 's'}`}
      </p>

      {isLoading && (
        <div className="explorer-state" role="status">
          <span className="loading-indicator" aria-hidden="true" />
          <p>Loading study materials…</p>
        </div>
      )}

      {!isLoading && !error && resultCount === 0 && (
        <div className="empty-state">
          <h2>No materials found</h2>
          <p>Try a different keyword or clear the filters to browse the library.</p>
        </div>
      )}

      {!isLoading && !error && resultCount > 0 && (
        <div className="material-explorer" aria-label="Study materials by course, subject, and topic">
          {courseGroups.map((course) => (
            <details className="explorer-course" key={course.name} open>
              <summary>
                <span className="tree-label">{course.name}</span>
                <span className="tree-count">{course.materialCount} material{course.materialCount === 1 ? '' : 's'}</span>
              </summary>
              <div className="explorer-subjects">
                {course.subjects.map((subject) => (
                  <details className="explorer-subject" key={subject.name}>
                    <summary>
                      <span className="tree-label">{subject.name}</span>
                      <span className="tree-count">{subject.materialCount} material{subject.materialCount === 1 ? '' : 's'}</span>
                    </summary>
                    <div className="explorer-topics">
                      {subject.topics.map((topic) => (
                        <details className="explorer-topic" key={topic.name}>
                          <summary>
                            <span className="tree-label">{topic.name}</span>
                            <span className="tree-count">{topic.materials.length} material{topic.materials.length === 1 ? '' : 's'}</span>
                          </summary>
                          <div className="topic-materials">
                            {topic.materials.map((material) => (
                              <MaterialRow key={material._id || `${topic.name}-${material.originalFilename}`} material={material} />
                            ))}
                          </div>
                        </details>
                      ))}
                    </div>
                  </details>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  )
}

function FeatureIcon({ name }) {
  const icons = {
    materials: <><path d="M4 5.5c3.8-1.4 6.8-.8 8 1v13c-1.2-1.8-4.2-2.4-8-1z" /><path d="M20 5.5c-3.8-1.4-6.8-.8-8 1v13c1.2-1.8 4.2-2.4 8-1z" /></>,
    saved: <path d="M6 4.8A1.8 1.8 0 0 1 7.8 3h8.4A1.8 1.8 0 0 1 18 4.8V21l-6-4-6 4z" />,
    download: <><path d="M12 3v11" /><path d="m7.5 10 4.5 4.5 4.5-4.5" /><path d="M5 16v4h14v-4" /></>,
    analytics: <><path d="M4 19V9h4v10zM10 19V4h4v15zM16 19v-7h4v7z" /></>,
    upload: <><path d="M12 16V4" /><path d="m7.5 8.5 4.5-4.5 4.5 4.5" /><path d="M5 15v5h14v-5" /></>,
    manage: <><path d="M3.5 6.5h7l2 2h8v10a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M3.5 9h17" /></>,
  }

  return (
    <svg className="feature-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {icons[name]}
    </svg>
  )
}

function DashboardHome({ user, role, onNavigate }) {
  const isStudent = role === 'student'
  const features = isStudent
    ? [
      { title: 'Study Materials', description: 'Browse and search shared course resources.', icon: 'materials', page: 'browse' },
      { title: 'Saved Materials', description: 'Keep useful study resources together.', icon: 'saved', comingSoon: true },
      { title: 'View / Download Materials', description: 'Open or save documents for offline study.', icon: 'download', comingSoon: true },
      { title: 'Learning Analytics', description: 'Review your learning activity and progress.', icon: 'analytics', comingSoon: true },
    ]
    : [
      { title: 'Upload Study Material', description: 'Share resources organized by course, subject, and topic.', icon: 'upload', page: 'upload' },
      { title: 'Browse Materials', description: 'Explore shared study resources by course, subject, and topic.', icon: 'materials', page: 'browse' },
      { title: 'Manage My Materials', description: 'Review and organize materials you have uploaded.', icon: 'manage', comingSoon: true },
      { title: 'Material Analytics', description: 'Explore engagement with your shared resources.', icon: 'analytics', comingSoon: true },
    ]

  return (
    <section className="dashboard-home" aria-labelledby="dashboard-title">
      <div className="page-heading">
        <p className="eyebrow">Workspace</p>
        <h1 id="dashboard-title">Welcome back, {user.name}!</h1>
        <p>{isStudent ? 'Your learning workspace.' : 'Your teaching workspace.'}</p>
      </div>
      <div className="dashboard-features" aria-label={isStudent ? 'Student features' : 'Instructor features'}>
        {features.map((feature) => {
          const cardContent = (
            <>
              <span className="feature-icon-wrap"><FeatureIcon name={feature.icon} /></span>
              <span className="feature-card-copy">
                <strong>{feature.title}</strong>
                <span>{feature.description}</span>
              </span>
              {feature.comingSoon
                ? <span className="coming-soon-badge">Coming soon</span>
                : <span className="feature-card-arrow" aria-hidden="true">→</span>}
            </>
          )

          return feature.page ? (
            <button type="button" className="dashboard-feature-card feature-card-action" key={feature.title}
              onClick={() => onNavigate(feature.page)}>
              {cardContent}
            </button>
          ) : (
            <article className="dashboard-feature-card feature-card-soon" key={feature.title}>
              {cardContent}
            </article>
          )
        })}
      </div>
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
  const [activePage, setActivePage] = useState('dashboard')
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
      setActivePage('dashboard')
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
    setActivePage('dashboard')
    setFeedback({ type: 'success', text: 'You have been logged out.' })
  }

  function navigateTo(nextPage) {
    setActivePage(nextPage)
    setFeedback(null)
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
    const role = session.user.role
    const isStudent = role === 'student'
    const isInstructor = role === 'instructor'
    const pageLabels = {
      dashboard: 'Dashboard',
      browse: 'Browse materials',
      upload: 'Upload study material',
    }
    const pageLabel = pageLabels[activePage] || 'Dashboard'
    const initials = (session.user.name || session.user.email || 'U')
      .split(/[\s@]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('')

    return (
      <div className="workspace-app">
        <aside className="workspace-sidebar" aria-label="Main navigation">
          <a className="brand-lockup" href="#workspace" onClick={(event) => {
            event.preventDefault()
            navigateTo('dashboard')
          }} aria-label="CSQP dashboard">
            <span className="brand-mark">C</span>
            <span className="brand-copy"><strong>CSQP</strong><small>Learn together</small></span>
          </a>

          <div className="sidebar-section-label">Workspace</div>
          <nav className="workspace-nav">
            <button type="button" className={activePage === 'dashboard' ? 'active' : ''}
              aria-current={activePage === 'dashboard' ? 'page' : undefined}
              onClick={() => navigateTo('dashboard')} title="Dashboard">
              <span className="nav-icon" aria-hidden="true">⌂</span><span className="nav-label">Dashboard</span>
            </button>
            {(isStudent || isInstructor) && (
              <button type="button" className={activePage === 'browse' ? 'active' : ''}
                aria-current={activePage === 'browse' ? 'page' : undefined}
                onClick={() => navigateTo('browse')} title="Browse materials">
                <span className="nav-icon" aria-hidden="true">▤</span><span className="nav-label">Browse materials</span>
              </button>
            )}
            {isInstructor && (
              <button type="button" className={activePage === 'upload' ? 'active' : ''}
                aria-current={activePage === 'upload' ? 'page' : undefined}
                onClick={() => navigateTo('upload')} title="Upload study material">
                <span className="nav-icon" aria-hidden="true">↑</span><span className="nav-label">Upload study material</span>
              </button>
            )}
          </nav>

          <div className="sidebar-profile">
            <span className="profile-avatar" aria-hidden="true">{initials}</span>
            <span className="profile-copy">
              <strong>{session.user.name}</strong>
              <small>{role[0].toUpperCase() + role.slice(1)}</small>
            </span>
            <button type="button" className="logout-button" onClick={logout} title="Log out" aria-label="Log out">
              <span aria-hidden="true">↗</span><span className="logout-label">Log out</span>
            </button>
          </div>
        </aside>

        <div className="workspace-main">
          <header className="workspace-topbar">
            <div className="breadcrumbs" aria-label="Breadcrumb">
              <span>Workspace</span><span className="breadcrumb-divider" aria-hidden="true">/</span>
              <span aria-current="page">{pageLabel}</span>
            </div>
            <span className="header-email">{session.user.email}</span>
          </header>

          <main className="workspace-scroll">
            <div className="workspace-content">
              {feedback && (
                <p className={`feedback workspace-feedback ${feedback.type}`} role={feedback.type === 'error' ? 'alert' : 'status'}>
                  {feedback.text}
                </p>
              )}
              {activePage === 'dashboard' && (
                <DashboardHome user={session.user} role={role} onNavigate={navigateTo} />
              )}
              {activePage === 'browse' && (isStudent || isInstructor) && <MaterialLibrary token={session.token} />}
              {activePage === 'upload' && isInstructor && (
                <section className="upload-page" aria-labelledby="upload-title">
                  <div className="page-heading">
                    <p className="eyebrow">Study resources</p>
                    <h1 id="upload-title">Upload study material</h1>
                    <p>Add a document and organize it for students.</p>
                  </div>
                  <form className="upload-panel" onSubmit={handleMaterialUpload} noValidate>
                    <div className="field upload-file-field">
                      <label htmlFor="material-file">Document</label>
                      <input
                        id="material-file"
                        type="file"
                        accept=".pdf,.docx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint"
                        onChange={(event) => setMaterialForm((current) => ({
                          ...current, file: event.target.files[0],
                        }))}
                      />
                      <p className="field-help">PDF, DOCX, and PPT files are supported.</p>
                    </div>
                    <div className="upload-metadata-grid">
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
                            maxLength={100}
                            required
                          />
                        </div>
                      ))}
                    </div>
                    <button type="submit" className="upload-submit" disabled={isSubmitting}>
                      {isSubmitting ? 'Uploading...' : 'Upload material'}
                    </button>
                  </form>
                </section>
              )}
            </div>
          </main>
        </div>
      </div>
    )
  }

  const isRegistering = mode === 'register'
  const form = isRegistering ? registrationForm : loginForm
  const setForm = isRegistering ? setRegistrationForm : setLoginForm
  const submit = isRegistering ? handleRegister : handleLogin

  return (
    <main className="auth-page auth-page-split">
      <div className="auth-layout">
        <aside className="auth-visual" aria-label="CSQP learning resources">
          <div className="auth-brand-lockup">
            <span className="auth-brand-mark">C</span>
            <span><strong>CSQP</strong><small>Learn together</small></span>
          </div>
          <div className="auth-visual-copy">
            <p className="auth-visual-kicker">Your collaborative study space</p>
            <h2>Good resources.<br />Better learning.</h2>
            <p>Keep your learning materials organized and make it easier to study together.</p>
          </div>
          <svg className="learning-illustration" viewBox="0 0 560 390" role="img" aria-labelledby="learning-art-title">
            <title id="learning-art-title">Study documents, books, organized folders, and learning together</title>
            <defs>
              <linearGradient id="folder-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#b8a8ff" />
                <stop offset="1" stopColor="#8978ee" />
              </linearGradient>
              <linearGradient id="book-gradient" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#6658d9" />
                <stop offset="1" stopColor="#4435b6" />
              </linearGradient>
              <filter id="art-shadow" x="-20%" y="-20%" width="140%" height="150%">
                <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#5342b1" floodOpacity=".16" />
              </filter>
            </defs>
            <circle cx="290" cy="190" r="156" fill="#fff" fillOpacity=".42" />
            <circle cx="290" cy="190" r="126" fill="none" stroke="#fff" strokeOpacity=".42" strokeDasharray="4 10" />
            <g filter="url(#art-shadow)">
              <path d="M111 145h126l20 22h192a14 14 0 0 1 14 14v116a18 18 0 0 1-18 18H116a18 18 0 0 1-18-18V163a18 18 0 0 1 13-18Z" fill="url(#folder-gradient)" />
              <path d="M100 190a16 16 0 0 1 16-16h327a17 17 0 0 1 17 17v105a20 20 0 0 1-20 20H120a20 20 0 0 1-20-20Z" fill="#fff" fillOpacity=".68" />
              <rect x="151" y="82" width="120" height="151" rx="13" fill="#fff" />
              <path d="M235 82v36h36" fill="#eeeaff" />
              <path d="M235 82v28a8 8 0 0 0 8 8h28" fill="#ddd6ff" />
              <rect x="171" y="139" width="74" height="7" rx="3.5" fill="#d9d4ef" />
              <rect x="171" y="157" width="58" height="6" rx="3" fill="#e6e2f3" />
              <rect x="171" y="174" width="69" height="6" rx="3" fill="#e6e2f3" />
              <rect x="171" y="194" width="39" height="19" rx="6" fill="#fce8ee" />
              <text x="190.5" y="207" textAnchor="middle" fill="#c64968" fontSize="9" fontWeight="700">PDF</text>
              <rect x="295" y="111" width="111" height="127" rx="12" fill="#fff" />
              <rect x="313" y="133" width="74" height="7" rx="3.5" fill="#d9d4ef" />
              <rect x="313" y="151" width="58" height="6" rx="3" fill="#e6e2f3" />
              <rect x="313" y="168" width="74" height="6" rx="3" fill="#e6e2f3" />
              <rect x="313" y="185" width="62" height="6" rx="3" fill="#e6e2f3" />
              <path d="M318 219h62" stroke="#a195ed" strokeWidth="5" strokeLinecap="round" />
            </g>
            <g filter="url(#art-shadow)">
              <path d="M163 276c28-17 57-17 86 0v50c-29-17-58-17-86 0Z" fill="#fff" />
              <path d="M249 276c29-17 58-17 86 0v50c-28-17-57-17-86 0Z" fill="#f0edff" />
              <path d="M249 276v50" stroke="#d5cff7" strokeWidth="3" />
              <path d="M173 288c18-8 38-8 61 2M173 302c18-8 38-8 61 2M260 290c18-8 38-8 64 1M260 304c18-8 38-8 64 1" fill="none" stroke="#cbc4ef" strokeWidth="4" strokeLinecap="round" />
            </g>
            <g>
              <circle cx="424" cy="102" r="26" fill="#fff" />
              <path d="M413 103a11 11 0 1 1 22 0v2h-22Z" fill="#e6a77e" />
              <path d="M407 126c2-12 10-18 17-18s15 6 17 18" fill="#7868df" />
              <circle cx="114" cy="247" r="22" fill="#e8e4ff" />
              <path d="M106 248a8 8 0 1 1 16 0v2h-16Z" fill="#b97f6b" />
              <path d="M101 268c2-10 7-15 13-15s12 5 14 15" fill="#9b8aee" />
              <circle cx="443" cy="276" r="7" fill="#fff" />
              <circle cx="126" cy="100" r="5" fill="#fff" />
              <path d="m444 235 5 10 11 2-8 7 2 11-10-5-10 5 2-11-8-7 11-2Z" fill="#f7dba2" />
            </g>
          </svg>
          <p className="auth-visual-footer">One organized space for shared learning.</p>
        </aside>

        <section className="auth-card auth-form-card" aria-labelledby="auth-title">
          <div className="auth-heading">
            <p className="eyebrow">CSQP account</p>
            <h1 id="auth-title">{isRegistering ? 'Create your account' : 'Welcome back'}</h1>
            <p>
              {isRegistering
                ? 'Join the collaborative study materials community.'
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
      </div>
    </main>
  )
}

export default App
