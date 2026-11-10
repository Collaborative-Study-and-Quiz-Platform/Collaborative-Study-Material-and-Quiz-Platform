import { useCallback, useEffect, useState } from 'react'
import {
  apiRequest,
  fromDateTimeInput,
  scheduleSummary,
  toDateTimeInput,
} from './quizApi'
import ScheduleFields from './ScheduleFields'
import { QuestionSummary } from './QuestionBank'

// Set, change, or remove a quiz window (CSQP-F-021)
function ScheduleEditor({ token, quiz, onSaved }) {
  const [value, setValue] = useState({
    availableFrom: toDateTimeInput(quiz.availableFrom),
    availableUntil: toDateTimeInput(quiz.availableUntil),
  })
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState(null)
  const [isSaving, setIsSaving] = useState(false)

  async function save(nextValue) {
    if (Boolean(nextValue.availableFrom) !== Boolean(nextValue.availableUntil)) {
      setErrors({ [nextValue.availableFrom ? 'availableUntil' : 'availableFrom']: 'Give both times, or leave both empty.' })
      return
    }
    setIsSaving(true)
    setErrors({})
    setMessage(null)
    try {
      const data = await apiRequest(`/api/quizzes/${quiz._id}/schedule`, {
        token,
        method: 'PUT',
        body: {
          availableFrom: fromDateTimeInput(nextValue.availableFrom),
          availableUntil: fromDateTimeInput(nextValue.availableUntil),
        },
      })
      setValue(nextValue)
      setMessage({ type: 'success', text: data.message })
      onSaved(data.quiz)
    } catch (error) {
      setErrors(error.fieldErrors || {})
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSaving(false)
    }
  }

  return (
    <form className="quiz-schedule-editor" noValidate onSubmit={(event) => { event.preventDefault(); save(value) }}>
      <h3 className="quiz-section-title">Schedule</h3>
      <ScheduleFields idPrefix={`schedule-${quiz._id}`} value={value} errors={errors}
        onChange={(next) => { setValue(next); setErrors({}) }} />
      {message && (
        <p className={`feedback ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>
      )}
      <div className="quiz-actions">
        <button type="submit" className="quiz-primary-button" disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save schedule'}
        </button>
        {quiz.availableFrom && (
          <button type="button" className="secondary-button quiz-auto-button" disabled={isSaving}
            onClick={() => save({ availableFrom: '', availableUntil: '' })}>
            Remove schedule
          </button>
        )}
      </div>
    </form>
  )
}

// Instructor's own quizzes (Admins see all), newest first
export default function MyQuizzes({ token, onCreateQuiz }) {
  const [quizzes, setQuizzes] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const loadQuizzes = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const data = await apiRequest('/api/quizzes', { token })
      setQuizzes(Array.isArray(data.quizzes) ? data.quizzes : [])
    } catch (requestError) {
      setError(requestError.message || 'Unable to load quizzes.')
    } finally {
      setIsLoading(false)
    }
  }, [token])

  useEffect(() => {
    const timer = window.setTimeout(loadQuizzes, 0)
    return () => window.clearTimeout(timer)
  }, [loadQuizzes])

  return (
    <section className="library" aria-labelledby="my-quizzes-title">
      <div className="library-heading quiz-heading-row">
        <div>
          <p className="eyebrow">Quizzes</p>
          <h1 id="my-quizzes-title">My quizzes</h1>
          <p>Quizzes you have created, with their questions and settings.</p>
        </div>
        <button type="button" className="quiz-primary-button" onClick={onCreateQuiz}>Create quiz</button>
      </div>

      {error && <p className="feedback error" role="alert">{error}</p>}
      <p className="results-count" role="status" aria-live="polite">
        {isLoading ? 'Loading quizzes...' : error ? 'Quizzes unavailable.' : `${quizzes.length} quiz${quizzes.length === 1 ? '' : 'zes'}`}
      </p>

      {isLoading && (
        <div className="explorer-state" role="status">
          <span className="loading-indicator" aria-hidden="true" />
          <p>Loading quizzes…</p>
        </div>
      )}

      {!isLoading && !error && quizzes.length === 0 && (
        <div className="empty-state">
          <h2>No quizzes yet</h2>
          <p>Create your first quiz from the question bank.</p>
        </div>
      )}

      {!isLoading && !error && quizzes.length > 0 && (
        <div className="material-explorer">
          {quizzes.map((quiz) => (
            <details className="explorer-course" key={quiz._id}>
              <summary>
                <span className="tree-label">{quiz.title}</span>
                <span className={`quiz-status quiz-status-${scheduleSummary(quiz).tone}`}>{scheduleSummary(quiz).label}</span>
                <span className="tree-count">
                  {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'} · {quiz.totalMarks} mark{quiz.totalMarks === 1 ? '' : 's'} · {quiz.durationMinutes} min
                </span>
              </summary>
              <div className="quiz-detail">
                {quiz.description && <p className="quiz-description">{quiz.description}</p>}
                <div className="quiz-tags">
                  <span className="quiz-tag">Pass at {quiz.passingScore}%</span>
                  <span className="quiz-tag">{quiz.showAnswers ? 'Answers shown after submitting' : 'Answers hidden from students'}</span>
                  {quiz.createdAt && <span className="quiz-tag">Created {new Date(quiz.createdAt).toLocaleDateString()}</span>}
                </div>
                <ScheduleEditor
                  token={token}
                  quiz={quiz}
                  onSaved={(updated) => setQuizzes((current) => current.map((item) => (
                    item._id === updated._id ? updated : item
                  )))}
                />
                <ol className="quiz-item-list">
                  {quiz.questions.map((question, index) => (
                    <li className="quiz-card" key={question._id}>
                      <div className="quiz-item-header">
                        <strong>Question {index + 1}</strong>
                        <span className="quiz-tag">{question.marks} mark{question.marks === 1 ? '' : 's'}</span>
                      </div>
                      <QuestionSummary question={question} />
                    </li>
                  ))}
                </ol>
              </div>
            </details>
          ))}
        </div>
      )}
    </section>
  )
}
