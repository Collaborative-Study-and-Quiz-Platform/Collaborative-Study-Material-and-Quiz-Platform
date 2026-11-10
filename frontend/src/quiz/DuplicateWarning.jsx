// Shown when a question looks like one already in the bank (CSQP-F-033)
export default function DuplicateWarning({ duplicates, onSaveAnyway, onKeepEditing, onUseExisting, saveLabel = 'Save anyway', isSaving }) {
  return (
    <div className="duplicate-warning" role="alert">
      <strong>This looks like a question already in the bank</strong>
      <p>Check the similar question{duplicates.length === 1 ? '' : 's'} below before saving a copy.</p>
      <ul>
        {duplicates.map((item) => (
          <li key={item._id}>
            <span className="duplicate-similarity">{item.similarity}% similar</span>
            <span className="duplicate-text">{item.text}</span>
            <span className="duplicate-meta">{item.subject} · {item.topic}</span>
            {onUseExisting && (
              <button type="button" className="quiz-link-button" onClick={() => onUseExisting(item)}>
                Use this question instead
              </button>
            )}
          </li>
        ))}
      </ul>
      <div className="quiz-actions">
        <button type="button" className="quiz-danger-button" onClick={onSaveAnyway} disabled={isSaving}>{saveLabel}</button>
        <button type="button" className="secondary-button quiz-auto-button" onClick={onKeepEditing}>Keep editing</button>
      </div>
    </div>
  )
}
