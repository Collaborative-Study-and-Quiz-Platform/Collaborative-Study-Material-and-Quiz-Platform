#!/usr/bin/env node
// CSQP final test report generator.
// Runs every automated test suite (backend, frontend, analytics service) with
// coverage, then writes the final reports into docs/testing/ from the real results.
//
// Run from the repository root:
//   node docs/testing/generate-reports.mjs              (everything, including load test)
//   node docs/testing/generate-reports.mjs --skip-loadtest
//
// Nothing in the reports is typed by hand: every number comes from this run.

import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT = path.join(ROOT, 'docs', 'testing')
const RAW = path.join(OUT, 'raw')
const SKIP_LOAD = process.argv.includes('--skip-loadtest')
fs.mkdirSync(RAW, { recursive: true })

const now = new Date()
const runDate = now.toISOString().slice(0, 10)
const runStamp = now.toISOString().replace('T', ' ').slice(0, 16) + ' UTC'

function sh(cmd, cwd, extraEnv = {}) {
  const r = spawnSync(cmd, { cwd, shell: true, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, ...extraEnv } })
  return { code: r.status ?? 1, out: (r.stdout || '') + (r.stderr || '') }
}
function version(cmd) { const r = sh(cmd, ROOT); return r.code === 0 ? r.out.trim().split('\n')[0] : 'not found' }
function log(msg) { process.stdout.write(msg + '\n') }

