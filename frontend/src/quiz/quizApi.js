const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000'

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
export async function apiRequest(path, { token, method = 'GET', body } = {}) {
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new Error('Unable to reach the server.')
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
