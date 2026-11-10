// Start and end time inputs for a quiz window (CSQP-F-021)
export default function ScheduleFields({ idPrefix, value, onChange, errors = {} }) {
  return (
    <div className="quiz-grid quiz-grid-2">
      <div className="field">
        <label htmlFor={`${idPrefix}-from`}>Opens at</label>
        <input id={`${idPrefix}-from`} type="datetime-local" value={value.availableFrom}
          onChange={(event) => onChange({ ...value, availableFrom: event.target.value })} />
        {errors.availableFrom && <p className="field-error">{errors.availableFrom}</p>}
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-until`}>Closes at</label>
        <input id={`${idPrefix}-until`} type="datetime-local" value={value.availableUntil}
          onChange={(event) => onChange({ ...value, availableUntil: event.target.value })} />
        {errors.availableUntil && <p className="field-error">{errors.availableUntil}</p>}
      </div>
    </div>
  )
}
