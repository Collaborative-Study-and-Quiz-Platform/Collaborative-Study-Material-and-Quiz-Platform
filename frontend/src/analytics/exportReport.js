// Exports the analytics dashboard as a CSV or PDF file (CSQP-F-043).
// The rows come from the same helpers as the on-screen tables, so a file
// always shows the same numbers as the page it was exported from.
import {
  TONE_LABELS,
  distributionBars,
  formatNumber,
  formatPercent,
  questionBars,
  topicBars,
  trendPoints,
  trendSummary,
} from './chartData'

const PLATFORM_NAME = 'Collaborative Study and Quiz Platform'

// ---------------------------------------------------------------------------
// 1. The report as plain data: a title, some notes and a list of tables
// ---------------------------------------------------------------------------

function studentSections(report) {
  const summary = report?.summary
  if (!summary || summary.attemptsCompleted === 0) return { sections: [], notes: ['No completed quizzes yet.'] }

  const trend = trendSummary(report.scoreTrend)
  const notes = []
  if (summary.pendingManualAttempts) {
    notes.push(`${summary.pendingManualAttempts} quiz attempt(s) are waiting for manual grading and are not in these averages yet.`)
  }

  return {
    notes,
    sections: [
      {
        title: 'Summary',
        columns: ['Measure', 'Value'],
        rows: [
          ['Quizzes completed', String(summary.attemptsCompleted)],
          ['Average score', formatPercent(summary.averagePercentage)],
          ['Best score', formatPercent(summary.bestPercentage)],
          ['Latest score', formatPercent(summary.latestPercentage)],
          ['Score trend', trend.label],
        ],
      },
      {
        title: 'Score trend',
        columns: ['Quiz', 'Date', 'Score', 'Marks'],
        rows: trendPoints(report).map((point) => [point.label, point.date, formatPercent(point.value), point.detail]),
      },
      {
        title: 'Topic performance',
        columns: ['Subject', 'Topic', 'Score', 'Marks', 'Level'],
        rows: topicBars(report).map((topic) => [topic.group, topic.label, topic.valueLabel, topic.detail, TONE_LABELS[topic.tone]]),
      },
    ],
  }
}

function instructorSections(report) {
  const summary = report?.summary
  if (!summary || summary.attemptsCompleted === 0) return { sections: [], notes: ['No submissions yet.'] }

  const notes = []
  if (summary.pendingManualAttempts) {
    notes.push(`${summary.pendingManualAttempts} submission(s) are waiting for manual grading and are not in these statistics yet.`)
  }

  return {
    notes,
    sections: [
      {
        title: 'Summary',
        columns: ['Measure', 'Value'],
        rows: [
          ['Students completed', String(summary.attemptsCompleted)],
          ['Average score', `${formatPercent(summary.averagePercentage)} (${formatNumber(summary.averageScore)} of ${formatNumber(report.quiz?.totalMarks)} marks)`],
          ['Median score', formatPercent(summary.medianPercentage)],
          ['Pass rate', `${formatPercent(summary.passRate)} (${summary.passedCount} passed, pass mark ${report.quiz?.passingScore ?? '\u2013'}%)`],
          ['Highest / lowest', `${formatPercent(summary.highestPercentage)} / ${formatPercent(summary.lowestPercentage)}`],
        ],
      },
      {
        title: 'Score distribution',
        columns: ['Score range', 'Students'],
        rows: distributionBars(report).map((bucket) => [`${bucket.label}%`, bucket.valueLabel]),
      },
      {
        title: 'Question success rate',
        columns: ['Question', 'Topic', 'Success rate', 'Students with full marks'],
        rows: questionBars(report).map((question) => [`${question.label}: ${question.text}`, question.group, question.valueLabel, question.detail]),
      },
    ],
  }
}

// role: 'student' uses the individual report, 'instructor' the class report.
export function buildReportDocument(role, report, { sample = false, generatedOn = new Date() } = {}) {
  const isStudent = role === 'student'
  const { sections, notes } = isStudent ? studentSections(report) : instructorSections(report)
  const allNotes = sample
    ? ['Sample data: these numbers are example data, not real results.', ...notes]
    : notes

  return {
    title: isStudent ? 'My performance report' : 'Class performance report',
    subtitle: isStudent ? 'Individual performance' : (report?.quiz?.title || 'Quiz'),
    generatedOn: generatedOn.toISOString().slice(0, 10),
    sample,
    notes: allNotes,
    sections,
  }
}

// ---------------------------------------------------------------------------
// 2. CSV
// ---------------------------------------------------------------------------

