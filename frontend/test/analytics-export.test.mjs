import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let AnalyticsDashboard
let seeds
let exporter

before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' })
  AnalyticsDashboard = (await server.ssrLoadModule('/src/analytics/AnalyticsDashboard.jsx')).default
  seeds = await server.ssrLoadModule('/src/analytics/seedData.js')
  exporter = await server.ssrLoadModule('/src/analytics/exportReport.js')
})
after(async () => { await server?.close() })

const DATE = new Date('2026-11-11T08:00:00Z')
const render = (props) => renderToStaticMarkup(createElement(AnalyticsDashboard, props))
const count = (text, pattern) => (text.match(pattern) || []).length

const unescapeHtml = (text) => text
  .replace(/<[^>]+>/g, '')
  .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

// Reads every chart table on the page: its title, headings and rows
function pageTables(markup) {
  return [...markup.matchAll(/<table[^>]*>([\s\S]*?)<\/table>/g)].map(([, inner]) => ({
    title: unescapeHtml(inner.match(/<caption[^>]*>([\s\S]*?)<\/caption>/)[1]),
    columns: [...inner.matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((cell) => unescapeHtml(cell[1])),
    rows: [...inner.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
      .map((row) => [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((cell) => unescapeHtml(cell[1])))
      .filter((cells) => cells.length > 0),
  }))
}

const studentDoc = (options = {}) => exporter.buildReportDocument('student', seeds.SEED_INDIVIDUAL_REPORT, { generatedOn: DATE, ...options })
const instructorDoc = (options = {}) => exporter.buildReportDocument('instructor', seeds.SEED_CLASS_REPORT, { generatedOn: DATE, ...options })

// Text shown by the PDF's "(...) Tj" commands, in order
function pdfText(bytes) {
  const raw = Buffer.from(bytes).toString('latin1')
  return [...raw.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].map((match) => match[1].replace(/\\([\\()])/g, '$1'))
}

describe('TC-Perf-04 the exported file matches the on-screen report', () => {
  test('the exported tables have the same titles, headings and rows as the page', () => {
    for (const [role, props, doc] of [
      ['student', { individualReport: seeds.SEED_INDIVIDUAL_REPORT }, studentDoc()],
      ['instructor', { classReport: seeds.SEED_CLASS_REPORT }, instructorDoc()],
    ]) {
      const onScreen = pageTables(render({ role, ...props }))
      const exported = doc.sections.filter((section) => section.title !== 'Summary')

      assert.equal(onScreen.length, exported.length, role)
      onScreen.forEach((table, index) => {
        assert.equal(table.title, exported[index].title, `${role} title`)
        assert.deepEqual(table.columns, exported[index].columns, `${role} columns`)
        assert.deepEqual(table.rows, exported[index].rows, `${role} rows`)
      })
    }
  })

  test('the exported summary shows the same numbers as the summary cards', () => {
    for (const [role, props, doc] of [
      ['student', { individualReport: seeds.SEED_INDIVIDUAL_REPORT }, studentDoc()],
      ['instructor', { classReport: seeds.SEED_CLASS_REPORT }, instructorDoc()],
    ]) {
      const markup = render({ role, ...props })
      const summary = doc.sections.find((section) => section.title === 'Summary')

      assert.equal(summary.rows.length, 5)
      for (const [label, value] of summary.rows) {
        assert.ok(markup.includes(`analytics-stat-label">${label}<`), `${role}: ${label}`)
        assert.ok(unescapeHtml(markup).includes(value.split(' (')[0]), `${role}: ${label} = ${value}`)
      }
    }
  })

  test('the CSV has a title block, a summary and one block per table', () => {
    const lines = exporter.buildCsv(studentDoc()).split('\r\n')

    assert.ok(exporter.buildCsv(studentDoc()).startsWith('\uFEFF'))
    assert.equal(lines[0], '\uFEFFMy performance report')
    assert.equal(lines[1], 'For,Individual performance')
    assert.equal(lines[2], 'Generated,2026-11-11')
    assert.ok(lines.includes('Summary'))
    assert.ok(lines.includes('Measure,Value'))
    assert.ok(lines.includes('Average score,62.5%'))
    assert.ok(lines.includes('Score trend'))
    assert.ok(lines.includes('Quiz,Date,Score,Marks'))
    assert.ok(lines.some((line) => /^Networks Basics,8 Sep[a-z]*,50%,12 of 24 marks$/.test(line)))
    assert.ok(lines.includes('Subject,Topic,Score,Marks,Level'))
    assert.ok(lines.includes('Databases,Normalisation,41.7%,10 of 24 marks,Needs work'))
    assert.ok(lines.at(-1) === '' && lines.at(-2) !== '')
  })

  test('the instructor CSV holds the class numbers', () => {
    const csv = exporter.buildCsv(instructorDoc())

    assert.match(csv, /For,Computer Networks - Mid-term Quiz/)
    assert.match(csv, /Students completed,24/)
    assert.match(csv, /Pass rate,"41\.7% \(10 passed, pass mark 60%\)"/)
    assert.match(csv, /30-40%,7/)
    assert.match(csv, /\r\nQ8: Which TCP phase doubles the congestion window every round trip\?,TCP,16\.7%,4 of 24 students got full marks\r\n/)
  })

  test('sample data is labelled as sample data in the file', () => {
    assert.match(exporter.buildCsv(studentDoc({ sample: true })), /Note,"Sample data/)
    assert.doesNotMatch(exporter.buildCsv(studentDoc()), /Sample data/)
    assert.ok(pdfText(exporter.buildPdf(studentDoc({ sample: true }))).some((line) => line.startsWith('Sample data')))
  })

  test('a report with no results exports a short note and no tables', () => {
    const doc = exporter.buildReportDocument('student', { summary: { attemptsCompleted: 0 } }, { generatedOn: DATE })

    assert.deepEqual(doc.sections, [])
    assert.match(exporter.buildCsv(doc), /Note,No completed quizzes yet\./)
    assert.ok(exporter.buildPdf(doc).length > 300)
  })
})

describe('CSV safety', () => {
  test('commas, quotes and line breaks stay inside their cell', () => {
    const doc = { title: 'T', subtitle: 'S', generatedOn: '2026-11-11', notes: [], sections: [
      { title: 'Q', columns: ['A', 'B'], rows: [['one, two', 'say "hi"'], ['line\nbreak', 'plain']] },
    ] }
    const csv = exporter.buildCsv(doc)

    assert.match(csv, /"one, two","say ""hi"""/)
    assert.match(csv, /"line\nbreak",plain/)
  })

  test('text that Excel could run as a formula is made harmless', () => {
    const doc = { title: 'T', subtitle: 'S', generatedOn: '2026-11-11', notes: [], sections: [
      { title: 'Q', columns: ['A'], rows: [['=HYPERLINK("http://x")'], ['+1'], ['-2'], ['@SUM(A1)'], ['safe']] },
    ] }
    const csv = exporter.buildCsv(doc)

    assert.match(csv, /"'=HYPERLINK\(""http:\/\/x""\)"/)
    assert.match(csv, /\r\n'\+1\r\n'-2\r\n'@SUM\(A1\)\r\nsafe\r\n/)
  })
})

describe('PDF file', () => {
  test('is a well formed PDF: header, byte offsets, page count, end marker', () => {
    const bytes = exporter.buildPdf(instructorDoc())
    const raw = Buffer.from(bytes).toString('latin1')

    assert.ok(raw.startsWith('%PDF-1.4\n'))
    assert.ok(raw.endsWith('%%EOF\n'))
    assert.ok(bytes.every((byte) => byte < 128), 'only plain ASCII bytes')

    const startXref = Number(raw.match(/startxref\n(\d+)\n%%EOF/)[1])
    assert.ok(raw.slice(startXref).startsWith('xref\n'))
    const entries = [...raw.slice(startXref).matchAll(/(\d{10}) 00000 n \n/g)].map((match) => Number(match[1]))
    entries.forEach((offset, index) => {
      assert.ok(raw.slice(offset).startsWith(`${index + 1} 0 obj\n`), `object ${index + 1} is at byte ${offset}`)
    })
    assert.equal(Number(raw.match(/\/Size (\d+)/)[1]), entries.length + 1)

    const pages = count(raw, /\/Type \/Page /g)
    assert.equal(Number(raw.match(/\/Count (\d+)/)[1]), pages)
    assert.equal(pages, 1)
    for (const [, length, body] of raw.matchAll(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/g)) {
      assert.equal(body.length, Number(length))
    }
  })

  test('shows the same text as the page', () => {
    const lines = pdfText(exporter.buildPdf(instructorDoc())).join('\n')

    for (const expected of ['Class performance report', 'Computer Networks - Mid-term Quiz', 'Generated on 2026-11-11',
      'Summary', 'Students completed', 'Score distribution', '30-40%', 'Question success rate', 'Page 1 of 1']) {
      assert.ok(lines.includes(expected), expected)
    }
    const student = pdfText(exporter.buildPdf(studentDoc())).join('\n')
    for (const expected of ['My performance report', 'Networks Basics', 'Normalisation', 'Needs work', '62.5%', 'Improving (+33.3 points)']) {
      assert.ok(student.includes(expected), expected)
    }
  })

  test('long tables continue on the next page with the headings repeated', () => {
    const report = structuredClone(seeds.SEED_CLASS_REPORT)
    report.questions = Array.from({ length: 120 }, (_, index) => ({
      ...seeds.SEED_CLASS_REPORT.questions[index % 8], questionId: `q${index}`,
    }))
    const raw = Buffer.from(exporter.buildPdf(exporter.buildReportDocument('instructor', report, { generatedOn: DATE }))).toString('latin1')
    const pages = count(raw, /\/Type \/Page /g)

    assert.ok(pages >= 4, `${pages} pages`)
    const perPage = [...raw.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map((match) => match[1])
    assert.equal(perPage.length, pages)
    perPage.forEach((content, index) => {
      assert.ok(content.includes(`(Page ${index + 1} of ${pages}) Tj`), `footer on page ${index + 1}`)
      if (index > 0) assert.ok(content.includes('(Question) Tj'), `headings on page ${index + 1}`)
    })
    assert.ok(raw.includes('(Q120: '))
  })

  test('long words and unusual characters do not break the file', () => {
    const doc = { title: 'Report (final) \\ draft', subtitle: 'Caf\u00E9 \u2013 \u201Cquoted\u201D \u2026 \u65E5\u672C\u8A9E', generatedOn: '2026-11-11', notes: [], sections: [
      { title: 'Tricky', columns: ['Text', 'Value'], rows: [['W'.repeat(300), '1'], ['a (b) \\ c', '2'], ['\u00DCn\u00EFcode', '3']] },
    ] }
    const bytes = exporter.buildPdf(doc)
    const text = pdfText(bytes)

    assert.ok(bytes.every((byte) => byte < 128))
    assert.ok(text.includes('Report (final) \\ draft'))
    assert.ok(text.includes('Caf? - "quoted" ... ???'))
    assert.ok(text.includes('a (b) \\ c'))
    assert.ok(text.filter((line) => /^W+$/.test(line)).length > 1, 'the long word is split over several lines')
  })

  test('text is cleaned before it goes into the PDF', () => {
    assert.equal(exporter.pdfSafeText('a\tb\nc'), 'a b c')
    assert.equal(exporter.pdfSafeText(null), '')
  })
})

describe('file names and buttons', () => {
  test('file names say what is inside and when it was made', () => {
    assert.equal(exporter.exportFileName('student', null, 'csv', DATE), 'my-performance-report-2026-11-11.csv')
    assert.equal(exporter.exportFileName('instructor', seeds.SEED_CLASS_REPORT, 'pdf', DATE),
      'class-performance-computer-networks-mid-term-quiz-2026-11-11.pdf')
    assert.equal(exporter.exportFileName('instructor', { quiz: { title: '***' } }, 'csv', DATE), 'class-performance-quiz-2026-11-11.csv')
    assert.equal(exporter.exportFileName('instructor', {}, 'csv', DATE), 'class-performance-quiz-2026-11-11.csv')
  })

  test('both dashboards offer the two downloads once there is data', () => {
    for (const markup of [
      render({ role: 'student', individualReport: seeds.SEED_INDIVIDUAL_REPORT }),
      render({ role: 'instructor', classReport: seeds.SEED_CLASS_REPORT }),
    ]) {
      assert.equal(count(markup, /<button type="button" class="analytics-export"/g), 2)
      assert.match(markup, /Download CSV/)
      assert.match(markup, /Download PDF/)
    }
  })

  test('there are no download buttons when there is nothing to export', () => {
    const empty = { summary: { attemptsCompleted: 0 } }

    assert.doesNotMatch(render({ role: 'student', individualReport: empty }), /Download/)
    assert.doesNotMatch(render({ role: 'instructor' }), /Download/)
  })
})