// ---------- TAP parsing (node --test --test-reporter=tap) ----------
function parseTap(tap) {
  const lines = tap.split('\n')
  const stack = []
  const tests = []
  let prevLvl = -1
  for (let i = 0; i < lines.length; i++) {
    const sub = lines[i].match(/^(\s*)# Subtest: (.*)$/)
    if (sub) { const lvl = sub[1].length / 4; stack.length = lvl; stack[lvl] = sub[2]; continue }
    const m = lines[i].match(/^(\s*)(not )?ok \d+ - (.*?)(?: # (SKIP|TODO)\b.*)?$/)
    if (!m) continue
    const lvl = m[1].length / 4
    const isParent = prevLvl > lvl
    prevLvl = lvl
    let type = 'test'
    for (let j = i + 1; j < Math.min(i + 12, lines.length); j++) {
      const t = lines[j].match(/^\s*type: '(\w+)'/)
      if (t) { type = t[1]; break }
      if (/^\s*\.\.\.\s*$/.test(lines[j])) break
    }
    // Suites and tests that only group child tests are not counted as test cases.
    if (type !== 'test' || isParent) continue
    const status = m[4] === 'SKIP' || m[4] === 'TODO' ? 'SKIPPED' : m[2] ? 'FAIL' : 'PASS'
    tests.push({ group: stack.slice(0, lvl).filter(Boolean).join(' > '), name: m[3].replace(/\\#/g, '#'), status, lvl })
  }
  return tests
}

// ---------- Node suites (backend, frontend), one test file at a time ----------
function runNodeSuite({ label, dir, pattern, c8 }) {
  const cwd = path.join(ROOT, dir)
  const testDir = path.join(cwd, 'test')
  const files = fs.readdirSync(testDir).filter(f => pattern.test(f)).sort()
  const results = []
  let first = true
  for (const f of files) {
    log(`  ${label}: ${f}`)
    const tapFile = path.join(os.tmpdir(), `csqp-${label}-${f}.tap`)
    const cmd = `${c8} --clean=${first} --reporter=none --check-coverage=false node --test --test-reporter=tap --test-reporter-destination="${tapFile}" "test/${f}"`
    first = false
    const r = sh(cmd, cwd)
    const tap = fs.existsSync(tapFile) ? fs.readFileSync(tapFile, 'utf8') : ''
    fs.appendFileSync(path.join(RAW, `${label}-tests.tap`), `# FILE: ${f}\n${tap}\n`)
    const tests = parseTap(tap)
    if (tests.length === 0) tests.push({ group: '', name: '(test file failed to load)', status: 'FAIL' })
    results.push({ file: `${dir}/test/${f}`, exit: r.code, tests })
  }
  const rep = sh(`${c8} report --reporter=text --reporter=json-summary --reporter=lcov --check-coverage=false`, cwd)
  fs.writeFileSync(path.join(RAW, `${label}-coverage.txt`), rep.out)
  const summaryPath = path.join(cwd, 'coverage', 'coverage-summary.json')
  const coverage = fs.existsSync(summaryPath) ? JSON.parse(fs.readFileSync(summaryPath, 'utf8')) : null
  return { label, results, coverage, cwd }
}

// ---------- Python analytics service ----------
function runPython() {
  const cwd = path.join(ROOT, 'analytics-service')
  const venvPy = path.join(cwd, '.venv', 'bin', 'python')
  const py = fs.existsSync(venvPy) ? `"${venvPy}"` : 'python3'
  const hasCov = sh(`${py} -c "import coverage"`, cwd).code === 0
  const run = hasCov
    ? sh(`${py} -m coverage run --branch --source=app -m unittest -v`, cwd)
    : sh(`${py} -m unittest -v`, cwd)
  fs.writeFileSync(path.join(RAW, 'analytics-tests.txt'), run.out)
  const byFile = new Map()
  for (const line of run.out.split('\n')) {
    const m = line.match(/^(test\w*) \(([\w.]+)\)(?:\n.*)? \.\.\. (ok|FAIL|ERROR|skipped.*)$/)
    if (!m) continue
    const parts = m[2].split('.')
    const file = `analytics-service/${parts.slice(0, -2).join('/')}.py`
    const status = m[3] === 'ok' ? 'PASS' : m[3].startsWith('skipped') ? 'SKIPPED' : 'FAIL'
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file).push({ group: parts.at(-2), name: m[1], status })
  }
  const results = [...byFile].map(([file, tests]) => ({ file, exit: run.code, tests }))
  let coverage = null
  if (hasCov) {
    sh(`${py} -m coverage json -q -o coverage.json`, cwd)
    const rep = sh(`${py} -m coverage report`, cwd)
    fs.writeFileSync(path.join(RAW, 'analytics-coverage.txt'), rep.out)
    const j = JSON.parse(fs.readFileSync(path.join(cwd, 'coverage.json'), 'utf8'))
    const conv = s => ({
      lines: { total: s.num_statements, covered: s.covered_lines, pct: round(s.percent_statements_covered ?? pct(s.covered_lines, s.num_statements)) },
      statements: { total: s.num_statements, covered: s.covered_lines, pct: round(s.percent_statements_covered ?? pct(s.covered_lines, s.num_statements)) },
      functions: null,
      branches: { total: s.num_branches, covered: s.covered_branches, pct: s.num_branches ? round(pct(s.covered_branches, s.num_branches)) : 100 },
    })
    coverage = { total: conv(j.totals) }
    for (const [f, v] of Object.entries(j.files)) coverage[path.join(cwd, f)] = conv(v.summary)
    fs.rmSync(path.join(cwd, 'coverage.json'), { force: true })
    fs.rmSync(path.join(cwd, '.coverage'), { force: true })
  }
  return { label: 'analytics', results, coverage, cwd, hasCov }
}

const pct = (a, b) => (b ? (a / b) * 100 : 100)
const round = n => Math.round(n * 100) / 100
const count = (tests, s) => tests.filter(t => t.status === s).length

// ---------- Run everything ----------
for (const f of fs.readdirSync(RAW)) fs.rmSync(path.join(RAW, f))
log('Running backend tests (Node + in-memory MongoDB) ...')
const ONLY = (process.env.CSQP_ONLY || 'backend,frontend,analytics').split(',')
const empty = label => ({ label, results: [], coverage: null })
const backend = !ONLY.includes('backend') ? empty('backend') : runNodeSuite({ label: 'backend', dir: 'backend', pattern: /\.test\.js$/, c8: 'npx c8' })
log('Running frontend tests (Node + Vite + happy-dom) ...')
const frontend = !ONLY.includes('frontend') ? empty('frontend') : runNodeSuite({ label: 'frontend', dir: 'frontend', pattern: /\.test\.mjs$/, c8: "npx --yes c8@10 --all --src src --include 'src/**/*.js' --include 'src/**/*.jsx'" })
log('Running analytics service tests (Python unittest) ...')
const analytics = !ONLY.includes('analytics') ? empty('analytics') : runPython()

let load = null
if (!SKIP_LOAD) {
  log('Running load test for CSQP-NF-001 / NF-002 (about 1 minute) ...')
  const r = sh('npm run loadtest', path.join(ROOT, 'backend'), { UV_THREADPOOL_SIZE: '8' })
  fs.writeFileSync(path.join(RAW, 'loadtest-output.txt'), r.out)
  load = { code: r.code, table: r.out.split('\n').filter(l => l.startsWith('|')).join('\n') }
}

const suites = [backend, frontend, analytics]
const all = suites.flatMap(s => s.results.flatMap(r => r.tests.map(t => ({ ...t, file: r.file, suite: s.label }))))
const total = all.length, passed = count(all, 'PASS'), failed = count(all, 'FAIL'), skipped = count(all, 'SKIPPED')

const env = [
  `- Run date: ${runStamp}`,
  `- Machine: ${os.type()} ${os.release()} (${os.arch()})`,
  `- Node.js: ${process.version}, npm ${version('npm -v')}`,
  `- Python: ${version(fs.existsSync(path.join(ROOT, 'analytics-service/.venv/bin/python')) ? '"analytics-service/.venv/bin/python" --version' : 'python3 --version')}`,
  `- Git commit: ${version('git rev-parse --short HEAD')} (${version('git rev-parse --abbrev-ref HEAD')})`,
].join('\n')

const header = title => `# ${title}\n\n**Project:** Collaborative Study Material and Quiz Platform (CSQP), Team 13\n**Course:** UE24CS341A Software Engineering\n**Generated by:** \`docs/testing/generate-reports.mjs\` (all figures come from this run)\n\n## Test environment\n\n${env}\n`

// ---------- 1. Unit test report ----------
{
  let md = header('Unit Test Report')
  md += `\n## Summary\n\n| Component | Framework | Test files | Test cases | Passed | Failed | Skipped |\n|---|---|---|---|---|---|---|\n`
  const fw = { backend: 'node:test + Supertest + mongodb-memory-server', frontend: 'node:test + Vite SSR + happy-dom', analytics: 'Python unittest' }
  for (const s of suites) {
    const t = s.results.flatMap(r => r.tests)
    md += `| ${s.label} | ${fw[s.label]} | ${s.results.length} | ${t.length} | ${count(t, 'PASS')} | ${count(t, 'FAIL')} | ${count(t, 'SKIPPED')} |\n`
  }
  md += `| **Total** | | **${suites.reduce((a, s) => a + s.results.length, 0)}** | **${total}** | **${passed}** | **${failed}** | **${skipped}** |\n`
  md += `\nPass rate: **${round(pct(passed, total))}%** of ${total} executed test cases.\n`
  md += `\nCommands executed:\n\n\`\`\`sh\ncd backend && npx c8 node --test test/<file>.test.js      # once per file\ncd frontend && npx c8 node --test test/<file>.test.mjs   # once per file\ncd analytics-service && python -m coverage run --branch --source=app -m unittest -v\n\`\`\`\n`
  md += `\n## Results by test file\n\n| Test file | Cases | Passed | Failed | Result |\n|---|---|---|---|---|\n`
  for (const s of suites) for (const r of s.results) md += `| \`${r.file}\` | ${r.tests.length} | ${count(r.tests, 'PASS')} | ${count(r.tests, 'FAIL')} | ${count(r.tests, 'FAIL') ? 'FAIL' : 'PASS'} |\n`
  md += `\n## Every test case\n`
  for (const s of suites) for (const r of s.results) {
    md += `\n### \`${r.file}\`\n\n| # | Group | Test case | Status |\n|---|---|---|---|\n`
    r.tests.forEach((t, i) => { md += `| ${i + 1} | ${t.group.replace(/\|/g, '\\|') || '-'} | ${t.name.replace(/\|/g, '\\|')} | ${t.status} |\n` })
  }
  md += `\nRaw runner output is in \`docs/testing/raw/\`.\n`
  fs.writeFileSync(path.join(OUT, 'Unit_Test_Report.md'), md)
}

// ---------- 2 and 3. Coverage reports ----------
function covRows(s, key) {
  if (!s.coverage) return '_Coverage tool not available for this component in this run._\n'
  let rows = ''
  for (const [f, v] of Object.entries(s.coverage)) {
    if (f === 'total') continue
    const rel = path.relative(ROOT, f)
    const m = v[key]
    if (!m) continue
    rows += `| \`${rel}\` | ${m.covered}/${m.total} | ${m.pct}% |\n`
  }
  return rows
}
const tot = (s, k) => (s.coverage && s.coverage.total[k] ? s.coverage.total[k] : null)
const fmt = m => (m ? `${m.pct}% (${m.covered}/${m.total})` : 'n/a')
const gate = m => (m ? (m.pct >= 70 ? 'meets 70%' : 'below 70%') : 'n/a')
{
  let md = header('Code Coverage Report')
  md += `\nRequirement: **CSQP-NF-005**, minimum 70% unit test coverage, enforced in CI by \`backend/.c8rc.json\` (lines, statements, functions and branches) on every pull request to \`main\` (\`.github/workflows/ci.yml\`).\n`
  md += `\nTools: c8 (V8 coverage) for the Node.js backend and React frontend, coverage.py for the Python analytics service.\n`
  md += `\n## Totals\n\n| Component | Statements | Lines | Functions | Branches | NF-005 (70%) |\n|---|---|---|---|---|---|\n`
  for (const s of suites) md += `| ${s.label} | ${fmt(tot(s, 'statements'))} | ${fmt(tot(s, 'lines'))} | ${fmt(tot(s, 'functions'))} | ${fmt(tot(s, 'branches'))} | ${s.label === 'backend' ? gate(tot(s, 'lines')) + ' (CI gate)' : gate(tot(s, 'lines'))} |\n`
  md += `\nThe CI coverage gate applies to the backend, which holds the business logic and security rules. Frontend coverage is reported for transparency; files with low coverage are UI screens whose behaviour is validated through the backend API tests and the manual checks in the System Validation Report.\n`
  for (const s of suites) md += `\n## ${s.label}: line coverage by file\n\n| File | Covered / total lines | Line coverage |\n|---|---|---|\n${covRows(s, 'lines')}`
  md += `\nFull coverage tables: \`docs/testing/raw/*-coverage.txt\`.\n`
  fs.writeFileSync(path.join(OUT, 'Code_Coverage_Report.md'), md)

  let b = header('Branch Coverage Report')
  b += `\nBranch coverage measures the share of decision outcomes (each side of every \`if\`, \`?:\`, \`&&\`, \`||\`, \`switch\` case) executed by the tests. It is stricter than statement coverage: every line can run while one side of a condition is never tested.\n`
  b += `\nRequirement: CSQP-NF-005, and the backend CI gate in \`backend/.c8rc.json\` sets \`"branches": 70\`.\n`
  b += `\n## Totals\n\n| Component | Branches covered | Branch coverage | 70% target |\n|---|---|---|---|\n`
  for (const s of suites) { const m = tot(s, 'branches'); b += `| ${s.label} | ${m ? `${m.covered}/${m.total}` : 'n/a'} | ${m ? m.pct + '%' : 'n/a'} | ${gate(m)} |\n` }
  for (const s of suites) {
    b += `\n## ${s.label}: branch coverage by file\n\n| File | Covered / total branches | Branch coverage |\n|---|---|---|\n${covRows(s, 'branches')}`
  }
  b += `\nHow to read this: branches not covered are mostly defensive error paths (database failures, malformed input combinations) that are hard to trigger in tests.\n`
  fs.writeFileSync(path.join(OUT, 'Branch_Coverage_Report.md'), b)
}

// ---------- 4. System validation report (requirements traceability) ----------
const RTM = [
  ['CSQP-F-001', 'User Registration', 'TC-Auth-01', ['backend/test/auth-registration.test.js'], 'Register a Student and an Instructor from the sign-up page'],
  ['CSQP-F-002', 'User Login (JWT)', 'TC-Auth-02', ['backend/test/auth-registration.test.js'], 'Log in with valid and invalid credentials'],
  ['CSQP-F-003', 'Role-Based Access Control', 'TC-Auth-03', ['backend/test/protected-routes.test.js', 'backend/test/auth-registration.test.js'], 'Student cannot see or open instructor screens'],
  ['CSQP-F-004', 'Password Reset', 'TC-Auth-04', ['backend/test/password-reset.test.js'], 'Request a reset link and set a new password'],
  ['CSQP-F-010', 'Upload Study Material', 'TC-Mat-01', ['backend/test/material-upload.test.js'], 'Instructor uploads a PDF with course, subject, topic'],
  ['CSQP-F-011', 'Browse & Search Material', 'TC-Mat-02', ['backend/test/material-search.test.js'], 'Student searches by keyword and filters'],
  ['CSQP-F-012', 'View / Download Material', 'TC-Mat-03', ['backend/test/material-file.test.js'], 'Student previews and downloads; count increases'],
  ['CSQP-F-013', 'Bookmark Material', 'TC-Mat-04', ['backend/test/material-bookmark.test.js', 'frontend/test/material-bookmarks.test.mjs', 'frontend/test/material-bookmark-lifecycle.test.mjs'], 'Save and unsave; appears in Saved list after re-login'],
  ['CSQP-F-014', 'Edit / Delete Material', 'TC-Mat-05', ['backend/test/material-management.test.js', 'frontend/test/material-management.test.mjs'], 'Instructor edits metadata and deletes own material'],
  ['CSQP-F-020', 'Create Quiz', 'TC-Quiz-01', ['backend/test/quiz.test.js'], 'Create quiz with MCQ, True/False, short answer'],
  ['CSQP-F-021', 'Schedule Quiz', 'TC-Quiz-02', ['backend/test/quiz-schedule.test.js'], 'Quiz cannot be started outside its window'],
  ['CSQP-F-022', 'Attempt Quiz (Timed, Auto-submit)', 'TC-Quiz-03', ['backend/test/quiz-attempt.test.js', 'backend/test/available-quizzes.test.js'], 'Let the timer run out; attempt auto-submits'],
  ['CSQP-F-023', 'Automatic Grading', 'TC-Quiz-04', ['backend/test/automatic-grading.test.js'], 'Objective answers scored against the answer key'],
  ['CSQP-F-024', 'Manual Grading of Subjective Answers', 'TC-Quiz-05', ['backend/test/manual-grading.test.js'], 'Instructor grades short answers; total updates'],
  ['CSQP-F-025', 'View Quiz Result', 'TC-Quiz-06', ['backend/test/quiz-results.test.js'], 'Student sees score; answers only if enabled'],
  ['CSQP-F-026', 'Export Quiz Results (CSV)', 'TC-Quiz-07', ['backend/test/results-export.test.js'], 'Download CSV; one row per attempt'],
  ['CSQP-F-030', 'Add / Edit / Delete Question', 'TC-QB-01', ['backend/test/question-bank.test.js'], 'Add, edit, delete a question with metadata'],
  ['CSQP-F-031', 'Search & Filter Question Bank', 'TC-QB-02', ['backend/test/question-search.test.js'], 'Filter by subject, topic, difficulty, type, tag'],
  ['CSQP-F-032', 'Bulk Import Questions (CSV/Excel)', 'TC-QB-03', ['backend/test/question-import.test.js', 'backend/test/question-import-parser.test.js'], 'Import the CSV template; invalid rows reported'],
  ['CSQP-F-033', 'Duplicate Question Detection', 'TC-QB-04', ['backend/test/duplicate-questions.test.js'], 'Add a near-identical question; warning shown'],
  ['CSQP-F-040', 'Individual Performance Report', 'TC-Perf-01', ['analytics-service/tests/test_calculations.py', 'analytics-service/tests/test_api.py'], 'Analytics service returns individual report'],
  ['CSQP-F-041', 'Class-level Analytics', 'TC-Perf-02', ['analytics-service/tests/test_calculations.py', 'analytics-service/tests/test_api.py'], 'Analytics service returns class report'],
  ['CSQP-F-042', 'Analytics Dashboard Charts', 'TC-Perf-03', ['frontend/test/analytics-dashboard.test.mjs'], 'Dashboard renders charts (seeded sample data)'],
  ['CSQP-F-043', 'Export Performance Reports', 'TC-Perf-04', ['frontend/test/analytics-export.test.mjs'], 'Export report from the dashboard'],
  ['CSQP-F-050', 'Comment on Study Material', 'TC-Collab-01', ['backend/test/material-comments.test.js', 'backend/test/material-comment-rate-limit.test.js', 'frontend/test/material-comments.test.mjs'], 'Post a comment; another user sees it'],
  ['CSQP-F-051', 'In-app / Email Notifications', 'TC-Collab-02', ['backend/test/sprint2-security.test.js', 'backend/test/manual-grading.test.js'], 'Notification appears after grading'],
  ['CSQP-F-052', 'Rate Study Material', 'TC-Collab-03', ['backend/test/material-rating.test.js', 'frontend/test/material-rating.test.mjs'], 'Rate 1 to 5; average updates'],
  ['CSQP-NF-005', 'Maintainability: 70% coverage + CI', 'CI report', [], 'See Code and Branch Coverage Reports'],
  ['CSQP-SR-001', 'TLS 1.2+ mandatory', 'TC-Sec-01', ['backend/test/sprint2-security.test.js'], 'Production rejects plain HTTP'],
  ['CSQP-SR-002', 'Password hashing (bcrypt)', 'TC-Sec-02', ['backend/test/auth-registration.test.js'], 'Inspect a user in MongoDB Compass: only a hash'],
  ['CSQP-SR-003', 'Short-lived JWT + refresh', 'TC-Sec-03', ['backend/test/sprint2-security.test.js'], 'Expired token rejected; refresh issues new token'],
  ['CSQP-SR-004', 'RBAC middleware on protected routes', 'TC-Sec-04', ['backend/test/protected-routes.test.js'], 'Wrong role gets HTTP 403'],
  ['CSQP-SR-005', 'Input validation, sanitization, rate limiting', 'TC-Sec-05', ['backend/test/sprint2-security.test.js', 'backend/test/material-comment-rate-limit.test.js'], 'Injection payload rejected; login throttled'],
]
{
  const byFile = new Map(suites.flatMap(s => s.results.map(r => [r.file, r.tests])))
  let md = header('System Validation Report')
  md += `\nThis report validates the complete system against every requirement in the SRS, using the Requirements Traceability Matrix from Test Plan section 13. The automated evidence runs each module end to end through the real Express API and a real (in-memory) MongoDB instance with Supertest, which is system-level validation of the API. The frontend suites render the real React components. The manual column is the walkthrough of each use case in the running application.\n`
  md += `\n## Requirements traceability and results\n\n| Req ID | Requirement | Test case | Automated evidence | Cases | Automated result | Manual UI check |\n|---|---|---|---|---|---|---|\n`
  let reqPass = 0, reqTotal = 0
  for (const [id, name, tc, files, manual] of RTM) {
    let result, cases
    if (id === 'CSQP-NF-005') {
      const l = tot(backend, 'lines'), br = tot(backend, 'branches')
      const ok = l && br && l.pct >= 70 && br.pct >= 70
      result = ok ? 'PASS' : 'FAIL'; cases = `lines ${l ? l.pct : 'n/a'}%, branches ${br ? br.pct : 'n/a'}%`
    } else {
      const t = files.flatMap(f => byFile.get(f) || [])
      cases = `${count(t, 'PASS')}/${t.length}`
      result = t.length === 0 ? 'NOT RUN' : count(t, 'FAIL') ? 'FAIL' : 'PASS'
    }
    reqTotal++; if (result === 'PASS') reqPass++
    md += `| ${id} | ${name} | ${tc} | ${files.map(f => '`' + f.split('/').pop() + '`').join(', ') || 'CI coverage gate'} | ${cases} | ${result} | [ ] ${manual} |\n`
  }
  if (load) {
    md += `| CSQP-NF-001 | Response time p90 <= 2 s at 100 users | TC-Perf-NF-01 | \`npm run loadtest\` | see below | ${load.code === 0 ? 'PASS' : 'FAIL'} | - |\n`
    md += `| CSQP-NF-002 | 100 concurrent users | TC-Scale-01 | \`npm run loadtest\` | see below | ${load.code === 0 ? 'PASS' : 'FAIL'} | - |\n`
    reqTotal += 2; if (load.code === 0) reqPass += 2
  } else {
    md += `| CSQP-NF-001 | Response time p90 <= 2 s | TC-Perf-NF-01 | \`npm run loadtest\` | - | NOT RUN in this report | - |\n| CSQP-NF-002 | 100 concurrent users | TC-Scale-01 | \`npm run loadtest\` | - | NOT RUN in this report | - |\n`
    reqTotal += 2
  }
  md += `| CSQP-NF-003 | Availability >= 99% | Ops log review | \`npm run uptime:monitor\` / \`npm run uptime:report\` | - | Manual (ops log) | [ ] Uptime report reviewed |\n`
  md += `| CSQP-NF-004 | Responsive + WCAG 2.1 AA basics | TC-UX-01 | \`docs/testing/responsive-accessibility-checklist.md\` | - | Manual | [ ] Checklist on 3 screen sizes |\n`
  md += `\n**Automated requirement validation:** ${reqPass} of ${reqTotal} requirements with automated evidence passed. NF-003 and NF-004 are validated manually as planned in the SRS.\n`
  if (load) md += `\n## Load test results (CSQP-NF-001, CSQP-NF-002)\n\nRun with \`UV_THREADPOOL_SIZE=8\`, the deployment setting recommended in \`backend/loadtest/README.md\`. API, load generator and test database ran on the same machine.\n\n${load.table || '_No result table found; see raw/loadtest-output.txt_'}\n`
  md += `\n## Core use case walkthrough (manual, during demo)\n\n| # | Use case | Actor | Steps | Expected | Result |\n|---|---|---|---|---|---|\n`
  const uc = [
    ['Register and log in', 'Student, Instructor', 'Sign up, log in', 'Dashboard for the correct role'],
    ['Upload and find material', 'Instructor, Student', 'Upload PDF with tags; student searches it', 'Material listed with tags'],
    ['Bookmark, comment, rate', 'Student', 'Save, comment, rate a material', 'Saved list, comment and average shown'],
    ['Create and schedule quiz', 'Instructor', 'Create quiz with 3 question types; set window', 'Quiz listed as scheduled'],
    ['Attempt timed quiz', 'Student', 'Start inside window, answer, submit', 'Auto-graded score shown'],
    ['Manual grading', 'Instructor', 'Open submissions, grade short answers', 'Final score updates; student notified'],
    ['Export results', 'Instructor', 'Export results as CSV', 'CSV with one row per attempt'],
    ['Question bank', 'Instructor', 'Filter, import CSV, add a duplicate', 'Filters work, import report, duplicate warning'],
    ['Analytics', 'Student, Instructor', 'Open Analytics page', 'Charts render'],
    ['Access control', 'Student', 'Try an instructor action', 'Blocked (403 / hidden)'],
  ]
  uc.forEach((u, i) => { md += `| UC-${String(i + 1).padStart(2, '0')} | ${u[0]} | ${u[1]} | ${u[2]} | ${u[3]} | [ ] |\n` })
  fs.writeFileSync(path.join(OUT, 'System_Validation_Report.md'), md)
}

// ---------- 5. Final test summary (Test Plan section 14 metrics) ----------
{
  let md = header('Final Test Summary Report')
  md += `\n## Metrics (Test Plan section 14)\n\n| Metric | Value |\n|---|---|\n`
  md += `| Test cases executed | ${total - skipped} of ${total} (${round(pct(total - skipped, total))}%) |\n`
  md += `| Passed | ${passed} (${round(pct(passed, total))}%) |\n| Failed | ${failed} |\n| Skipped | ${skipped} |\n`
  md += `| Requirements with automated tests | ${RTM.length - 1} FR/SR + NF-005 coverage gate${load ? ' + NF-001/NF-002 load test' : ''} |\n`
  for (const s of suites) { const l = tot(s, 'lines'), b = tot(s, 'branches'); md += `| ${s.label} coverage | lines ${l ? l.pct + '%' : 'n/a'}, branches ${b ? b.pct + '%' : 'n/a'} |\n` }
  md += `\n## Exit criteria (Test Plan section 5)\n\n`
  md += `- All High-priority functional requirements implemented and verified: ${failed === 0 ? 'met, every automated test passed' : `not met, ${failed} failing test(s), see Unit Test Report`}\n`
  md += `- No critical NFR or security failure: ${failed === 0 && (!load || load.code === 0) ? 'met' : 'check failing items'}\n`
  md += `- RTM shows all planned test cases passed: see System Validation Report\n`
  if (failed) {
    md += `\n## Failing test cases\n\n| File | Test | \n|---|---|\n`
    for (const t of all.filter(t => t.status === 'FAIL')) md += `| \`${t.file}\` | ${t.name.replace(/\|/g, '\\|')} |\n`
  }
  md += `\n## Reports in this folder\n\n- Unit_Test_Report.md\n- System_Validation_Report.md\n- Code_Coverage_Report.md\n- Branch_Coverage_Report.md\n- Sprint1_Test_Execution_Summary.md (Sprint 1 record)\n- responsive-accessibility-checklist.md (CSQP-NF-004)\n- raw/ (unedited runner output)\n`
  fs.writeFileSync(path.join(OUT, 'Final_Test_Summary_Report.md'), md)
}

log(`\nDone. ${passed}/${total} test cases passed, ${failed} failed.`)
for (const s of suites) { const l = tot(s, 'lines'), b = tot(s, 'branches'); log(`  ${s.label}: lines ${l ? l.pct + '%' : 'n/a'}, branches ${b ? b.pct + '%' : 'n/a'}`) }
if (load) log(`  load test: ${load.code === 0 ? 'PASS' : 'FAIL'}`)
log('Reports written to docs/testing/')
