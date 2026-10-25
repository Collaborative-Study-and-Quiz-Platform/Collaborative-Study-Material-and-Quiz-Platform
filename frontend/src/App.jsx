import { useState } from 'react'
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

function App() {
  const [mode, setMode] = useState('register')
  const [registrationForm, setRegistrationForm] = useState(registrationDefaults)
  const [loginForm, setLoginForm] = useState({ email: '', password: '' })
  const [fieldErrors, setFieldErrors] = useState({})
  const [feedback, setFeedback] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [session, setSession] = useState(null)

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

  if (session) {
    return (
      <main className="auth-page">
        <section className="auth-card" aria-labelledby="welcome-title">
          <p className="eyebrow">CSQP account</p>
          <h1 id="welcome-title">Welcome back</h1>
          <p className="session-detail">{session.user.name} · {session.user.role}</p>
          {feedback && <p className={`feedback ${feedback.type}`} role="status">{feedback.text}</p>}
          <button type="button" onClick={logout}>Log out</button>
        </section>
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
