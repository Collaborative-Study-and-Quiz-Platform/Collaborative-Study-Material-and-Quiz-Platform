import './analytics.css'
import { ColumnChart, HorizontalBarChart, LineChart } from './Charts'
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

function StatCard({ label, value, hint, tone = 'neutral' }) {
  return (
    <div className={`analytics-stat analytics-stat-${tone}`}>
      <span className="analytics-stat-label">{label}</span>
      <strong className="analytics-stat-value">{value}</strong>
      {hint && <span className="analytics-stat-hint">{hint}</span>}
    </div>
  )
}

function ChartCard({ title, description, children, columns, rows }) {
  return (
    <section className="analytics-card" aria-label={title}>
      <h2>{title}</h2>
      {description && <p className="analytics-card-text">{description}</p>}
      <div className="analytics-chart-scroll">{children}</div>
      <details className="analytics-table-toggle">
        <summary>View as a table</summary>
        <table className="analytics-table">
          <caption className="analytics-visually-hidden">{title}</caption>
          <thead>
            <tr>{columns.map((column) => <th key={column} scope="col">{column}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>
            ))}
          </tbody>
        </table>
      </details>
    </section>
  )
}

function EmptyState({ title, text }) {
  return (
    <section className="analytics-empty" role="status">
      <strong>{title}</strong>
      <p>{text}</p>
    </section>
  )
}

function PendingNotice({ count, children }) {
  if (!count) return null
  return <p className="analytics-note" role="note">{children}</p>
}

function StudentDashboard({ report }) {
  const summary = report?.summary
  if (!summary || summary.attemptsCompleted === 0) {
    return (
      <EmptyState title="No completed quizzes yet"
        text="Your charts appear here after you submit your first quiz." />
    )
  }

  const trend = trendSummary(report.scoreTrend)
  const points = trendPoints(report)
  const topics = topicBars(report)

  return (
    <>
      <div className="analytics-stats">
        <StatCard label="Quizzes completed" value={summary.attemptsCompleted} />
        <StatCard label="Average score" value={formatPercent(summary.averagePercentage)} />
        <StatCard label="Best score" value={formatPercent(summary.bestPercentage)} />
        <StatCard label="Latest score" value={formatPercent(summary.latestPercentage)} />
        <StatCard label="Score trend" value={trend.label} tone={trend.tone} />
      </div>
      <PendingNotice count={summary.pendingManualAttempts}>
        {summary.pendingManualAttempts} quiz attempt(s) are waiting for manual grading and are not in these averages yet.
      </PendingNotice>

      {points.length > 0 && (
        <ChartCard title="Score trend" description="Your score on each quiz, oldest to newest."
          columns={['Quiz', 'Date', 'Score', 'Marks']}
          rows={points.map((point) => [point.label, point.date, formatPercent(point.value), point.detail])}>
          <LineChart points={points} label={`Line chart of your quiz scores. ${trend.label}.`} />
        </ChartCard>
      )}

      {topics.length > 0 && (
        <ChartCard title="Topic performance"
          description="Share of marks earned in each topic. 70% or more is a strength, below 50% needs work."
          columns={['Subject', 'Topic', 'Score', 'Marks', 'Level']}
          rows={topics.map((topic) => [topic.group, topic.label, topic.valueLabel, topic.detail, TONE_LABELS[topic.tone]])}>
          <HorizontalBarChart items={topics} label="Bar chart of your score in each topic, weakest first." />
          <ul className="analytics-legend" aria-label="Colour key">
            {['strength', 'developing', 'weakness'].map((tone) => (
              <li key={tone}><span className={`analytics-swatch chart-bar-${tone}`} aria-hidden="true" />{TONE_LABELS[tone]}</li>
            ))}
          </ul>
        </ChartCard>
      )}
    </>
  )
}

function InstructorDashboard({ report }) {
  const summary = report?.summary
  if (!summary || summary.attemptsCompleted === 0) {
    return (
      <EmptyState title="No submissions yet"
        text="Class charts appear here after students submit this quiz." />
    )
  }

  const distribution = distributionBars(report)
  const questions = questionBars(report)

  return (
    <>
      <div className="analytics-stats">
        <StatCard label="Students completed" value={summary.attemptsCompleted} />
        <StatCard label="Average score" value={formatPercent(summary.averagePercentage)}
          hint={`${formatNumber(summary.averageScore)} of ${formatNumber(report.quiz?.totalMarks)} marks`} />
        <StatCard label="Median score" value={formatPercent(summary.medianPercentage)} />
        <StatCard label="Pass rate" value={formatPercent(summary.passRate)}
          hint={`${summary.passedCount} passed (pass mark ${report.quiz?.passingScore ?? '–'}%)`} />
        <StatCard label="Highest / lowest"
          value={`${formatPercent(summary.highestPercentage)} / ${formatPercent(summary.lowestPercentage)}`} />
      </div>
      <PendingNotice count={summary.pendingManualAttempts}>
        {summary.pendingManualAttempts} submission(s) are waiting for manual grading and are not in these statistics yet.
      </PendingNotice>

      <ChartCard title="Score distribution" description="How many students scored in each 10% range."
        columns={['Score range', 'Students']}
        rows={distribution.map((bucket) => [`${bucket.label}%`, bucket.valueLabel])}>
        <ColumnChart items={distribution} label="Column chart of the number of students in each score range." />
      </ChartCard>

      {questions.length > 0 && (
        <ChartCard title="Question success rate"
          description="Share of students who earned full marks on each question. Low bars show the questions to revisit."
          columns={['Question', 'Topic', 'Success rate', 'Students with full marks']}
          rows={questions.map((question) => [`${question.label}: ${question.text}`, question.group, question.valueLabel, question.detail])}>
          <HorizontalBarChart items={questions} label="Bar chart of the success rate of each question." />
        </ChartCard>
      )}
    </>
  )
}

// role: 'student' shows the individual report, 'instructor' shows the class report.
// sample: true marks the numbers as example data.
export default function AnalyticsDashboard({ role, individualReport, classReport, sample = false }) {
  const isStudent = role === 'student'

  return (
    <section className="analytics-dashboard" aria-labelledby="analytics-title">
      <div className="page-heading">
        <p className="eyebrow">Analytics</p>
        <h1 id="analytics-title">{isStudent ? 'My performance' : 'Class performance'}</h1>
        <p>{isStudent
          ? 'See how your scores change over time and which topics to practise.'
          : `${classReport?.quiz?.title || 'Quiz'}: how the class did overall and question by question.`}
        </p>
      </div>
      {sample && (
        <p className="analytics-note analytics-sample" role="note">
          Showing sample data. Live analytics will replace it once this page is connected to the analytics service.
        </p>
      )}
      {isStudent
        ? <StudentDashboard report={individualReport} />
        : <InstructorDashboard report={classReport} />}
    </section>
  )
}