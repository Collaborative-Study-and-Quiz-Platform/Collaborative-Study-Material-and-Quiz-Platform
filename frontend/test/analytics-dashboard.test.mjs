import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { createServer } from 'vite'

let server
let AnalyticsDashboard
let seeds
let data

before(async () => {
  server = await createServer({ server: { middlewareMode: true, watch: null, hmr: false, ws: false }, appType: 'custom' })
  AnalyticsDashboard = (await server.ssrLoadModule('/src/analytics/AnalyticsDashboard.jsx')).default
  seeds = await server.ssrLoadModule('/src/analytics/seedData.js')
  data = await server.ssrLoadModule('/src/analytics/chartData.js')
})
after(async () => { await server?.close() })

const render = (props) => renderToStaticMarkup(createElement(AnalyticsDashboard, props))
const count = (markup, pattern) => (markup.match(pattern) || []).length

describe('TC-Perf-03 dashboard renders charts for the seeded dataset', () => {
  test('student dashboard draws the line chart and the topic bar chart', () => {
    const markup = render({ role: 'student', individualReport: seeds.SEED_INDIVIDUAL_REPORT, sample: true })

    assert.equal(count(markup, /<svg /g), 2)
    assert.equal(count(markup, /role="img"/g), 2)
    assert.equal(count(markup, /<circle /g), 6)
    assert.equal(count(markup, /<polyline /g), 1)
    assert.match(markup, /My performance/)
    assert.match(markup, /Score trend/)
    assert.match(markup, /Topic performance/)
    assert.match(markup, /Improving \(\+33\.3 points\)/)
    assert.match(markup, /Normalisation/)
    assert.match(markup, /Showing sample data/)
  })

  test('instructor dashboard draws the score distribution and the question success rate', () => {
    const markup = render({ role: 'instructor', classReport: seeds.SEED_CLASS_REPORT, sample: true })

    assert.equal(count(markup, /<svg /g), 2)
    assert.equal(count(markup, /<rect class="chart-bar chart-bar-primary"/g), 10)
    assert.equal(count(markup, /<rect class="chart-bar chart-bar-(strength|developing|weakness|neutral)"/g), 8)
    assert.match(markup, /Class performance/)
    assert.match(markup, /Score distribution/)
    assert.match(markup, /Question success rate/)
    assert.match(markup, /Computer Networks - Mid-term Quiz/)
    assert.match(markup, /41\.7%/)
  })

  test('neither dashboard shows NaN, undefined or null values', () => {
    const student = render({ role: 'student', individualReport: seeds.SEED_INDIVIDUAL_REPORT })
    const instructor = render({ role: 'instructor', classReport: seeds.SEED_CLASS_REPORT })

    for (const markup of [student, instructor]) {
      assert.doesNotMatch(markup, /NaN|undefined|null|Infinity/)
    }
  })

  test('every chart is also available as a table with the same rows', () => {
    const student = render({ role: 'student', individualReport: seeds.SEED_INDIVIDUAL_REPORT })
    const instructor = render({ role: 'instructor', classReport: seeds.SEED_CLASS_REPORT })

    assert.equal(count(student, /<table /g), 2)
    assert.equal(count(instructor, /<table /g), 2)
    assert.equal(count(student, /<tr>/g), 2 + 6 + 6)
    assert.equal(count(instructor, /<tr>/g), 2 + 10 + 8)
  })

  test('the sample note only shows for sample data', () => {
    const live = render({ role: 'student', individualReport: seeds.SEED_INDIVIDUAL_REPORT })

    assert.doesNotMatch(live, /Showing sample data/)
  })
})

describe('empty and partial reports', () => {
  test('a student with no completed quizzes sees a message instead of charts', () => {
    const empty = { summary: { attemptsCompleted: 0 }, scoreTrend: { points: [] }, topics: [] }
    const markup = render({ role: 'student', individualReport: empty })

    assert.match(markup, /No completed quizzes yet/)
    assert.equal(count(markup, /<svg /g), 0)
  })

  test('a missing report does not crash either dashboard', () => {
    assert.match(render({ role: 'student' }), /No completed quizzes yet/)
    assert.match(render({ role: 'instructor' }), /No submissions yet/)
  })

  test('a quiz with only one completed attempt still draws a chart', () => {
    const report = structuredClone(seeds.SEED_INDIVIDUAL_REPORT)
    report.summary.attemptsCompleted = 1
    report.scoreTrend = { direction: 'insufficient_data', changePercentagePoints: null, points: report.scoreTrend.points.slice(0, 1) }
    const markup = render({ role: 'student', individualReport: report })

    assert.equal(count(markup, /<circle /g), 1)
    assert.match(markup, /Not enough data yet/)
    assert.doesNotMatch(markup, /NaN|undefined|null/)
  })

  test('attempts waiting for manual grading are noted and left out of the trend', () => {
    const report = structuredClone(seeds.SEED_INDIVIDUAL_REPORT)
    report.summary.pendingManualAttempts = 1
    report.scoreTrend.points.push({ attemptId: 'p', quizTitle: 'Essay quiz', submittedAt: '2026-10-20T10:00:00Z', score: 3, maxScore: 10, percentage: 30, passed: null, gradingStatus: 'pending_manual' })
    const markup = render({ role: 'student', individualReport: report })

    assert.match(markup, /waiting for manual grading/)
    assert.equal(count(markup, /<circle /g), 6)
  })
})

describe('chart data helpers', () => {
  test('the seeded reports are consistent with each other', () => {
    const { SEED_INDIVIDUAL_REPORT: individual, SEED_CLASS_REPORT: classReport } = seeds
    const students = classReport.scoreDistribution.reduce((total, bucket) => total + bucket.count, 0)

    assert.equal(students, classReport.summary.attemptsCompleted)
    assert.equal(individual.scoreTrend.points.length, individual.summary.attemptsCompleted)
    assert.equal(classReport.questions.length, 8)
  })

  test('topics are listed weakest first', () => {
    const values = data.topicBars(seeds.SEED_INDIVIDUAL_REPORT).map((bar) => bar.value)

    assert.deepEqual(values, [...values].sort((a, b) => a - b))
    assert.equal(data.topicBars(seeds.SEED_INDIVIDUAL_REPORT)[0].tone, 'weakness')
  })

  test('questions keep quiz order and are coloured by success rate', () => {
    const bars = data.questionBars({ questions: [{ successRate: 90 }, { successRate: 60 }, { successRate: 10 }, { successRate: null }] })

    assert.deepEqual(bars.map((bar) => bar.label), ['Q1', 'Q2', 'Q3', 'Q4'])
    assert.deepEqual(bars.map((bar) => bar.tone), ['strength', 'developing', 'weakness', 'neutral'])
    assert.equal(bars[3].valueLabel, '–')
  })

  test('formats percentages, labels and trends', () => {
    assert.equal(data.formatPercent(83.33), '83.3%')
    assert.equal(data.formatPercent(50), '50%')
    assert.equal(data.formatPercent(null), '–')
    assert.equal(data.shortLabel('A very long quiz title indeed', 10), 'A very lo…')
    assert.equal(data.trendSummary({ direction: 'declining', changePercentagePoints: -12 }).label, 'Declining (-12 points)')
    assert.equal(data.trendSummary({ direction: 'steady', changePercentagePoints: 2 }).tone, 'neutral')
    assert.equal(data.trendSummary({ direction: 'insufficient_data' }).label, 'Not enough data yet')
  })
})