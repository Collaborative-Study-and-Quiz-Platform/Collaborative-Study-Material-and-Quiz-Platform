export default async function handleMaterialUpload(event, {
  materialForm,
  token,
  apiBaseUrl,
  parseResponse,
  setMaterialForm,
  setIsSubmitting,
  setFeedback,
}) {
  event.preventDefault()
  const { file, course, subject, topic } = materialForm
  const extension = file?.name.split('.').pop()?.toLowerCase()
  if (!file || !['pdf', 'docx', 'ppt'].includes(extension)) {
    setFeedback({ type: 'error', text: 'Choose a PDF, DOCX, or PPT file.' })
    return
  }
  if (![course, subject, topic].every((value) => value.trim())) {
    setFeedback({ type: 'error', text: 'Course, subject, and topic are required.' })
    return
  }

  const formData = new FormData()
  formData.append('file', file)
  formData.append('course', course.trim())
  formData.append('subject', subject.trim())
  formData.append('topic', topic.trim())
  setIsSubmitting(true)
  setFeedback(null)
  try {
    await parseResponse(await fetch(`${apiBaseUrl}/api/materials`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: formData,
    }))
    setMaterialForm({ file: null, course: '', subject: '', topic: '' })
    event.target.reset()
    setFeedback({ type: 'success', text: 'Study material uploaded successfully.' })
  } catch (error) {
    setFeedback({ type: 'error', text: error.message || 'Unable to upload the material.' })
  } finally {
    setIsSubmitting(false)
  }
}

