import { useCallback, useEffect, useState } from 'react'
import {
  DIFFICULTIES,
  QUESTION_TYPES,
  apiRequest,
  difficultyLabel,
  typeLabel,
} from './quizApi'
import { QuestionFields } from './QuestionForm'
import {
  emptyQuestion,
  formToQuestion,
  questionToForm,
  validateQuestionForm,
} from './questionFormUtils'

const emptyFilters = { subject: '', topic: '', difficulty: '', type: '' }

export function QuestionSummary({ question, showAnswer = true }) {
  return (
    <div className="question-summary">
      <div className="quiz-tags">
        <span className="file-badge">{typeLabel(question.type)}</span>
        {question.difficulty && <span className="quiz-tag">{difficultyLabel(question.difficulty)}</span>}
        {question.subject && <span className="quiz-tag">{question.subject}</span>}
        {question.topic && <span className="quiz-tag">{question.topic}</span>}
      </div>
      <p className="question-text">{question.text}</p>
      {question.type === 'mcq' && (
        <ul className="question-options">
          {question.options.map((option) => (
            <li key={option} className={showAnswer && option === question.correctAnswer ? 'correct' : ''}>
              {option}
              {showAnswer && option === question.correctAnswer && <span className="sr-only"> (correct)</span>}
            </li>
          ))}
        </ul>
      )}
      {showAnswer && question.type === 'true_false' && (
        <p className="question-answer">Answer: {question.correctAnswer === 'true' ? 'True' : 'False'}</p>
      )}
      {showAnswer && question.type === 'short_answer' && question.correctAnswer && (
        <p className="question-answer">Model answer: {question.correctAnswer}</p>
      )}
    </div>
  )
}

