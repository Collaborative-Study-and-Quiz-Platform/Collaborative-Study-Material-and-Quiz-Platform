import { DIFFICULTIES, QUESTION_TYPES } from './quizApi'

function FieldError({ message }) {
  return message ? <p className="field-error">{message}</p> : null
}

// Question fields shared by the question bank and the quiz builder
export function QuestionFields({ form, onChange, errors = {}, idPrefix }) {
  function update(name, value) {
    const next = { ...form, [name]: value }
    if (name === 'type') {
      next.correctAnswer = ''
      if (value === 'mcq' && next.options.length < 2) next.options = ['', '', '', '']
    }
    onChange(next)
  }

  function updateOption(index, value) {
    const options = [...form.options]
    const wasCorrect = form.correctAnswer && form.correctAnswer === form.options[index]
    options[index] = value
    onChange({ ...form, options, correctAnswer: wasCorrect ? value : form.correctAnswer })
  }

  function addOption() {
    if (form.options.length >= 6) return
    onChange({ ...form, options: [...form.options, ''] })
  }

  function removeOption(index) {
    if (form.options.length <= 2) return
    const removed = form.options[index]
    onChange({
      ...form,
      options: form.options.filter((_, position) => position !== index),
      correctAnswer: form.correctAnswer === removed ? '' : form.correctAnswer,
    })
  }

  return (
    <div className="question-fields">
      <div className="field">
        <label htmlFor={`${idPrefix}-text`}>Question</label>
        <textarea
          id={`${idPrefix}-text`}
          className="quiz-textarea"
          rows={3}
          maxLength={2000}
          value={form.text}
          onChange={(event) => update('text', event.target.value)}
        />
        <FieldError message={errors.text} />
      </div>

      <div className="quiz-grid quiz-grid-2">
        <div className="field">
          <label htmlFor={`${idPrefix}-type`}>Type</label>
          <select
            id={`${idPrefix}-type`}
            className="quiz-select"
            value={form.type}
            onChange={(event) => update('type', event.target.value)}
          >
            {QUESTION_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
          </select>
          <FieldError message={errors.type} />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-difficulty`}>Difficulty</label>
          <select
            id={`${idPrefix}-difficulty`}
            className="quiz-select"
            value={form.difficulty}
            onChange={(event) => update('difficulty', event.target.value)}
          >
            {DIFFICULTIES.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
          </select>
          <FieldError message={errors.difficulty} />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-subject`}>Subject</label>
          <input
            id={`${idPrefix}-subject`}
            type="text"
            maxLength={100}
            value={form.subject}
            onChange={(event) => update('subject', event.target.value)}
          />
          <FieldError message={errors.subject} />
        </div>
        <div className="field">
          <label htmlFor={`${idPrefix}-topic`}>Topic</label>
          <input
            id={`${idPrefix}-topic`}
            type="text"
            maxLength={100}
            value={form.topic}
            onChange={(event) => update('topic', event.target.value)}
          />
          <FieldError message={errors.topic} />
        </div>
      </div>

      {form.type === 'mcq' && (
        <fieldset className="quiz-fieldset">
          <legend>Options (select the correct one)</legend>
          {form.options.map((option, index) => (
            <div className="option-row" key={index}>
              <input
                type="radio"
                name={`${idPrefix}-correct`}
                aria-label={`Option ${index + 1} is correct`}
                checked={Boolean(option.trim()) && form.correctAnswer === option}
                disabled={!option.trim()}
                onChange={() => update('correctAnswer', option)}
              />
              <input
                type="text"
                aria-label={`Option ${index + 1}`}
                placeholder={`Option ${index + 1}`}
                value={option}
                onChange={(event) => updateOption(index, event.target.value)}
              />
              <button
                type="button"
                className="quiz-link-button"
                onClick={() => removeOption(index)}
                disabled={form.options.length <= 2}
                aria-label={`Remove option ${index + 1}`}
              >
                Remove
              </button>
            </div>
          ))}
          {form.options.length < 6 && (
            <button type="button" className="secondary-button quiz-small-button" onClick={addOption}>
              Add option
            </button>
          )}
          <FieldError message={errors.options || errors.correctAnswer} />
        </fieldset>
      )}

      {form.type === 'true_false' && (
        <fieldset className="quiz-fieldset">
          <legend>Correct answer</legend>
          <div className="role-options">
            {['true', 'false'].map((value) => (
              <label className="role-option" key={value}>
                <input
                  type="radio"
                  name={`${idPrefix}-tf`}
                  value={value}
                  checked={form.correctAnswer === value}
                  onChange={() => update('correctAnswer', value)}
                />
                {value === 'true' ? 'True' : 'False'}
              </label>
            ))}
          </div>
          <FieldError message={errors.correctAnswer} />
        </fieldset>
      )}

      {form.type === 'short_answer' && (
        <div className="field">
          <label htmlFor={`${idPrefix}-model`}>Model answer (optional)</label>
          <textarea
            id={`${idPrefix}-model`}
            className="quiz-textarea"
            rows={2}
            maxLength={2000}
            value={form.correctAnswer}
            onChange={(event) => update('correctAnswer', event.target.value)}
          />
          <p className="field-help">Short answers are graded by hand, so this is only a guide.</p>
          <FieldError message={errors.correctAnswer} />
        </div>
      )}
    </div>
  )
}
