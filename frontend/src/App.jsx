import { useState } from 'react'
import './App.css'

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'
const initialForm = {
  name: '',
  email: '',
  password: '',
  role: 'student',
}

function validateForm(form) {
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

function App() {
  const [form, setForm] = useState(initialForm)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  function handleChange(event) {
    const { name, value } = event.target
    setForm((currentForm) => ({ ...currentForm, [name]: value }))
    setErrors((currentErrors) => ({ ...currentErrors, [name]: undefined }))
    setMessage(null)
  }

  async function handleSubmit(event) {
    event.preventDefault()
    const validationErrors = validateForm(form)

    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors)
      setMessage({ type: 'error', text: 'Please correct the highlighted fields.' })
      return
    }

    setIsSubmitting(true)
    setErrors({})
    setMessage(null)

    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          email: form.email.trim(),
          password: form.password,
          role: form.role,
        }),
      })
      const data = await response.json()

      if (!response.ok) {
        if (response.status === 400 && data.errors) {
          setErrors(data.errors)
        }
        const text = response.status === 409
          ? 'An account with this email already exists.'
          : data.message || 'Registration failed. Please try again.'
        setMessage({ type: 'error', text })
        return
      }

      setForm(initialForm)
      setMessage({ type: 'success', text: 'Registration successful. Your account is ready.' })
    } catch {
      setMessage({
        type: 'error',
        text: 'Unable to reach the server. Check that the backend is running and try again.',
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <main className="registration-page">
      <section className="registration-card" aria-labelledby="registration-title">
        <div className="registration-heading">
          <p className="eyebrow">CSQP account</p>
          <h1 id="registration-title">Create your account</h1>
          <p>Join the Collaborative Study Material and Quiz Platform.</p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div className="field">
            <label htmlFor="name">Name</label>
            <input
              id="name"
              name="name"
              type="text"
              value={form.name}
              onChange={handleChange}
              autoComplete="name"
              aria-invalid={Boolean(errors.name)}
              aria-describedby={errors.name ? 'name-error' : undefined}
            />
            {errors.name && <p className="field-error" id="name-error">{errors.name}</p>}
          </div>

          <div className="field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              value={form.email}
              onChange={handleChange}
              autoComplete="email"
              aria-invalid={Boolean(errors.email)}
              aria-describedby={errors.email ? 'email-error' : undefined}
            />
            {errors.email && <p className="field-error" id="email-error">{errors.email}</p>}
          </div>

          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              value={form.password}
              onChange={handleChange}
              autoComplete="new-password"
              aria-invalid={Boolean(errors.password)}
              aria-describedby={errors.password ? 'password-error' : 'password-help'}
            />
            <p className="field-help" id="password-help">Use at least 8 characters.</p>
            {errors.password && <p className="field-error" id="password-error">{errors.password}</p>}
          </div>

          <fieldset className="field role-field">
            <legend>Role</legend>
            <div className="role-options">
              <label className="role-option">
                <input
                  type="radio"
                  name="role"
                  value="student"
                  checked={form.role === 'student'}
                  onChange={handleChange}
                />
                <span>Student</span>
              </label>
              <label className="role-option">
                <input
                  type="radio"
                  name="role"
                  value="instructor"
                  checked={form.role === 'instructor'}
                  onChange={handleChange}
                />
                <span>Instructor</span>
              </label>
            </div>
            {errors.role && <p className="field-error">{errors.role}</p>}
          </fieldset>

          {message && (
            <p className={`form-message ${message.type}`} role="alert">
              {message.text}
            </p>
          )}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Creating account...' : 'Create account'}
          </button>
        </form>
      </section>
    </main>
  )
}

export default App
