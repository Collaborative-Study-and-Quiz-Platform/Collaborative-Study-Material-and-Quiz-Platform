import { useCallback, useEffect, useState } from 'react'
import {
  apiRequest,
  difficultyLabel,
  typeLabel,
} from './quizApi'
import { QuestionFields } from './QuestionForm'
import QuestionFilters from './QuestionFilters'
import {
  emptyQuestion,
  formToQuestion,
  questionToForm,
  validateQuestionForm,
  emptyQuestionFilters,
  questionFilterQuery,
} from './questionFormUtils'


export function QuestionSummary({ question, showAnswer = true }) {
  return (
    <div className="question-summary">
      <div className="quiz-tags">
        <span className="file-badge">{typeLabel(question.type)}</span>
        {question.difficulty && <span className="quiz-tag">{difficultyLabel(question.difficulty)}</span>}
        {question.subject && <span className="quiz-tag">{question.subject}</span>}
        {question.topic && <span className="quiz-tag">{question.topic}</span>}
        {question.tags?.map((tag) => <span className="quiz-tag question-tag" key={`tag-${tag}`}>#{tag}</span>)}
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
  const [filters, setFilters] = useState(emptyQuestionFilters)
  const [isLoading, setIsLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [editor, setEditor] = useState(null)
  const [formErrors, setFormErrors] = useState({})
  const [isSaving, setIsSaving] = useState(false)
  const [message, setMessage] = useState(null)

  const loadQuestions = useCallback(async (nextFilters) => {
    setIsLoading(true)
    setLoadError('')
    try {
      const data = await apiRequest(`/api/questions?${questionFilterQuery(nextFilters)}`, { token })
      setQuestions(Array.isArray(data.questions) ? data.questions : [])
    } catch (error) {
      setLoadError(error.message || 'Unable to load questions.')
    } finally {
      setIsLoading(false)
    }
  }, [token])

  useEffect(() => {
    const timer = window.setTimeout(() => loadQuestions(emptyQuestionFilters), 0)
    return () => window.clearTimeout(timer)
  }, [loadQuestions])

  function clearFilters() {
    setFilters(emptyQuestionFilters)
    loadQuestions(emptyQuestionFilters)
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

      <QuestionFilters
        token={token}
        idPrefix="question-filter"
        filters={filters}
        onChange={setFilters}
        onSubmit={loadQuestions}
        onClear={clearFilters}
        isLoading={isLoading}
      />

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
