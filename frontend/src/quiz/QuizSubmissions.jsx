import { useCallback, useEffect, useState } from 'react'
import { apiRequest, formatDateTime, typeLabel } from './quizApi'

function gradingBadge(item) {
  if (item.status === 'in_progress') return { label: 'In progress', tone: 'neutral' }
  if (item.gradingStatus === 'pending_manual') {
    return { label: `${item.pendingQuestions} to grade`, tone: 'warning' }
  }
  return item.passed ? { label: 'Passed', tone: 'success' } : { label: 'Not passed', tone: 'error' }
}

const show = (value) => (value === 'true' ? 'True' : value === 'false' ? 'False' : value)

// One submission: every answer, with marks and feedback inputs for short answers
function GradeSubmission({ token, quiz, attemptId, onBack, onSaved }) {
  const [submission, setSubmission] = useState(null)
  const [grades, setGrades] = useState({})
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState(null)
  const [isSaving, setIsSaving] = useState(false)

  const apply = useCallback((data) => {
    setSubmission(data)
    setGrades(Object.fromEntries(data.questions
      .filter((question) => question.type === 'short_answer')
      .map((question) => [String(question.questionId), {
        marks: question.marksAwarded === null ? '' : String(question.marksAwarded),
        feedback: question.feedback || '',
      }])))
  }, [])

  useEffect(() => {
    let cancelled = false
    apiRequest(`/api/quizzes/${quiz._id}/submissions/${attemptId}`, { token })
      .then((data) => { if (!cancelled) apply(data.submission) })
      .catch((error) => { if (!cancelled) setMessage({ type: 'error', text: error.message }) })
    return () => { cancelled = true }
  }, [token, quiz, attemptId, apply])

  function update(questionId, field, value) {
    setGrades((current) => ({ ...current, [questionId]: { ...current[questionId], [field]: value } }))
    setErrors({})
    setMessage(null)
  }

  async function save(event) {
    event.preventDefault()
    const entries = Object.entries(grades).filter(([, grade]) => grade.marks !== '')
    const localErrors = {}
    entries.forEach(([questionId, grade]) => {
      const question = submission.questions.find((item) => String(item.questionId) === questionId)
      const marks = Number(grade.marks)
      if (Number.isNaN(marks) || marks < 0 || marks > question.maxMarks || marks * 2 !== Math.round(marks * 2)) {
        localErrors[questionId] = `Enter 0 to ${question.maxMarks}, in steps of 0.5.`
      }
    })
    if (!entries.length) {
      setMessage({ type: 'error', text: 'Enter marks for at least one short answer.' })
      return
    }
    if (Object.keys(localErrors).length) {
      setErrors(localErrors)
      return
    }

    setIsSaving(true)
    try {
      const data = await apiRequest(`/api/quizzes/${quiz._id}/submissions/${attemptId}/grades`, {
        token,
        method: 'PUT',
        body: {
          grades: entries.map(([questionId, grade]) => ({
            questionId,
            marks: Number(grade.marks),
            feedback: grade.feedback,
          })),
        },
      })
      apply(data.submission)
      setMessage({ type: 'success', text: data.message === 'Grading complete' ? 'Grading complete. The student has been notified.' : 'Grades saved.' })
      onSaved()
    } catch (error) {
      setMessage({ type: 'error', text: error.message })
    } finally {
      setIsSaving(false)
    }
  }

  if (!submission) {
    return message
      ? <p className={`feedback ${message.type}`} role="alert">{message.text}</p>
      : <div className="explorer-state" role="status"><span className="loading-indicator" aria-hidden="true" /><p>Loading submission…</p></div>
  }

  const badge = gradingBadge(submission)

  return (
    <section className="upload-page" aria-labelledby="grade-title">
      <div className="page-heading">
        <p className="eyebrow">Grading · {quiz.title}</p>
        <h1 id="grade-title">{submission.student.name}</h1>
        <p>{submission.student.email}{submission.submittedAt && ` · submitted ${formatDateTime(submission.submittedAt)}`}</p>
      </div>

      <div className="upload-panel quiz-result-summary">
        <div className="quiz-score">
          <strong>{submission.score} / {submission.maxScore}</strong>
          <span>{submission.percentage}%</span>
        </div>
        <div className="quiz-result-details">
          <span className={`quiz-status quiz-status-${badge.tone}`}>{badge.label}</span>
          <p>{submission.pendingMarks
            ? `${submission.pendingMarks} mark${submission.pendingMarks === 1 ? '' : 's'} still to grade.`
            : 'All questions are graded.'}</p>
        </div>
      </div>

      {message && <p className={`feedback workspace-feedback ${message.type}`} role={message.type === 'error' ? 'alert' : 'status'}>{message.text}</p>}

      <form onSubmit={save} noValidate>
        <ol className="quiz-item-list">
          {submission.questions.map((question, index) => {
            const id = String(question.questionId)
            const isShort = question.type === 'short_answer'
            const tone = question.isCorrect === true ? 'success' : question.isCorrect === false && !isShort ? 'error' : 'warning'
            return (
              <li className={`quiz-card quiz-review-${isShort ? 'warning' : tone}`} key={id}>
                <div className="quiz-item-header">
                  <strong>Question {index + 1} · {typeLabel(question.type)}</strong>
                  <span className="quiz-tag">
                    {question.marksAwarded === null ? '–' : question.marksAwarded} / {question.maxMarks}
                  </span>
                </div>
                <p className="question-text">{question.text}</p>
                <p className="quiz-review-line">Answer: <strong>{question.response === null ? 'Not answered' : show(question.response)}</strong></p>
                {question.correctAnswer && (
                  <p className="quiz-review-line">{isShort ? 'Model answer' : 'Correct answer'}: <strong>{show(question.correctAnswer)}</strong></p>
                )}
                {isShort && (
                  <div className="quiz-grade-fields">
                    <div className="field">
                      <label htmlFor={`marks-${id}`}>Marks (out of {question.maxMarks})</label>
                      <input id={`marks-${id}`} type="number" min={0} max={question.maxMarks} step={0.5}
                        value={grades[id]?.marks ?? ''} onChange={(event) => update(id, 'marks', event.target.value)} />
                      {errors[id] && <p className="field-error">{errors[id]}</p>}
                    </div>
                    <div className="field">
                      <label htmlFor={`feedback-${id}`}>Feedback (optional)</label>
                      <textarea id={`feedback-${id}`} className="quiz-textarea" rows={2} maxLength={1000}
                        value={grades[id]?.feedback ?? ''} onChange={(event) => update(id, 'feedback', event.target.value)} />
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ol>
        <div className="quiz-actions quiz-result-actions">
          <button type="submit" className="quiz-primary-button" disabled={isSaving}>{isSaving ? 'Saving...' : 'Save grades'}</button>
          <button type="button" className="secondary-button quiz-auto-button" onClick={onBack}>Back to submissions</button>
        </div>
      </form>
    </section>
  )
}

// All submissions for one quiz (CSQP-F-024)
export default function QuizSubmissions({ token, quiz, onBack }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [grading, setGrading] = useState(null)

  const load = useCallback(async () => {
    setError('')
    try {
      setData(await apiRequest(`/api/quizzes/${quiz._id}/submissions`, { token }))
    } catch (requestError) {
      setError(requestError.message)
    }
  }, [token, quiz])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  if (grading) {
    return (
      <GradeSubmission token={token} quiz={quiz} attemptId={grading} onSaved={load}
        onBack={() => { setGrading(null); load(); window.scrollTo({ top: 0 }) }} />
    )
  }

  return (
    <section className="library" aria-labelledby="submissions-title">
      <div className="library-heading quiz-heading-row">
        <div>
          <p className="eyebrow">Submissions</p>
          <h1 id="submissions-title">{quiz.title}</h1>
          <p>Review attempts and grade short answers. Marks are added to each student’s score.</p>
        </div>
        <button type="button" className="secondary-button quiz-auto-button" onClick={onBack}>Back to my quizzes</button>
      </div>

      {error && <p className="feedback error" role="alert">{error}</p>}
      {!data && !error && (
        <div className="explorer-state" role="status"><span className="loading-indicator" aria-hidden="true" /><p>Loading submissions…</p></div>
      )}
      {data && (
        <p className="results-count" role="status">
          {data.count} submission{data.count === 1 ? '' : 's'} · {data.awaitingGrading} awaiting grading
        </p>
      )}
      {data && data.count === 0 && (
        <div className="empty-state"><h2>No submissions yet</h2><p>Attempts appear here once students start the quiz.</p></div>
      )}
      <div className="quiz-list">
        {data?.submissions.map((item) => {
          const badge = gradingBadge(item)
          return (
            <article className="quiz-card submission-row" key={item._id}>
              <div className="submission-student">
                <strong>{item.student.name}</strong>
                <span>{item.student.email}</span>
              </div>
              <span className="submission-score">
                {typeof item.score === 'number' ? `${item.score} / ${item.maxScore} (${item.percentage}%)` : '–'}
              </span>
              <span className={`quiz-status quiz-status-${badge.tone}`}>{badge.label}</span>
              <button type="button" className={item.gradingStatus === 'pending_manual' ? 'quiz-primary-button' : 'secondary-button quiz-auto-button'}
                disabled={item.status === 'in_progress'} onClick={() => { setGrading(item._id); window.scrollTo({ top: 0 }) }}>
                {item.gradingStatus === 'pending_manual' ? 'Grade' : 'View'}
              </button>
            </article>
          )
        })}
      </div>
    </section>
  )
}
