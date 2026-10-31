# Analytics Service

Python microservice that computes performance analytics.

It implements CSQP-F-040 (individual performance report) and CSQP-F-041 (class-level
analytics). It is an internal service: only the Node.js backend calls it, and it never
touches the database. The backend sends the attempt data and gets the computed report back.

## Run

From `analytics-service/`:

    python -m venv .venv
    .venv\Scripts\Activate.ps1        (Windows PowerShell)
    pip install -r requirements.txt
    python -m app.server

The service listens on `http://127.0.0.1:8000` (set `ANALYTICS_PORT` to change the port).

## Test

    python -m unittest -v

## Endpoints

`GET /health` returns `{ "status": "OK", "service": "analytics-service" }`.

`POST /analytics/individual` returns the report for one student.

    {
      "studentId": "<user id>",
      "attempts": [
        {
          "attemptId": "<id>", "quizId": "<id>", "quizTitle": "Networks Quiz 1",
          "status": "submitted", "submittedAt": "2026-03-01T10:00:00Z",
          "grading": {
            "score": 3, "maxScore": 5, "percentage": 60,
            "gradingStatus": "complete", "passed": true,
            "results": [
              { "questionId": "<id>", "subject": "Networks", "topic": "TCP",
                "answered": true, "isCorrect": true, "marksAwarded": 2, "maxMarks": 2 }
            ]
          }
        }
      ]
    }

`POST /analytics/class` returns the analytics for one quiz.

    {
      "quiz": {
        "quizId": "<id>", "title": "Networks Quiz 1", "passingScore": 60, "totalMarks": 10,
        "questions": [
          { "questionId": "<id>", "text": "...", "type": "mcq", "marks": 2,
            "subject": "Networks", "topic": "TCP" }
        ]
      },
      "attempts": [ { "attemptId": "<id>", "studentId": "<id>", "status": "submitted",
                      "submittedAt": "...", "grading": { ... same as above ... } } ]
    }

Both return `{ "status": "success", "report": { ... } }`. Invalid input returns HTTP `400`
with `{ "status": "error", "message": "...", "errors": { "attempts.0.grading.score": "..." } }`.

The backend builds `subject` and `topic` for each result by looking up the quiz question's
`sourceQuestion` in the question bank; results without them are grouped under "Uncategorised".

## How the numbers are worked out

- Only attempts with status `submitted` or `auto_submitted` count. `in_progress` is ignored.
- An attempt with short-answer questions still waiting for manual grading is
  `pending_manual`. It is listed in the trend and counted, but it is left out of averages,
  pass rate and the score distribution until it is fully graded. Its already-graded
  questions still count towards topic and per-question statistics.
- Percentages are rounded to two decimals, halves rounding up.

**Individual report**

- `scoreTrend.points`: every completed attempt in date order.
- `scoreTrend.direction`: compares the latest fully graded percentage with the first.
  More than 5 points higher is `improving`, more than 5 lower is `declining`, otherwise
  `steady`. With fewer than two attempts it is `insufficient_data`.
- `topics`: marks earned over marks available per subject and topic. At or above 70% is a
  `strength`, below 50% is a `weakness`, in between is `developing`.

**Class report**

- `summary`: average score (marks), average, median, highest and lowest percentage, number
  passed and pass rate (against the quiz's passing score).
- `scoreDistribution`: ten 10-point buckets. A bucket includes its lower bound and excludes
  its upper bound, except the last one (`90-100`), which includes 100.
- `questions`: for each quiz question, `successRate` is the share of graded students who
  earned full marks; `averageMarksAwarded` is the mean mark.

The thresholds are constants at the top of `app/calculations.py`.