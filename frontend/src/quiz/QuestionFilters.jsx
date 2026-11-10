import { useEffect, useState } from 'react'
import { DIFFICULTIES, QUESTION_TYPES, apiRequest } from './quizApi'

// Search and filter bar for the question bank (CSQP-F-031). Every filter
// filled in must match, so adding filters narrows the results.
export default function QuestionFilters({ token, idPrefix, filters, onChange, onSubmit, onClear, isLoading, framed = true }) {
  const [tagOptions, setTagOptions] = useState([])

  useEffect(() => {
    let cancelled = false
    apiRequest('/api/questions/tags', { token })
      .then((data) => { if (!cancelled) setTagOptions((data.tags || []).map((item) => item.tag)) })
      .catch(() => { if (!cancelled) setTagOptions([]) })
    return () => { cancelled = true }
  }, [token])

  function update(event) {
    onChange({ ...filters, [event.target.name]: event.target.value })
  }

  return (
    <form className={`library-filters quiz-filters question-filters${framed ? ' filter-panel' : ''}`}
      onSubmit={(event) => { event.preventDefault(); onSubmit(filters) }} role="search">
      <div className="field question-filter-keyword">
        <label htmlFor={`${idPrefix}-q`}>Search</label>
        <input id={`${idPrefix}-q`} name="q" type="search" value={filters.q} onChange={update}
          placeholder="Words in the question" maxLength={100} />
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-tag`}>Tag</label>
        <input id={`${idPrefix}-tag`} name="tag" type="search" value={filters.tag} onChange={update}
          placeholder="Any tag" list={`${idPrefix}-tag-options`} />
        <datalist id={`${idPrefix}-tag-options`}>
          {tagOptions.map((tag) => <option key={tag} value={tag} />)}
        </datalist>
      </div>
      {['subject', 'topic'].map((name) => (
        <div className="field" key={name}>
          <label htmlFor={`${idPrefix}-${name}`}>{name[0].toUpperCase() + name.slice(1)}</label>
          <input id={`${idPrefix}-${name}`} name={name} type="search" value={filters[name]} onChange={update}
            placeholder={`Any ${name}`} />
        </div>
      ))}
      <div className="field">
        <label htmlFor={`${idPrefix}-difficulty`}>Difficulty</label>
        <select id={`${idPrefix}-difficulty`} name="difficulty" value={filters.difficulty} onChange={update}>
          <option value="">Any difficulty</option>
          {DIFFICULTIES.map((level) => <option key={level.value} value={level.value}>{level.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor={`${idPrefix}-type`}>Type</label>
        <select id={`${idPrefix}-type`} name="type" value={filters.type} onChange={update}>
          <option value="">Any type</option>
          {QUESTION_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}
        </select>
      </div>
      <div className="library-actions">
        <button type="submit" disabled={isLoading}>{isLoading ? 'Searching...' : 'Search'}</button>
        <button type="button" className="secondary-button" onClick={onClear} disabled={isLoading}>Clear</button>
      </div>
    </form>
  )
}
