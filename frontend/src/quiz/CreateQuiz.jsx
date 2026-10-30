import { useCallback, useEffect, useState } from 'react'
import { DIFFICULTIES, QUESTION_TYPES, apiRequest } from './quizApi'
import { QuestionSummary } from './QuestionBank'
import { QuestionFields } from './QuestionForm'
import { emptyQuestion, formToQuestion, validateQuestionForm } from './questionFormUtils'

const emptySettings = {
  title: '',
  description: '',
  durationMinutes: '30',
  passingScore: '50',
  showAnswers: false,
}

let nextItemKey = 1

function scrollToPanel(id) {
  window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 0)
}

function validateSettings(settings) {
  const errors = {}
  const duration = Number(settings.durationMinutes)
  const passing = Number(settings.passingScore)

  if (!settings.title.trim()) errors.title = 'Quiz title is required.'
  if (!Number.isInteger(duration) || duration < 1 || duration > 600) {
    errors.durationMinutes = 'Enter whole minutes from 1 to 600.'
  }
  if (settings.passingScore === '' || Number.isNaN(passing) || passing < 0 || passing > 100) {
    errors.passingScore = 'Enter a percentage from 0 to 100.'
  }
  return errors
}

// Lets the instructor pick questions from the bank
function BankPicker({ token, selectedIds, onAdd, onClose }) {
  const [filters, setFilters] = useState({ subject: '', topic: '', difficulty: '', type: '' })
  const [questions, setQuestions] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async (nextFilters) => {
    setIsLoading(true)
    setError('')
    const params = new URLSearchParams()
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value.trim()) params.set(key, value.trim())
    })
    try {
      const data = await apiRequest(`/api/questions?${params}`, { token })
      setQuestions(Array.isArray(data.questions) ? data.questions : [])
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setIsLoading(false)
    }
  }, [token])

  useEffect(() => {
    const timer = window.setTimeout(() => load({ subject: '', topic: '', difficulty: '', type: '' }), 0)
    return () => window.clearTimeout(timer)
  }, [load])

  function updateFilter(event) {
    const { name, value } = event.target
    setFilters((current) => ({ ...current, [name]: value }))
  }

  return (
    <div id="quiz-picker" className="upload-panel quiz-picker">
      <div className="quiz-heading-row">
        <h2 className="quiz-section-title">Add from the question bank</h2>
        <button type="button" className="secondary-button quiz-auto-button" onClick={onClose}>Done</button>
      </div>
      <form className="library-filters quiz-filters" onSubmit={(event) => { event.preventDefault(); load(filters) }}>
        {['subject', 'topic'].map((name) => (
          <div className="field" key={name}>
            <label htmlFor={`picker-${name}`}>{name[0].toUpperCase() + name.slice(1)}</label>
            <input id={`picker-${name}`} name={name} type="search" value={filters[name]} onChange={updateFilter} placeholder={`Any ${name}`} />
          </div>
        ))}
        <div className="field">
          <label htmlFor="picker-difficulty">Difficulty</label>
          <select id="picker-difficulty" name="difficulty" value={filters.difficulty} onChange={updateFilter}>
            <option value="">Any difficulty</option>
            {DIFFICULTIES.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="picker-type">Type</label>
          <select id="picker-type" name="type" value={filters.type} onChange={updateFilter}>
            <option value="">Any type</option>
            {QUESTION_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </div>
        <div className="library-actions">
          <button type="submit" disabled={isLoading}>{isLoading ? 'Searching...' : 'Search'}</button>
        </div>
      </form>

      {error && <p className="feedback error" role="alert">{error}</p>}
      {!isLoading && !error && questions.length === 0 && (
        <div className="empty-state">
          <h2>No questions found</h2>
          <p>Add questions in the question bank, or write a new one for this quiz.</p>
        </div>
      )}
      <div className="quiz-list">
        {questions.map((question) => {
          const added = selectedIds.has(question._id)
          return (
            <article className="quiz-card" key={question._id}>
              <QuestionSummary question={question} />
              <div className="quiz-card-actions">
                <button
                  type="button"
                  className="quiz-primary-button"
                  disabled={added}
                  onClick={() => onAdd(question)}
                >
                  {added ? 'Added' : 'Add to quiz'}
                </button>
              </div>
            </article>
          )
        })}
      </div>
    </div>
  )
}

// Instructor quiz builder (CSQP-F-020)
export default function CreateQuiz({ token, onCreated }) {
  const [settings, setSettings] = useState(emptySettings)
  const [items, setItems] = useState([])
  const [showPicker, setShowPicker] = useState(false)
  const [draftQuestion, setDraftQuestion] = useState(null)
  const [draftErrors, setDraftErrors] = useState({})
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState(null)
  const [isSaving, setIsSaving] = useState(false)

  const selectedIds = new Set(items.filter((item) => item.bankQuestion).map((item) => item.bankQuestion._id))
  const totalMarks = items.reduce((sum, item) => sum + (Number(item.marks) || 0), 0)

  function clearErrorMessage() {
    setMessage((current) => (current?.type === 'error' ? null : current))
  }

  function updateSetting(name, value) {
    setSettings((current) => ({ ...current, [name]: value }))
    setErrors((current) => ({ ...current, [name]: undefined }))
    clearErrorMessage()
  }

  function addBankQuestion(question) {
    setItems((current) => [...current, { key: nextItemKey++, bankQuestion: question, marks: '1' }])
    setErrors((current) => ({ ...current, questions: undefined }))
    clearErrorMessage()
  }

  function addNewQuestion(event) {
    event.preventDefault()
    const questionErrors = validateQuestionForm(draftQuestion)
    if (Object.keys(questionErrors).length) {
      setDraftErrors(questionErrors)
      return
    }
    setItems((current) => [...current, { key: nextItemKey++, newQuestion: draftQuestion, marks: '1' }])
    setDraftQuestion(null)
    setDraftErrors({})
    setErrors((current) => ({ ...current, questions: undefined }))
    clearErrorMessage()
  }

  function updateMarks(key, marks) {
    setItems((current) => current.map((item) => (item.key === key ? { ...item, marks } : item)))
  }

  function moveItem(index, direction) {
    setItems((current) => {
      const next = [...current]
      const target = index + direction
      if (target < 0 || target >= next.length) return current
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })
  }

  function removeItem(key) {
    setItems((current) => current.filter((item) => item.key !== key))
  }

  async function createQuiz(event) {
    event.preventDefault()
    const settingErrors = validateSettings(settings)
    const marksInvalid = items.some((item) => {
      const marks = Number(item.marks)
      return !Number.isInteger(marks) || marks < 1 || marks > 100
    })

    if (!items.length) settingErrors.questions = 'Add at least one question.'
    else if (marksInvalid) settingErrors.questions = 'Marks must be whole numbers from 1 to 100.'

    if (Object.keys(settingErrors).length) {
      setErrors(settingErrors)
      setMessage({ type: 'error', text: 'Please fix the highlighted fields.' })
      return
    }

    setIsSaving(true)
    setMessage(null)
    try {
      const data = await apiRequest('/api/quizzes', {
        token,
        method: 'POST',
        body: {
          title: settings.title.trim(),
          description: settings.description.trim(),
          durationMinutes: Number(settings.durationMinutes),
          passingScore: Number(settings.passingScore),
          showAnswers: settings.showAnswers,
          questions: items.map((item) => (item.bankQuestion
            ? { questionId: item.bankQuestion._id, marks: Number(item.marks) }
            : { question: formToQuestion(item.newQuestion), marks: Number(item.marks) })),
        },
      })
      setSettings(emptySettings)
      setItems([])
      onCreated(data.quiz)
    } catch (error) {
      setErrors(error.fieldErrors || {})
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <section className="upload-page" aria-labelledby="create-quiz-title">
      <div className="page-heading">
        <p className="eyebrow">Quizzes</p>
        <h1 id="create-quiz-title">Create quiz</h1>
        <p>Set up the quiz, then add questions from the bank or write new ones.</p>
      </div>

      {message && (
        <p className={`feedback workspace-feedback ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      <form className="upload-panel" onSubmit={createQuiz} noValidate>
        <h2 className="quiz-section-title">Quiz settings</h2>
        <div className="field">
          <label htmlFor="quiz-title">Title</label>
          <input id="quiz-title" type="text" maxLength={200} value={settings.title}
            onChange={(event) => updateSetting('title', event.target.value)} />
          {errors.title && <p className="field-error">{errors.title}</p>}
        </div>
        <div className="field">
          <label htmlFor="quiz-description">Description (optional)</label>
          <textarea id="quiz-description" className="quiz-textarea" rows={2} maxLength={2000}
            value={settings.description} onChange={(event) => updateSetting('description', event.target.value)} />
        </div>
        <div className="quiz-grid quiz-grid-3">
          <div className="field">
            <label htmlFor="quiz-duration">Duration (minutes)</label>
            <input id="quiz-duration" type="number" min={1} max={600} step={1} value={settings.durationMinutes}
              onChange={(event) => updateSetting('durationMinutes', event.target.value)} />
            {errors.durationMinutes && <p className="field-error">{errors.durationMinutes}</p>}
          </div>
          <div className="field">
            <label htmlFor="quiz-passing">Passing score (%)</label>
            <input id="quiz-passing" type="number" min={0} max={100} value={settings.passingScore}
              onChange={(event) => updateSetting('passingScore', event.target.value)} />
            {errors.passingScore && <p className="field-error">{errors.passingScore}</p>}
          </div>
          <label className="role-option quiz-checkbox">
            <input type="checkbox" checked={settings.showAnswers}
              onChange={(event) => updateSetting('showAnswers', event.target.checked)} />
            Show correct answers to students after they submit
          </label>
        </div>

        <div className="quiz-heading-row">
          <h2 className="quiz-section-title">
            Questions ({items.length}) · {totalMarks} mark{totalMarks === 1 ? '' : 's'}
          </h2>
          <div className="quiz-actions">
            <button type="button" className="secondary-button quiz-auto-button"
              onClick={() => { setShowPicker(true); setDraftQuestion(null); scrollToPanel('quiz-picker') }}>
              Add from bank
            </button>
            <button type="button" className="secondary-button quiz-auto-button"
              onClick={() => {
                setDraftQuestion({ ...emptyQuestion, options: ['', '', '', ''] })
                setDraftErrors({})
                setShowPicker(false)
                scrollToPanel('quiz-new-question')
              }}>
              Write new question
            </button>
          </div>
        </div>
        {errors.questions && <p className="field-error">{errors.questions}</p>}

        {items.length === 0 && (
          <div className="empty-state">
            <h2>No questions yet</h2>
            <p>Add questions from the bank or write a new one.</p>
          </div>
        )}

        <ol className="quiz-item-list">
          {items.map((item, index) => {
            const question = item.bankQuestion || formToQuestion(item.newQuestion)
            const itemErrors = Object.entries(errors)
              .filter(([key]) => key === `questions.${index}` || key.startsWith(`questions.${index}.`))
              .map(([, text]) => text)
            return (
              <li className="quiz-card" key={item.key}>
                <div className="quiz-item-header">
                  <strong>Question {index + 1}</strong>
                  <span className="quiz-tag">{item.bankQuestion ? 'From bank' : 'New, saved to bank'}</span>
                </div>
                <QuestionSummary question={question} />
                {itemErrors.map((text) => <p className="field-error" key={text}>{text}</p>)}
                <div className="quiz-card-actions">
                  <label className="quiz-marks" htmlFor={`marks-${item.key}`}>
                    Marks
                    <input id={`marks-${item.key}`} type="number" min={1} max={100} value={item.marks}
                      onChange={(event) => updateMarks(item.key, event.target.value)} />
                  </label>
                  <button type="button" className="quiz-link-button" onClick={() => moveItem(index, -1)}
                    disabled={index === 0} aria-label={`Move question ${index + 1} up`}>Up</button>
                  <button type="button" className="quiz-link-button" onClick={() => moveItem(index, 1)}
                    disabled={index === items.length - 1} aria-label={`Move question ${index + 1} down`}>Down</button>
                  <button type="button" className="quiz-danger-button" onClick={() => removeItem(item.key)}>Remove</button>
                </div>
              </li>
            )
          })}
        </ol>

        <button type="submit" className="upload-submit" disabled={isSaving}>
          {isSaving ? 'Creating...' : 'Create quiz'}
        </button>
      </form>

      {draftQuestion && (
        <form id="quiz-new-question" className="upload-panel quiz-editor" onSubmit={addNewQuestion} noValidate>
          <h2 className="quiz-section-title">Write a new question</h2>
          <QuestionFields
            idPrefix="new-question"
            form={draftQuestion}
            errors={draftErrors}
            onChange={(form) => {
              setDraftQuestion(form)
              setDraftErrors({})
            }}
          />
          <p className="field-help">New questions are also saved to the question bank when the quiz is created.</p>
          <div className="quiz-actions">
            <button type="submit" className="quiz-primary-button">Add to quiz</button>
            <button type="button" className="secondary-button quiz-auto-button" onClick={() => setDraftQuestion(null)}>Cancel</button>
          </div>
        </form>
      )}

      {showPicker && (
        <BankPicker token={token} selectedIds={selectedIds} onAdd={addBankQuestion} onClose={() => setShowPicker(false)} />
      )}
    </section>
  )
}