// Instructor question bank: filter, add, edit, and delete questions (CSQP-F-030)
export default function QuestionBank({ token, user }) {
  const [questions, setQuestions] = useState([])
  const [filters, setFilters] = useState(emptyFilters)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editor, setEditor] = useState(null)
  const [formErrors, setFormErrors] = useState({})
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState(null)

  const loadQuestions = useCallback(async (nextFilters) => {
    setIsLoading(true)
    setLoadError('')
    const params = new URLSearchParams()
    Object.entries(nextFilters).forEach(([key, value]) => {
      if (value.trim()) params.set(key, value.trim())
    })

    try {
      const data = await apiRequest(`/api/questions?${params}`, { token })
      setQuestions(Array.isArray(data.questions) ? data.questions : [])
    } catch (error) {
      setLoadError(error.message || 'Unable to load questions.')
    } finally {
      setIsLoading(false)
    }
  }, [token])

  useEffect(() => {
    const timer = window.setTimeout(() => loadQuestions(emptyFilters), 0)
    return () => window.clearTimeout(timer)
  }, [loadQuestions])

  function updateFilter(event) {
    const { name, value } = event.target
    setFilters((current) => ({ ...current, [name]: value }))
  }

  function submitFilters(event) {
    event.preventDefault()
    loadQuestions(filters)
  }

  function clearFilters() {
    setFilters(emptyFilters)
    loadQuestions(emptyFilters)
  }

  function openEditor(question) {
    setEditor(question
      ? { id: question._id, form: questionToForm(question) }
      : { id: null, form: { ...emptyQuestion, options: ['', '', '', ''] } })
    setFormErrors({})
    setMessage(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function saveQuestion(event) {
    event.preventDefault()
    const errors = validateQuestionForm(editor.form)
    if (Object.keys(errors).length) {
      setFormErrors(errors)
      return
    }

    setIsSaving(true)
    try {
      await apiRequest(editor.id ? `/api/questions/${editor.id}` : '/api/questions', {
        token,
        method: editor.id ? 'PUT' : 'POST',
        body: formToQuestion(editor.form),
      })
      setMessage({ type: 'success', text: editor.id ? 'Question updated.' : 'Question added to the bank.' })
      setEditor(null)
      loadQuestions(filters)
    } catch (error) {
      setFormErrors(error.fieldErrors || {})
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSaving(false)
    }
  }

  async function deleteQuestion(question) {
    const confirmed = window.confirm(
      'Delete this question? It will be removed from the bank, but quizzes that already use it keep their copy.',
    )
    if (!confirmed) return

    try {
      await apiRequest(`/api/questions/${question._id}`, { token, method: 'DELETE' })
      setMessage({ type: 'success', text: 'Question deleted.' })
      loadQuestions(filters)
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    }
  }

  const canModify = (question) => user.role === 'admin' || question.createdBy === user._id

  return (
    <section className="library" aria-labelledby="question-bank-title">
      <div className="library-heading quiz-heading-row">
        <div>
          <p className="eyebrow">Quizzes</p>
          <h1 id="question-bank-title">Question bank</h1>
          <p>Questions you and other instructors can reuse in quizzes.</p>
        </div>
        {!editor && (
          <button type="button" className="quiz-primary-button" onClick={() => openEditor(null)}>
            Add question
          </button>
        )}
      </div>

      {message && (
        <p className={`feedback workspace-feedback ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>
          {message.text}
        </p>
      )}

      {editor && (
        <form className="upload-panel quiz-editor" onSubmit={saveQuestion} noValidate>
          <h2 className="quiz-section-title">{editor.id ? 'Edit question' : 'Add a question'}</h2>
          <QuestionFields
            idPrefix="bank-question"
            form={editor.form}
            errors={formErrors}
            onChange={(form) => {
              setEditor((current) => ({ ...current, form }))
              setFormErrors({})
            }}
          />
          <div className="quiz-actions">
            <button type="submit" className="quiz-primary-button" disabled={isSaving}>
              {isSaving ? 'Saving...' : editor.id ? 'Save changes' : 'Add question'}
            </button>
            <button type="button" className="secondary-button quiz-auto-button" onClick={() => setEditor(null)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <form className="library-filters filter-panel quiz-filters" onSubmit={submitFilters}>
        {['subject', 'topic'].map((name) => (
          <div className="field" key={name}>
            <label htmlFor={`question-filter-${name}`}>{name[0].toUpperCase() + name.slice(1)}</label>
            <input
              id={`question-filter-${name}`}
              name={name}
              type="search"
              value={filters[name]}
              onChange={updateFilter}
              placeholder={`Any ${name}`}
            />
          </div>
        ))}
        <div className="field">
          <label htmlFor="question-filter-difficulty">Difficulty</label>
          <select id="question-filter-difficulty" name="difficulty" value={filters.difficulty} onChange={updateFilter}>
            <option value="">Any difficulty</option>
            {DIFFICULTIES.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="question-filter-type">Type</label>
          <select id="question-filter-type" name="type" value={filters.type} onChange={updateFilter}>
            <option value="">Any type</option>
            {QUESTION_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
        </div>
        <div className="library-actions">
          <button type="submit" disabled={isLoading}>{isLoading ? 'Searching...' : 'Search'}</button>
          <button type="button" className="secondary-button" onClick={clearFilters} disabled={isLoading}>Clear</button>
        </div>
      </form>

      {loadError && <p className="feedback error" role="alert">{loadError}</p>}
      <p className="results-count" role="status" aria-live="polite">
        {isLoading ? 'Loading questions...' : loadError ? 'Questions unavailable.' : `${questions.length} question${questions.length === 1 ? '' : 's'}`}
      </p>

      {isLoading && (
        <div className="explorer-state" role="status">
          <span className="loading-indicator" aria-hidden="true" />
          <p>Loading questions…</p>
        </div>
      )}

      {!isLoading && !loadError && questions.length === 0 && (
        <div className="empty-state">
          <h2>No questions found</h2>
          <p>Add a question, or clear the filters to see the whole bank.</p>
        </div>
      )}

      {!isLoading && !loadError && questions.length > 0 && (
        <div className="quiz-list">
          {questions.map((question) => (
            <article className="quiz-card" key={question._id}>
              <QuestionSummary question={question} />
              {canModify(question) && (
                <div className="quiz-card-actions">
                  <button type="button" className="secondary-button quiz-auto-button" onClick={() => openEditor(question)}>
                    Edit
                  </button>
                  <button type="button" className="quiz-danger-button" onClick={() => deleteQuestion(question)}>
                    Delete
                  </button>
                </div>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
