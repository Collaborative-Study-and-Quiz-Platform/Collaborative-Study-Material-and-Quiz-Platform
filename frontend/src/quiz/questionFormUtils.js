export const emptyQuestion = {
  text: '',
  type: 'mcq',
  options: ['', '', '', ''],
  correctAnswer: '',
  subject: '',
  topic: '',
  difficulty: 'easy',
  tags: '',
}

// Turns a saved question into form values
export function questionToForm(question) {
  return {
    text: question.text || '',
    type: question.type || 'mcq',
    options: question.type === 'mcq' && question.options?.length ? [...question.options] : ['', '', '', ''],
    correctAnswer: question.correctAnswer || '',
    subject: question.subject || '',
    topic: question.topic || '',
    difficulty: question.difficulty || 'easy',
    tags: (question.tags || []).join(', '),
  }
}

// Splits "tcp, Networks; exam" into ['tcp', 'networks', 'exam']
export function parseTags(text) {
  return [...new Set((text || '').split(/[,;]/)
    .map((tag) => tag.trim().toLowerCase().replace(/\s+/g, ' '))
    .filter(Boolean))]
}

// Builds the request body the question bank API expects
export function formToQuestion(form) {
  const question = {
    text: form.text.trim(),
    type: form.type,
    subject: form.subject.trim(),
    topic: form.topic.trim(),
    difficulty: form.difficulty,
    tags: parseTags(form.tags),
  }

  if (form.type === 'mcq') {
    question.options = form.options.map((option) => option.trim()).filter(Boolean)
    question.correctAnswer = form.correctAnswer.trim()
  } else if (form.type === 'true_false') {
    question.options = []
    question.correctAnswer = form.correctAnswer
  } else {
    question.options = []
    question.correctAnswer = form.correctAnswer.trim()
  }

  return question
}

// Same rules as the backend, so most mistakes show before saving
export function validateQuestionForm(form) {
  const errors = {}
  const question = formToQuestion(form)

  if (!question.text) errors.text = 'Question text is required.'
  else if (question.text.length > 2000) errors.text = 'Question text must be 2000 characters or fewer.'
  if (!question.subject) errors.subject = 'Subject is required.'
  if (!question.topic) errors.topic = 'Topic is required.'
  if (question.tags.length > 10) errors.tags = 'Use at most 10 tags.'
  else if (question.tags.some((tag) => tag.length > 30)) errors.tags = 'Each tag must be 30 characters or fewer.'

  if (form.type === 'mcq') {
    if (question.options.length < 2 || question.options.length > 6) {
      errors.options = 'Add 2 to 6 options.'
    } else if (new Set(question.options.map((option) => option.toLowerCase())).size !== question.options.length) {
      errors.options = 'Options must be unique.'
    } else if (!question.options.includes(question.correctAnswer)) {
      errors.correctAnswer = 'Choose the correct option.'
    }
  }

  if (form.type === 'true_false' && !['true', 'false'].includes(question.correctAnswer)) {
    errors.correctAnswer = 'Choose true or false.'
  }

  return errors
}

export const emptyQuestionFilters = { q: '', tag: '', subject: '', topic: '', difficulty: '', type: '' }

// Turns filter values into a query string for GET /api/questions
export function questionFilterQuery(filters) {
  const params = new URLSearchParams()
  Object.entries(filters).forEach(([key, value]) => {
    if (value.trim()) params.set(key, value.trim())
  })
  return params.toString()
}
