const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'
let sessionRefreshToken = null
let onSessionTokenRefresh = null

export function configureSessionRefresh(refreshToken, onRefresh) {
  sessionRefreshToken = refreshToken || null
  onSessionTokenRefresh = typeof onRefresh === 'function' ? onRefresh : null
}

export const QUESTION_TYPES = [
  { value: 'mcq', label: 'Multiple choice' },
  { value: 'true_false', label: 'True / False' },
  { value: 'short_answer', label: 'Short answer' },
]

export const DIFFICULTIES = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
]

export function typeLabel(type) {
  return QUESTION_TYPES.find((item) => item.value === type)?.label || type
}

export function difficultyLabel(difficulty) {
  return DIFFICULTIES.find((item) => item.value === difficulty)?.label || difficulty
}

// Calls the backend with the user's JWT and turns error responses into
// errors that carry the HTTP status and any field errors
export async function apiRequest(path, { token, method = 'GET', body } = {}, canRefresh = true) {
  let response
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body !== undefined && !(body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
  }
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined
        ? undefined
        : body instanceof FormData ? body : JSON.stringify(body),
    })
  } catch {
    throw new Error('Unable to reach the server.')
  }

  if (response.status === 401 && canRefresh && sessionRefreshToken) {
    let refreshed
    try {
      const refreshResponse = await fetch(`${API_BASE_URL}/api/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: sessionRefreshToken }),
      })
      refreshed = await refreshResponse.json().catch(() => ({}))
      if (!refreshResponse.ok) {
        configureSessionRefresh(null)
        onSessionTokenRefresh?.(null, null)
        const error = new Error(refreshed.message || 'Your session has expired. Please log in again.')
        error.status = refreshResponse.status
        throw error
      }
    } catch (error) {
      if (error.status) throw error
      throw new Error('Unable to renew your session.')
    }

    sessionRefreshToken = refreshed.refreshToken
    onSessionTokenRefresh?.(refreshed.accessToken, refreshed.refreshToken)
    return apiRequest(path, {
      token: refreshed.accessToken,
      method,
      body,
    }, false)
  }

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.message || 'The request could not be completed.')
    error.status = response.status
    error.fieldErrors = data.errors || {}
    throw error
  }
  return data
}
