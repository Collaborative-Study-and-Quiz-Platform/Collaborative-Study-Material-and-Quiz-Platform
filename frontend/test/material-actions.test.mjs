import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let MaterialActions
let Preview
let MaterialLibrary
before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' })
  const actions = await server.ssrLoadModule('/src/materials/MaterialActions.jsx')
  MaterialActions = actions.default
  Preview = actions.Preview
  MaterialLibrary = (await server.ssrLoadModule('/src/materials/MaterialLibrary.jsx')).default
})
after(async () => { await server?.close() })
const material = { _id: 'material-id', originalFilename: 'notes.pdf', fileType: 'pdf' }
const render = (Component, props) => renderToStaticMarkup(createElement(Component, props))

test('Student rows retain View and Download; instructor rows have View only', () => {
  const student = render(MaterialActions, { material, canDownload: true })
  assert.match(student, /aria-label="View notes.pdf"/)
  assert.match(student, /aria-label="Download notes.pdf"/)
  const instructor = render(MaterialActions, { material, canDownload: false })
  assert.match(instructor, /aria-label="View notes.pdf"/)
  assert.doesNotMatch(instructor, /Download|Downloading/)
})

test('instructor preview fallback has no Download action for PDF, DOCX or PPT', () => {
  for (const fileType of ['pdf', 'docx', 'ppt']) {
    const markup = render(Preview, { material: { ...material, fileType }, canDownload: false })
    assert.match(markup, /Close preview/)
    assert.doesNotMatch(markup, /Download|Downloading/)
    if (fileType !== 'pdf') assert.match(markup, /Inline preview is unavailable for DOCX and legacy PPT files/)
    const student = render(Preview, { material: { ...material, fileType }, canDownload: true })
    assert.match(student, /Download material/)
    if (fileType !== 'pdf') assert.match(student, /Download the document to open it/)
  }
})

test('one shared library preserves Student heading and shows instructor My Uploads', () => {
  const student = render(MaterialLibrary, { role: 'student' })
  assert.match(student, /Browse materials/)
  assert.match(student, /Search materials shared by instructors/)
  const instructor = render(MaterialLibrary, { role: 'instructor' })
  assert.match(instructor, /My Uploads/)
  assert.match(instructor, /Find and preview your uploaded study materials/)
  for (const markup of [student, instructor]) {
    assert.match(markup, /material-keyword/)
    for (const field of ['course', 'subject', 'topic']) assert.match(markup, new RegExp(`material-filter-${field}`))
  }
})
