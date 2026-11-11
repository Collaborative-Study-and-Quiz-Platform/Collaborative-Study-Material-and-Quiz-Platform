// Turns the analytics service reports into the plain lists the charts draw.
// Pure functions, so they can be checked without rendering anything.

export const TONE_LABELS = {
  strength: 'Strength',
  developing: 'Developing',
  weakness: 'Needs work',
}

const TREND_TEXT = {
  improving: 'Improving',
  declining: 'Declining',
  steady: 'Steady',
}

export function shortLabel(text, max = 14) {
  const value = String(text ?? '').trim()
  return value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value
}

// 83.33 -> "83.3%", 50 -> "50%", missing -> "–"
export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '–'
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`
}

export function formatNumber(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '–'
  return Number.isInteger(value) ? String(value) : value.toFixed(1)
}

export function formatDate(value) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}

// One point per fully graded attempt, oldest first
export function trendPoints(report) {
  const points = report?.scoreTrend?.points ?? []
  return points
    .filter((point) => point.gradingStatus === 'complete')
    .map((point) => ({
      label: point.quizTitle || 'Quiz',
      value: point.percentage,
      detail: `${formatNumber(point.score)} of ${formatNumber(point.maxScore)} marks`,
      date: formatDate(point.submittedAt),
    }))
}

// Weakest topics first, so the ones that need work are seen first
export function topicBars(report) {
  return [...(report?.topics ?? [])]
    .sort((a, b) => a.percentage - b.percentage)
    .map((topic) => ({
      label: topic.topic,
      group: topic.subject,
      value: topic.percentage,
      valueLabel: formatPercent(topic.percentage),
      tone: topic.classification,
      detail: `${formatNumber(topic.marksAwarded)} of ${formatNumber(topic.maxMarks)} marks`,
    }))
}

export function distributionBars(report) {
  return (report?.scoreDistribution ?? []).map((bucket) => ({
    label: bucket.label,
    value: bucket.count,
    valueLabel: String(bucket.count),
    tone: 'primary',
  }))
}

// Questions in quiz order, labelled Q1, Q2, ...
export function questionBars(report) {
  return (report?.questions ?? []).map((question, index) => {
    const rate = question.successRate
    let tone = 'strength'
    if (rate === null || rate === undefined) tone = 'neutral'
    else if (rate < 50) tone = 'weakness'
    else if (rate < 70) tone = 'developing'

    return {
      label: `Q${index + 1}`,
      group: question.topic || '',
      text: question.text || '',
      value: rate ?? 0,
      valueLabel: formatPercent(rate),
      tone,
      detail: `${question.fullMarksCount ?? 0} of ${question.studentsGraded ?? 0} students got full marks`,
    }
  })
}

export function trendSummary(trend) {
  const text = TREND_TEXT[trend?.direction]
  if (!text) return { label: 'Not enough data yet', tone: 'neutral' }

  const change = trend.changePercentagePoints
  const sign = change > 0 ? '+' : ''
  const tone = trend.direction === 'improving' ? 'strength' : trend.direction === 'declining' ? 'weakness' : 'neutral'
  return { label: `${text} (${sign}${formatNumber(change)} points)`, tone }
}