import { useCallback, useEffect, useState } from 'react'
import { apiRequest } from './quizApi'
import { QuestionSummary } from './QuestionBank'

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
                <span className="tree-count">
                  {quiz.questions.length} question{quiz.questions.length === 1 ? '' : 's'} · {quiz.totalMarks} marks · {quiz.durationMinutes} min
                </span>
              </summary>
              <div className="quiz-detail">
                {quiz.description && <p className="quiz-description">{quiz.description}</p>}
                <div className="quiz-tags">
                  <span className="quiz-tag">Pass at {quiz.passingScore}%</span>
                  <span className="quiz-tag">{quiz.showAnswers ? 'Answers shown after submitting' : 'Answers hidden from students'}</span>
                  {quiz.createdAt && <span className="quiz-tag">Created {new Date(quiz.createdAt).toLocaleDateString()}</span>}
                </div>
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