// Cells that start with = + - @ can be run as formulas when the file is opened
// in Excel, so text like that gets a leading apostrophe.
function csvCell(value) {
  let text = String(value ?? '')
  if (/^[-=+@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

const csvLine = (cells) => cells.map(csvCell).join(',')

export function buildCsv(document) {
  const lines = [
    csvLine([document.title]),
    csvLine(['For', document.subtitle]),
    csvLine(['Generated', document.generatedOn]),
    ...document.notes.map((note) => csvLine(['Note', note])),
  ]
  for (const section of document.sections) {
    lines.push('', csvLine([section.title]), csvLine(section.columns), ...section.rows.map(csvLine))
  }
  // The byte order mark makes Excel read the file as UTF-8.
  return `\uFEFF${lines.join('\r\n')}\r\n`
}

// ---------------------------------------------------------------------------
// 3. PDF (a small writer: A4, Helvetica, tables that wrap and run over pages)
// ---------------------------------------------------------------------------

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN = 40
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2
const FOOTER_SPACE = 24
const CELL_PADDING = 6
const BODY_SIZE = 9
const LINE_HEIGHT = 11.5

// Helvetica character widths (1/1000 em) for ASCII 32..126
const HELVETICA_WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  278, 278, 584, 584, 584, 556, 1015,
  667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611,
  278, 278, 278, 469, 556, 333,
  556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500,
  334, 260, 334, 584,
]

const REPLACEMENTS = [
  [/[\u2013\u2014\u2212]/g, '-'],
  [/\u2026/g, '...'],
  [/[\u2018\u2019]/g, "'"],
  [/[\u201C\u201D]/g, '"'],
  [/\u00D7/g, 'x'],
  [/[\u00A0\u2009\u202F]/g, ' '],
]

// The PDF uses a standard font, which only has plain characters. Anything else becomes "?".
export function pdfSafeText(value) {
  let text = String(value ?? '')
  for (const [pattern, replacement] of REPLACEMENTS) text = text.replace(pattern, replacement)
  return text.replace(/[\r\n\t]+/g, ' ').replace(/[^\x20-\x7E]/g, '?')
}

function textWidth(text, size, bold = false) {
  let total = 0
  for (const char of text) total += HELVETICA_WIDTHS[char.charCodeAt(0) - 32] ?? 556
  return (total / 1000) * size * (bold ? 1.08 : 1)
}

function wrapText(text, maxWidth, size, bold = false) {
  const lines = []
  let line = ''
  const push = () => { lines.push(line); line = '' }

  for (const word of text.split(' ')) {
    const attempt = line ? `${line} ${word}` : word
    if (textWidth(attempt, size, bold) <= maxWidth) {
      line = attempt
      continue
    }
    if (line) push()
    if (textWidth(word, size, bold) <= maxWidth) {
      line = word
      continue
    }
    // A single word wider than the cell is cut into pieces
    for (const char of word) {
      if (textWidth(line + char, size, bold) > maxWidth && line) push()
      line += char
    }
  }
  if (line || lines.length === 0) push()
  return lines
}

function columnWidths(section) {
  const count = section.columns.length
  const natural = section.columns.map((column, index) => {
    const cells = [column, ...section.rows.map((row) => row[index])]
    const widest = Math.max(...cells.map((cell) => textWidth(pdfSafeText(cell), BODY_SIZE, true)))
    return Math.min(widest, CONTENT_WIDTH * 0.6) + CELL_PADDING * 2
  })

  const total = natural.reduce((sum, width) => sum + width, 0)
  if (total <= CONTENT_WIDTH) {
    return natural.map((width) => (width / total) * CONTENT_WIDTH)
  }

  // Too wide: narrow columns keep their size and the wide ones share what is left
  const widths = [...natural]
  const fixed = new Set()
  let remaining = CONTENT_WIDTH
  for (;;) {
    const flexible = widths.map((_, index) => index).filter((index) => !fixed.has(index))
    const share = remaining / flexible.length
    const small = flexible.filter((index) => natural[index] <= share)
    if (small.length === 0) {
      for (const index of flexible) widths[index] = share
      break
    }
    for (const index of small) {
      widths[index] = natural[index]
      fixed.add(index)
      remaining -= natural[index]
    }
    if (fixed.size === count) break
  }
  return widths
}

const num = (value) => String(Number(value.toFixed(2)))
const escapePdfString = (text) => text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')

function layoutPages(document) {
  const pages = []
  let ops = []
  let top = MARGIN
  const limit = PAGE_HEIGHT - MARGIN - FOOTER_SPACE

  const newPage = () => { ops = []; pages.push(ops); top = MARGIN }
  const text = (x, baseline, value, size, { bold = false, color = '0.15 0.19 0.28' } = {}) => {
    ops.push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${color} rg ${num(x)} ${num(PAGE_HEIGHT - baseline)} Td (${escapePdfString(value)}) Tj ET`)
  }
  const rule = (y, color = '0.88 0.9 0.94') => {
    ops.push(`${color} RG 0.5 w ${num(MARGIN)} ${num(PAGE_HEIGHT - y)} m ${num(MARGIN + CONTENT_WIDTH)} ${num(PAGE_HEIGHT - y)} l S`)
  }
  const wrapRow = (cells, widths, bold) => cells.map((cell, index) => wrapText(pdfSafeText(cell), widths[index] - CELL_PADDING * 2, BODY_SIZE, bold))
  const rowHeight = (wrapped) => Math.max(...wrapped.map((lines) => lines.length)) * LINE_HEIGHT + 8

  const drawRow = (wrapped, widths, height, { bold = false, shaded = false } = {}) => {
    if (shaded) ops.push(`0.94 0.95 0.98 rg ${num(MARGIN)} ${num(PAGE_HEIGHT - top - height)} ${num(CONTENT_WIDTH)} ${num(height)} re f`)
    let x = MARGIN
    wrapped.forEach((lines, index) => {
      lines.forEach((line, lineIndex) => {
        text(x + CELL_PADDING, top + 4 + BODY_SIZE + lineIndex * LINE_HEIGHT, line, BODY_SIZE, { bold })
      })
      x += widths[index]
    })
    top += height
    rule(top)
  }

  newPage()
  text(MARGIN, top + 18, pdfSafeText(document.title), 18, { bold: true })
  top += 28
  for (const line of wrapText(pdfSafeText(document.subtitle), CONTENT_WIDTH, 11)) {
    text(MARGIN, top + 11, line, 11, { color: '0.35 0.38 0.46' })
    top += 15
  }
  text(MARGIN, top + 9, `Generated on ${document.generatedOn}`, 9, { color: '0.47 0.5 0.6' })
  top += 18

  document.notes.forEach((note, index) => {
    const sampleNote = document.sample && index === 0
    for (const line of wrapText(pdfSafeText(note), CONTENT_WIDTH, BODY_SIZE)) {
      text(MARGIN, top + BODY_SIZE, line, BODY_SIZE, { color: sampleNote ? '0.25 0.28 0.72' : '0.54 0.35 0' })
      top += LINE_HEIGHT
    }
    top += 4
  })
  top += 6

  for (const section of document.sections) {
    const widths = columnWidths(section)
    const header = wrapRow(section.columns, widths, true)
    const headerHeight = rowHeight(header)
    const body = section.rows.map((row) => wrapRow(row, widths, false))

    const firstRow = body.length ? rowHeight(body[0]) : 0
    if (top + 22 + headerHeight + firstRow > limit) newPage()
    text(MARGIN, top + 13, pdfSafeText(section.title), 13, { bold: true })
    top += 22

    rule(top)
    drawRow(header, widths, headerHeight, { bold: true, shaded: true })
    for (const wrapped of body) {
      const height = rowHeight(wrapped)
      if (top + height > limit) {
        newPage()
        drawRow(header, widths, headerHeight, { bold: true, shaded: true })
      }
      drawRow(wrapped, widths, height)
    }
    top += 16
  }

  // Footer on every page, now that the page count is known
  pages.forEach((pageOps, index) => {
    ops = pageOps
    text(MARGIN, PAGE_HEIGHT - 22, PLATFORM_NAME, 8, { color: '0.47 0.5 0.6' })
    const label = `Page ${index + 1} of ${pages.length}`
    text(PAGE_WIDTH - MARGIN - textWidth(label, 8), PAGE_HEIGHT - 22, label, 8, { color: '0.47 0.5 0.6' })
  })

  return pages
}

export function buildPdf(document) {
  const pages = layoutPages(document)
  const objects = []
  const FIRST_PAGE_OBJECT = 6

  objects.push('<< /Type /Catalog /Pages 2 0 R >>')
  objects.push(`<< /Type /Pages /Kids [${pages.map((_, index) => `${FIRST_PAGE_OBJECT + index * 2} 0 R`).join(' ')}] /Count ${pages.length} >>`)
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  objects.push(`<< /Title (${escapePdfString(pdfSafeText(document.title))}) /Creator (${PLATFORM_NAME}) /Producer (${PLATFORM_NAME}) >>`)
  pages.forEach((ops, index) => {
    const content = ops.join('\n')
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${FIRST_PAGE_OBJECT + index * 2 + 1} 0 R >>`)
    objects.push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)
  })

  // Every character is plain ASCII, so a character is one byte
  let file = '%PDF-1.4\n'
  const offsets = []
  objects.forEach((body, index) => {
    offsets.push(file.length)
    file += `${index + 1} 0 obj\n${body}\nendobj\n`
  })
  const xrefStart = file.length
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`

  const bytes = new Uint8Array(file.length)
  for (let index = 0; index < file.length; index += 1) bytes[index] = file.charCodeAt(index)
  return bytes
}

// ---------------------------------------------------------------------------
// 4. File names and the download itself
// ---------------------------------------------------------------------------

export function exportFileName(role, report, extension, generatedOn = new Date()) {
  const date = generatedOn.toISOString().slice(0, 10)
  if (role === 'student') return `my-performance-report-${date}.${extension}`
  const slug = String(report?.quiz?.title || 'quiz')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '')
  return `class-performance-${slug || 'quiz'}-${date}.${extension}`
}

export function downloadFile(fileName, data, mimeType) {
  const blob = new Blob([data], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.append(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// format: 'csv' or 'pdf'
export function exportReport(format, role, report, { sample = false } = {}) {
  const generatedOn = new Date()
  const reportDocument = buildReportDocument(role, report, { sample, generatedOn })
  const fileName = exportFileName(role, report, format, generatedOn)

  if (format === 'pdf') {
    downloadFile(fileName, buildPdf(reportDocument), 'application/pdf')
  } else {
    downloadFile(fileName, buildCsv(reportDocument), 'text/csv;charset=utf-8')
  }
  return fileName
}