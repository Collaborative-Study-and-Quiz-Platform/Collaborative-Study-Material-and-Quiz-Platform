"""Performance analytics calculations (CSQP-F-040 and CSQP-F-041).

These are pure functions. They receive plain dictionaries (the JSON sent by the
Node.js backend) and return plain dictionaries. Nothing here touches a
database or the network, so every number can be checked by hand in a test.
"""

from collections import defaultdict
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from statistics import median

# An attempt only counts once the student has handed it in (or time ran out).
COMPLETED_STATUSES = ("submitted", "auto_submitted")

# Topic classification, as a percentage of marks earned in that topic.
STRENGTH_THRESHOLD = 70.0   # at or above this: strength
WEAKNESS_THRESHOLD = 50.0   # below this: weakness (in between: developing)

# Score trend: the latest result must differ from the first by more than this
# many percentage points to count as improving or declining.
TREND_THRESHOLD = 5.0

UNCATEGORISED = "Uncategorised"
DISTRIBUTION_BUCKET_SIZE = 10

_EARLIEST = datetime.min.replace(tzinfo=timezone.utc)


def round2(value):
    """Round to two decimals, halves going up (66.665 -> 66.67)."""
    if value is None:
        return None
    return float(Decimal(str(value)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def _mean(values):
    return round2(sum(values) / len(values)) if values else None


def _percent(part, whole):
    return round2(part / whole * 100) if whole > 0 else None


def _parse_time(value):
    if isinstance(value, datetime):
        parsed = value
    else:
        try:
            parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
        except ValueError:
            return _EARLIEST
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed


def _label(value):
    if isinstance(value, str) and value.strip():
        return value.strip()
    return UNCATEGORISED


def is_completed(attempt):
    return attempt.get("status") in COMPLETED_STATUSES and isinstance(attempt.get("grading"), dict)


def is_fully_graded(attempt):
    return attempt["grading"].get("gradingStatus") == "complete"


def classify(percentage):
    if percentage >= STRENGTH_THRESHOLD:
        return "strength"
    if percentage < WEAKNESS_THRESHOLD:
        return "weakness"
    return "developing"


# ---------------------------------------------------------------------------
# CSQP-F-040: individual performance report
# ---------------------------------------------------------------------------

def _topic_breakdown(attempts):
    """Group graded questions by subject and topic across all attempts."""
    totals = defaultdict(lambda: {"awarded": 0, "max": 0, "questions": 0})
    pending = 0

    for attempt in attempts:
        for result in attempt["grading"].get("results", []):
            if result.get("marksAwarded") is None:
                pending += 1
                continue
            key = (_label(result.get("subject")), _label(result.get("topic")))
            totals[key]["awarded"] += result["marksAwarded"]
            totals[key]["max"] += result["maxMarks"]
            totals[key]["questions"] += 1

    topics = []
    for (subject, topic), data in sorted(totals.items(), key=lambda item: (item[0][0].lower(), item[0][1].lower())):
        percentage = _percent(data["awarded"], data["max"])
        topics.append({
            "subject": subject,
            "topic": topic,
            "questionsGraded": data["questions"],
            "marksAwarded": data["awarded"],
            "maxMarks": data["max"],
            "percentage": percentage,
            "classification": classify(percentage) if percentage is not None else "developing",
        })
    return topics, pending


def _score_trend(fully_graded):
    points = [attempt["grading"]["percentage"] for attempt in fully_graded]
    if len(points) < 2:
        return "insufficient_data", None

    change = round2(points[-1] - points[0])
    if change > TREND_THRESHOLD:
        return "improving", change
    if change < -TREND_THRESHOLD:
        return "declining", change
    return "steady", change


def individual_report(student_id, attempts):
    """Report for one student covering every completed quiz attempt."""
    completed = [attempt for attempt in attempts if is_completed(attempt)]
    completed.sort(key=lambda attempt: (_parse_time(attempt.get("submittedAt")), str(attempt.get("attemptId", ""))))

    fully_graded = [attempt for attempt in completed if is_fully_graded(attempt)]
    percentages = [attempt["grading"]["percentage"] for attempt in fully_graded]

    topics, pending_questions = _topic_breakdown(completed)
    direction, change = _score_trend(fully_graded)

    return {
        "studentId": student_id,
        "summary": {
            "attemptsCompleted": len(completed),
            "fullyGradedAttempts": len(fully_graded),
            "pendingManualAttempts": len(completed) - len(fully_graded),
            "averagePercentage": _mean(percentages),
            "bestPercentage": max(percentages) if percentages else None,
            "latestPercentage": percentages[-1] if percentages else None,
            "passedCount": sum(1 for attempt in fully_graded if attempt["grading"].get("passed") is True),
            "questionsPendingGrading": pending_questions,
        },
        "scoreTrend": {
            "direction": direction,
            "changePercentagePoints": change,
            "points": [
                {
                    "attemptId": attempt.get("attemptId"),
                    "quizId": attempt.get("quizId"),
                    "quizTitle": attempt.get("quizTitle"),
                    "submittedAt": attempt.get("submittedAt"),
                    "score": attempt["grading"]["score"],
                    "maxScore": attempt["grading"]["maxScore"],
                    "percentage": attempt["grading"]["percentage"],
                    "passed": attempt["grading"].get("passed"),
                    "gradingStatus": attempt["grading"]["gradingStatus"],
                }
                for attempt in completed
            ],
        },
        "topics": topics,
        "strengths": sorted(
            ({"subject": t["subject"], "topic": t["topic"], "percentage": t["percentage"]}
             for t in topics if t["classification"] == "strength"),
            key=lambda t: -t["percentage"],
        ),
        "weaknesses": sorted(
            ({"subject": t["subject"], "topic": t["topic"], "percentage": t["percentage"]}
             for t in topics if t["classification"] == "weakness"),
            key=lambda t: t["percentage"],
        ),
    }


# ---------------------------------------------------------------------------
# CSQP-F-041: class-level analytics for one quiz
# ---------------------------------------------------------------------------

def _distribution(percentages):
    buckets = []
    for start in range(0, 100, DISTRIBUTION_BUCKET_SIZE):
        end = start + DISTRIBUTION_BUCKET_SIZE
        buckets.append({"label": f"{start}-{end}", "from": start, "to": end, "count": 0})

    last = len(buckets) - 1
    for percentage in percentages:
        index = min(int(percentage // DISTRIBUTION_BUCKET_SIZE), last)
        buckets[max(index, 0)]["count"] += 1
    return buckets


def _question_stats(quiz_questions, attempts):
    results_by_question = defaultdict(list)
    for attempt in attempts:
        for result in attempt["grading"].get("results", []):
            results_by_question[result["questionId"]].append(result)

    stats = []
    for question in quiz_questions:
        results = results_by_question.get(question["questionId"], [])
        graded = [result for result in results if result.get("marksAwarded") is not None]
        full_marks = sum(1 for result in graded if result["marksAwarded"] >= result["maxMarks"])

        stats.append({
            "questionId": question["questionId"],
            "text": question.get("text"),
            "type": question.get("type"),
            "subject": question.get("subject"),
            "topic": question.get("topic"),
            "marks": question.get("marks"),
            "studentsGraded": len(graded),
            "answeredCount": sum(1 for result in graded if result.get("answered")),
            "fullMarksCount": full_marks,
            "successRate": _percent(full_marks, len(graded)),
            "averageMarksAwarded": _mean([result["marksAwarded"] for result in graded]),
            "pendingGradingCount": len(results) - len(graded),
        })
    return stats


def class_report(quiz, attempts):
    """Class-level analytics for one quiz across all students who completed it."""
    completed = [attempt for attempt in attempts if is_completed(attempt)]
    fully_graded = [attempt for attempt in completed if is_fully_graded(attempt)]

    scores = [attempt["grading"]["score"] for attempt in fully_graded]
    percentages = [attempt["grading"]["percentage"] for attempt in fully_graded]
    passed = sum(1 for attempt in fully_graded if attempt["grading"].get("passed") is True)

    return {
        "quiz": {
            "quizId": quiz.get("quizId"),
            "title": quiz.get("title"),
            "passingScore": quiz.get("passingScore"),
            "totalMarks": quiz.get("totalMarks"),
        },
        "summary": {
            "attemptsCompleted": len(completed),
            "fullyGradedAttempts": len(fully_graded),
            "pendingManualAttempts": len(completed) - len(fully_graded),
            "averageScore": _mean(scores),
            "averagePercentage": _mean(percentages),
            "medianPercentage": round2(median(percentages)) if percentages else None,
            "highestPercentage": max(percentages) if percentages else None,
            "lowestPercentage": min(percentages) if percentages else None,
            "passedCount": passed,
            "passRate": _percent(passed, len(fully_graded)),
        },
        "scoreDistribution": _distribution(percentages),
        "questions": _question_stats(quiz.get("questions", []), completed),
    }