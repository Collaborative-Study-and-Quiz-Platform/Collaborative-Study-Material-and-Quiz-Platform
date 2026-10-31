import { useCallback, useEffect, useRef, useState } from 'react'
import { apiRequest, typeLabel } from './quizApi'

const AUTOSAVE_DELAY_MS = 1200

function formatTime(totalSeconds) {
  const seconds = Math.max(0, totalSeconds)
  const minutes = Math.floor(seconds / 60)
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
}

function statusBadge(attempt) {
  if (!attempt) return { label: 'Not started', tone: 'neutral' }
  if (attempt.status === 'in_progress') return { label: 'In progress', tone: 'warning' }
  if (attempt.gradingStatus === 'pending_manual') return { label: 'Awaiting grading', tone: 'warning' }
  if (attempt.passed === true) return { label: 'Passed', tone: 'success' }
  if (attempt.passed === false) return { label: 'Not passed', tone: 'error' }
  return { label: 'Submitted', tone: 'neutral' }
}

// List of quizzes with the student's own status (uses GET /api/quizzes/available)
function QuizList({ token, onStart, onViewResult }) {
  const [quizzes, setQuizzes] = useState([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setIsLoading(true)
    setError('')
    try {
      const data = await apiRequest('/api/quizzes/available', { token })
      setQuizzes(Array.isArray(data.quizzes) ? data.quizzes : [])
    } catch (requestError) {
      setError(requestError.message || 'Unable to load quizzes.')
    } finally {
      setIsLoading(false)
    }
  }, [token])

  useEffect(() => {
    const timer = window.setTimeout(load, 0)
    return () => window.clearTimeout(timer)
  }, [load])

  return (
    <section className="library" aria-labelledby="student-quizzes-title">
      <div className="library-heading">
        <div>
          <p className="eyebrow">Quizzes</p>
          <h1 id="student-quizzes-title">Quizzes</h1>
          <p>Take a timed quiz and see your results.</p>
        </div>
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
          <p>Quizzes created by your instructors will appear here.</p>
        </div>
      )}

      <div className="quiz-list">
        {!isLoading && !error && quizzes.map((quiz) => {
          const badge = statusBadge(quiz.attempt)
          const finished = quiz.attempt && quiz.attempt.status !== 'in_progress'
          return (
            <article className="quiz-card student-quiz-card" key={quiz._id}>
              <div className="quiz-item-header">
                <h2 className="quiz-section-title">{quiz.title}</h2>
                <span className={`quiz-status quiz-status-${badge.tone}`}>{badge.label}</span>
              </div>
              {quiz.description && <p className="quiz-description">{quiz.description}</p>}
              <div className="quiz-tags">
                <span className="quiz-tag">{quiz.questionCount} question{quiz.questionCount === 1 ? '' : 's'}</span>
                <span className="quiz-tag">{quiz.totalMarks} marks</span>
                <span className="quiz-tag">{quiz.durationMinutes} min</span>
                <span className="quiz-tag">Pass at {quiz.passingScore}%</span>
                {quiz.subjects.map((subject) => <span className="quiz-tag" key={`s-${subject}`}>{subject}</span>)}
                {quiz.topics.map((topic) => <span className="quiz-tag" key={`t-${topic}`}>{topic}</span>)}
              </div>
              {finished && typeof quiz.attempt.score === 'number' && (
                <p className="student-quiz-score">
                  Score: {quiz.attempt.score} / {quiz.attempt.maxScore} ({quiz.attempt.percentage}%)
                </p>
              )}
              <div className="quiz-card-actions">
                {finished ? (
                  <button type="button" className="quiz-primary-button" onClick={() => onViewResult(quiz)}>
                    View result
                  </button>
                ) : (
                  <button type="button" className="quiz-primary-button" onClick={() => onStart(quiz)}>
                    {quiz.attempt ? 'Resume quiz' : 'Start quiz'}
                  </button>
                )}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

// Timed attempt: countdown, autosave, submit, and auto-submit at time-out (CSQP-F-022)
function TakeQuiz({ token, quiz, onFinished, onBack }) {
  const [attempt, setAttempt] = useState(null)
  const [answers, setAnswers] = useState({})
  const [remaining, setRemaining] = useState(null)
  const [error, setError] = useState('')
  const [saveState, setSaveState] = useState('saved')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const deadlineRef = useRef(null)
  const pendingRef = useRef({})
  const saveTimerRef = useRef(null)
  const finishedRef = useRef(false)

  const base = `/api/quizzes/${quiz._id}/attempt`

  useEffect(() => {
    let cancelled = false
    async function start() {
      try {
        const data = await apiRequest(`${base}/start`, { token, method: 'POST' })
        if (cancelled) return
        const started = data.attempt
        // Count down from the server's remaining time so a wrong computer clock does not matter
        deadlineRef.current = Date.now() + started.remainingSeconds * 1000
        setRemaining(started.remainingSeconds)
        setAttempt(started)
        setAnswers(Object.fromEntries(started.answers.map((answer) => [String(answer.questionId), answer.response])))
      } catch (requestError) {
        if (cancelled) return
        if (requestError.status === 409) {
          onFinished(quiz)
          return
        }
        setError(requestError.message)
      }
    }
    start()
    return () => { cancelled = true }
  }, [base, token, quiz, onFinished])

  const flushSaves = useCallback(async () => {
    window.clearTimeout(saveTimerRef.current)
    const changes = Object.entries(pendingRef.current)
    if (!changes.length) return true
    pendingRef.current = {}
    setSaveState('saving')
    try {
      await apiRequest(`${base}/answers`, {
        token,
        method: 'PUT',
        body: { answers: changes.map(([questionId, response]) => ({ questionId, response })) },
      })
      setSaveState(Object.keys(pendingRef.current).length ? 'unsaved' : 'saved')
      return true
    } catch (requestError) {
      if (requestError.status === 409) {
        finishedRef.current = true
        onFinished(quiz)
        return false
      }
      changes.forEach(([questionId, response]) => {
        if (!(questionId in pendingRef.current)) pendingRef.current[questionId] = response
      })
      setSaveState('error')
      return false
    }
  }, [base, token, quiz, onFinished])

  const submit = useCallback(async (automatic = false) => {
    if (finishedRef.current) return
    finishedRef.current = true
    setIsSubmitting(true)
    window.clearTimeout(saveTimerRef.current)
    const changes = Object.entries(pendingRef.current)
    pendingRef.current = {}
    try {
      await apiRequest(base, {
        token,
        method: 'POST',
        body: { answers: changes.map(([questionId, response]) => ({ questionId, response })) },
      })
    } catch (requestError) {
      // 409 means the server already submitted it; the result page shows what was saved
      if (requestError.status !== 409) {
        finishedRef.current = false
        setIsSubmitting(false)
        setError(automatic
          ? 'Time is up, but the quiz could not be submitted. Check your connection and try again.'
          : requestError.message)
        return
      }
    }
    onFinished(quiz)
  }, [base, token, quiz, onFinished])

  // Countdown; submits automatically when it reaches zero
  useEffect(() => {
    if (!attempt) return undefined
    const interval = window.setInterval(() => {
      const seconds = Math.ceil((deadlineRef.current - Date.now()) / 1000)
      setRemaining(Math.max(0, seconds))
      if (seconds <= 0) {
        window.clearInterval(interval)
        submit(true)
      }
    }, 500)
    return () => window.clearInterval(interval)
  }, [attempt, submit])

  // Leaving the page (for example through the sidebar) still saves the latest answers
  useEffect(() => () => {
    window.clearTimeout(saveTimerRef.current)
    if (!finishedRef.current) flushSaves()
  }, [flushSaves])

  const answer = useCallback((questionId, response) => {
    if (finishedRef.current) return
    setAnswers((current) => ({ ...current, [questionId]: response }))
    pendingRef.current[questionId] = response
    setSaveState('unsaved')
    window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(flushSaves, AUTOSAVE_DELAY_MS)
  }, [flushSaves])

  // One handler for every answer input; the question comes from data-question-id
  const handleAnswerChange = useCallback((event) => {
    const { questionId } = event.target.dataset
    answer(questionId, event.target.value)
  }, [answer])

  async function leave() {
    await flushSaves()
    onBack()
  }

  function confirmSubmit() {
    const unanswered = attempt.questions.filter((question) => {
      const value = answers[String(question._id)]
      return value === undefined || value === null || String(value).trim() === ''
    }).length
    const text = unanswered
      ? `You have ${unanswered} unanswered question${unanswered === 1 ? '' : 's'}. Submit anyway?`
      : 'Submit your answers? You cannot change them afterwards.'
    if (window.confirm(text)) submit(false)
  }

  if (error && !attempt) {
    return (
      <section className="upload-page">
        <p className="feedback error" role="alert">{error}</p>
        <button type="button" className="secondary-button quiz-auto-button" onClick={onBack}>Back to quizzes</button>
      </section>
    )
  }

  if (!attempt) {
    return (
      <div className="explorer-state" role="status">
        <span className="loading-indicator" aria-hidden="true" />
        <p>Starting quiz…</p>
      </div>
    )
  }

  const answeredCount = attempt.questions.filter((question) => {
    const value = answers[String(question._id)]
    return value !== undefined && value !== null && String(value).trim() !== ''
  }).length
  const lowTime = remaining !== null && remaining <= 60
  const saveLabels = { saved: 'All answers saved', saving: 'Saving…', unsaved: 'Unsaved changes', error: 'Not saved, will retry' }

  return (
    <section className="upload-page take-quiz" aria-labelledby="take-quiz-title">
      <div className="quiz-timer-bar" role="region" aria-label="Quiz progress">
        <div>
          <strong id="take-quiz-title">{attempt.quizTitle}</strong>
          <span>{answeredCount} of {attempt.totalQuestions} answered · {saveLabels[saveState]}</span>
        </div>
        <span className={`quiz-timer${lowTime ? ' quiz-timer-low' : ''}`} role="timer" aria-live={lowTime ? 'assertive' : 'off'}
          aria-label={`Time left ${formatTime(remaining)}`}>
          {formatTime(remaining)}
        </span>
      </div>

      {error && <p className="feedback error" role="alert">{error}</p>}

      <ol className="quiz-item-list">
        {attempt.questions.map((question, index) => {
          const id = String(question._id)
          const value = answers[id] ?? ''
          return (
            <li className="quiz-card" key={id}>
              <fieldset className="quiz-fieldset">
                <legend className="quiz-question-legend">
                  <span className="quiz-item-header">
                    <strong>Question {index + 1}</strong>
                    <span className="quiz-tag">{question.marks} mark{question.marks === 1 ? '' : 's'} · {typeLabel(question.type)}</span>
                  </span>
                  <span className="question-text">{question.text}</span>
                </legend>

                {question.type === 'mcq' && question.options.map((option) => (
                  <label className="role-option quiz-answer-option" key={option}>
                    <input type="radio" name={`answer-${id}`} value={option} data-question-id={id}
                      checked={value === option} onChange={handleAnswerChange} disabled={isSubmitting} />
                    {option}
                  </label>
                ))}

                {question.type === 'true_false' && ['true', 'false'].map((option) => (
                  <label className="role-option quiz-answer-option" key={option}>
                    <input type="radio" name={`answer-${id}`} value={option} data-question-id={id}
                      checked={value === option} onChange={handleAnswerChange} disabled={isSubmitting} />
                    {option === 'true' ? 'True' : 'False'}
                  </label>
                ))}

                {question.type === 'short_answer' && (
                  <textarea className="quiz-textarea" rows={3} maxLength={5000} value={value} data-question-id={id}
                    aria-label={`Answer to question ${index + 1}`}
                    onChange={handleAnswerChange} disabled={isSubmitting} />
                )}
              </fieldset>
            </li>
          )
        })}
      </ol>

      <div className="quiz-actions">
        <button type="button" className="quiz-primary-button" onClick={confirmSubmit} disabled={isSubmitting}>
          {isSubmitting ? 'Submitting…' : 'Submit quiz'}
        </button>
        <button type="button" className="secondary-button quiz-auto-button" onClick={leave} disabled={isSubmitting}>
          Save and leave
        </button>
      </div>
      <p className="field-help">Your answers save automatically. If time runs out, the quiz is submitted with every saved answer.</p>
    </section>
  )
}

// Result page: score, plus the answer review when the instructor allows it (CSQP-F-025)
function QuizResult({ token, quiz, onBack }) {
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    apiRequest(`/api/quizzes/${quiz._id}/attempt/result`, { token })
      .then((data) => { if (!cancelled) setResult(data.result) })
      .catch((requestError) => { if (!cancelled) setError(requestError.message) })
    return () => { cancelled = true }
  }, [token, quiz])

  if (error) {
    return (
      <section className="upload-page">
        <p className="feedback error" role="alert">{error}</p>
        <button type="button" className="secondary-button quiz-auto-button" onClick={onBack}>Back to quizzes</button>
      </section>
    )
  }

  if (!result) {
    return (
      <div className="explorer-state" role="status">
        <span className="loading-indicator" aria-hidden="true" />
        <p>Loading result…</p>
      </div>
    )
  }

  const outcome = result.gradingStatus === 'pending_manual'
    ? { label: 'Awaiting grading', tone: 'warning', text: `${result.pendingMarks} mark${result.pendingMarks === 1 ? '' : 's'} from short answers still need to be graded by your instructor.` }
    : result.passed
      ? { label: 'Passed', tone: 'success', text: `You needed ${result.passingScore}% to pass.` }
      : { label: 'Not passed', tone: 'error', text: `You needed ${result.passingScore}% to pass.` }

  return (
    <section className="upload-page" aria-labelledby="quiz-result-title">
      <div className="page-heading">
        <p className="eyebrow">Quiz result</p>
        <h1 id="quiz-result-title">{result.quizTitle}</h1>
        <p>
          {result.status === 'auto_submitted' ? 'Submitted automatically when time ran out' : 'Submitted'}
          {result.submittedAt && ` on ${new Date(result.submittedAt).toLocaleString()}`}
        </p>
      </div>

      <div className="upload-panel quiz-result-summary">
        <div className="quiz-score">
          <strong>{result.score} / {result.maxScore}</strong>
          <span>{result.percentage}%</span>
        </div>
        <div className="quiz-result-details">
          <span className={`quiz-status quiz-status-${outcome.tone}`}>{outcome.label}</span>
          <p>{outcome.text}</p>
          <p>{result.correctCount} correct · {result.answeredCount} of {result.totalQuestions} answered</p>
        </div>
      </div>

      {result.answersVisible ? (
        <>
          <h2 className="quiz-section-title quiz-review-title">Answer review</h2>
          <ol className="quiz-item-list">
            {result.review.map((item, index) => {
              const tone = item.isCorrect === true ? 'success' : item.isCorrect === false ? 'error' : 'warning'
              const label = item.isCorrect === true ? 'Correct' : item.isCorrect === false ? 'Incorrect' : 'Awaiting grading'
              const show = (value) => (value === 'true' ? 'True' : value === 'false' ? 'False' : value)
              return (
                <li className={`quiz-card quiz-review-${tone}`} key={String(item.questionId)}>
                  <div className="quiz-item-header">
                    <strong>Question {index + 1}</strong>
                    <span className={`quiz-status quiz-status-${tone}`}>
                      {label}{item.marksAwarded !== null && ` · ${item.marksAwarded}/${item.maxMarks}`}
                    </span>
                  </div>
                  <p className="question-text">{item.text}</p>
                  <p className="quiz-review-line">Your answer: <strong>{item.yourResponse === null ? 'Not answered' : show(item.yourResponse)}</strong></p>
                  {item.correctAnswer !== null && (
                    <p className="quiz-review-line">
                      {item.type === 'short_answer' ? 'Model answer' : 'Correct answer'}: <strong>{show(item.correctAnswer)}</strong>
                    </p>
                  )}
                </li>
              )
            })}
          </ol>
        </>
      ) : (
        <div className="empty-state">
          <h2>Answer review not available</h2>
          <p>Your instructor has chosen not to show the correct answers for this quiz.</p>
        </div>
      )}

      <div className="quiz-actions quiz-result-actions">
        <button type="button" className="secondary-button quiz-auto-button" onClick={onBack}>Back to quizzes</button>
      </div>
    </section>
  )
}

// Student quiz area: list, take, and result views
export default function StudentQuizzes({ token }) {
  const [view, setView] = useState({ name: 'list' })

  const showList = useCallback(() => {
    setView({ name: 'list' })
    window.scrollTo({ top: 0 })
  }, [])
  const showResult = useCallback((quiz) => {
    setView({ name: 'result', quiz })
    window.scrollTo({ top: 0 })
  }, [])
  const startQuiz = useCallback((quiz) => {
    setView({ name: 'take', quiz })
    window.scrollTo({ top: 0 })
  }, [])

  if (view.name === 'take') {
    return <TakeQuiz key={view.quiz._id} token={token} quiz={view.quiz} onFinished={showResult} onBack={showList} />
  }
  if (view.name === 'result') {
    return <QuizResult key={view.quiz._id} token={token} quiz={view.quiz} onBack={showList} />
  }
  return <QuizList token={token} onStart={startQuiz} onViewResult={showResult} />
}
