export default function MaterialUpload({ materialForm, setMaterialForm, isSubmitting, onSubmit }) {
  return (
    <section className="upload-page" aria-labelledby="upload-title">
      <div className="page-heading">
        <p className="eyebrow">Study resources</p>
        <h1 id="upload-title">Upload study material</h1>
        <p>Add a document and organize it for students.</p>
      </div>
      <form className="upload-panel" onSubmit={onSubmit} noValidate>
        <div className="field upload-file-field">
          <label htmlFor="material-file">Document</label>
          <input
            id="material-file"
            type="file"
            accept=".pdf,.docx,.ppt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-powerpoint"
            onChange={(event) => setMaterialForm((current) => ({
              ...current, file: event.target.files[0],
            }))}
          />
          <p className="field-help">PDF, DOCX, and PPT files are supported.</p>
        </div>
        <div className="upload-metadata-grid">
          {['course', 'subject', 'topic'].map((field) => (
            <div className="field" key={field}>
              <label htmlFor={`material-${field}`}>
                {field[0].toUpperCase() + field.slice(1)}
              </label>
              <input
                id={`material-${field}`}
                type="text"
                value={materialForm[field]}
                onChange={(event) => setMaterialForm((current) => ({
                  ...current, [field]: event.target.value,
                }))}
                maxLength={100}
                required
              />
            </div>
          ))}
        </div>
        <button type="submit" className="upload-submit" disabled={isSubmitting}>
          {isSubmitting ? 'Uploading...' : 'Upload material'}
        </button>
      </form>
    </section>
  )
}
