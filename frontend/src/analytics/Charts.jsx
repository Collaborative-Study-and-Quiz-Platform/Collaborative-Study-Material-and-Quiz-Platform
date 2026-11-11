// Small SVG charts. Each chart has a text label for screen readers and the
// dashboard always puts the same numbers in a table beside it.
import { shortLabel } from './chartData'

const WIDTH = 640

export function LineChart({ points, label }) {
  const height = 300
  const margin = { left: 46, right: 20, top: 24, bottom: 58 }
  const innerWidth = WIDTH - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom
  const x = (index) => (points.length === 1
    ? margin.left + innerWidth / 2
    : margin.left + (innerWidth * index) / (points.length - 1))
  const y = (value) => margin.top + innerHeight * (1 - Math.min(Math.max(value, 0), 100) / 100)
  const showTitles = points.length <= 8

  return (
    <svg className="analytics-chart" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={label}>
      <title>{label}</title>
      {[0, 25, 50, 75, 100].map((tick) => (
        <g key={tick}>
          <line className="chart-grid" x1={margin.left} x2={WIDTH - margin.right} y1={y(tick)} y2={y(tick)} />
          <text className="chart-axis-text" x={margin.left - 8} y={y(tick) + 4} textAnchor="end">{tick}%</text>
        </g>
      ))}
      <polyline className="chart-line" fill="none"
        points={points.map((point, index) => `${x(index)},${y(point.value)}`).join(' ')} />
      {points.map((point, index) => (
        <g key={`${point.label}-${index}`}>
          <circle className="chart-dot" cx={x(index)} cy={y(point.value)} r="5">
            <title>{`${point.label}: ${point.value}% (${point.detail})`}</title>
          </circle>
          <text className="chart-value-text" x={x(index)} y={y(point.value) - 11} textAnchor="middle">
            {`${Math.round(point.value)}%`}
          </text>
          <text className="chart-axis-text" x={x(index)} y={height - margin.bottom + 20} textAnchor="middle">
            {showTitles ? shortLabel(point.label, 13) : String(index + 1)}
          </text>
          <text className="chart-axis-text chart-axis-muted" x={x(index)} y={height - margin.bottom + 36} textAnchor="middle">
            {point.date}
          </text>
        </g>
      ))}
    </svg>
  )
}

// Horizontal bars with a label on the left and the value at the end of each bar
export function HorizontalBarChart({ items, label, max = 100 }) {
  const rowHeight = 36
  const labelWidth = 150
  const valueSpace = 56
  const barSpace = WIDTH - labelWidth - valueSpace
  const height = items.length * rowHeight + 12

  return (
    <svg className="analytics-chart" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={label}>
      <title>{label}</title>
      <line className="chart-grid" x1={labelWidth} x2={labelWidth} y1="4" y2={height - 8} />
      {items.map((item, index) => {
        const top = 8 + index * rowHeight
        const width = Math.max(0, Math.min(item.value, max)) / max * barSpace
        return (
          <g key={`${item.label}-${index}`}>
            <text className="chart-axis-text chart-row-label" x={labelWidth - 10} y={top + 17} textAnchor="end">
              {shortLabel(item.label, 20)}
            </text>
            <rect className={`chart-bar chart-bar-${item.tone}`} x={labelWidth} y={top + 3} width={width} height="22" rx="4">
              <title>{`${item.label}: ${item.valueLabel} (${item.detail})`}</title>
            </rect>
            <text className="chart-value-text" x={labelWidth + width + 8} y={top + 19}>{item.valueLabel}</text>
          </g>
        )
      })}
    </svg>
  )
}

// Vertical bars, used for the score distribution (counts of students)
export function ColumnChart({ items, label }) {
  const height = 280
  const margin = { left: 44, right: 16, top: 24, bottom: 44 }
  const innerWidth = WIDTH - margin.left - margin.right
  const innerHeight = height - margin.top - margin.bottom
  const largest = Math.max(1, ...items.map((item) => item.value))
  const step = Math.max(1, Math.ceil(largest / 4))
  const top = step * Math.ceil(largest / step)
  const ticks = []
  for (let tick = 0; tick <= top; tick += step) ticks.push(tick)
  const slot = innerWidth / Math.max(items.length, 1)
  const y = (value) => margin.top + innerHeight * (1 - value / top)

  return (
    <svg className="analytics-chart" viewBox={`0 0 ${WIDTH} ${height}`} role="img" aria-label={label}>
      <title>{label}</title>
      {ticks.map((tick) => (
        <g key={tick}>
          <line className="chart-grid" x1={margin.left} x2={WIDTH - margin.right} y1={y(tick)} y2={y(tick)} />
          <text className="chart-axis-text" x={margin.left - 8} y={y(tick) + 4} textAnchor="end">{tick}</text>
        </g>
      ))}
      {items.map((item, index) => {
        const barWidth = slot * 0.68
        const left = margin.left + slot * index + (slot - barWidth) / 2
        return (
          <g key={`${item.label}-${index}`}>
            <rect className={`chart-bar chart-bar-${item.tone}`} x={left} y={y(item.value)} width={barWidth}
              height={margin.top + innerHeight - y(item.value)} rx="3">
              <title>{`${item.label}%: ${item.valueLabel} students`}</title>
            </rect>
            {item.value > 0 && (
              <text className="chart-value-text" x={left + barWidth / 2} y={y(item.value) - 6} textAnchor="middle">
                {item.valueLabel}
              </text>
            )}
            <text className="chart-axis-text" x={left + barWidth / 2} y={height - margin.bottom + 18} textAnchor="middle">
              {item.label}
            </text>
          </g>
        )
      })}
      <text className="chart-axis-text chart-axis-muted" x={margin.left + innerWidth / 2} y={height - 6} textAnchor="middle">
        Score range (% of marks)
      </text>
    </svg>
  )
}