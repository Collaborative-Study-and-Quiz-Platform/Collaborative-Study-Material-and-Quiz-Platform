"""Small datasets whose results were worked out by hand (see the comments)."""


def result(question_id, max_marks, awarded, subject=None, topic=None):
    return {
        "questionId": question_id,
        "subject": subject,
        "topic": topic,
        "answered": True,
        "isCorrect": None if awarded is None else awarded >= max_marks,
        "marksAwarded": awarded,
        "maxMarks": max_marks,
    }


def attempt(attempt_id, submitted_at, results, student_id=None, quiz_id="quiz-1",
            title="Quiz", passing_score=60, status="submitted"):
    graded = [r for r in results if r["marksAwarded"] is not None]
    score = sum(r["marksAwarded"] for r in graded)
    max_score = sum(r["maxMarks"] for r in results)
    pending = len(graded) < len(results)
    percentage = round(score / max_score * 100, 2)

    data = {
        "attemptId": attempt_id,
        "quizId": quiz_id,
        "quizTitle": title,
        "status": status,
        "submittedAt": submitted_at,
        "grading": {
            "results": results,
            "score": score,
            "maxScore": max_score,
            "percentage": percentage,
            "gradingStatus": "pending_manual" if pending else "complete",
            "passed": None if pending else percentage >= passing_score,
        },
    }
    if student_id is not None:
        data["studentId"] = student_id
    return data


# --- Individual report: one student, three quizzes ---------------------------
# Quiz 1 (1 Mar):  TCP 2/2, SQL 1/2, Sorting 0/1  -> 3/5  = 60%
# Quiz 2 (8 Mar):  TCP 3/3, SQL 2/3, Sorting 1/2  -> 6/8  = 75%
# Quiz 3 (15 Mar): TCP 4/4, SQL 4/4, Sorting 1/2  -> 9/10 = 90%
# Topic totals: TCP 9/9 = 100%, SQL 7/9 = 77.78%, Sorting 2/5 = 40%
# Average of the three percentages = 75, trend 60 -> 90 = +30 points.
def _individual_attempts():
    def three(tcp, sql, sorting):
        return [
            result("a", tcp[1], tcp[0], "Networks", "TCP"),
            result("b", sql[1], sql[0], "Databases", "SQL"),
            result("c", sorting[1], sorting[0], "Algorithms", "Sorting"),
        ]

    return [
        attempt("a1", "2026-03-01T10:00:00Z", three((2, 2), (1, 2), (0, 1)), quiz_id="q1", title="Quiz 1"),
        attempt("a2", "2026-03-08T10:00:00Z", three((3, 3), (2, 3), (1, 2)), quiz_id="q2", title="Quiz 2"),
        attempt("a3", "2026-03-15T10:00:00Z", three((4, 4), (4, 4), (1, 2)), quiz_id="q3", title="Quiz 3"),
    ]


INDIVIDUAL_ATTEMPTS = _individual_attempts()


# --- Class report: five students, one quiz (Q1 = 2 marks, Q2 = 3, Q3 = 5) ----
# A: 2+3+5 = 10 (100%)   B: 2+0+5 = 7 (70%)   C: 0+3+0 = 3 (30%)
# D: 2+0+0 = 2 (20%)     E: 2+3+0 = 5 (50%)
# Scores sum to 27 -> average 5.4 marks; percentages average 54, median 50.
# Passing score 60 -> A and B pass -> pass rate 2/5 = 40%.
# Success rate per question: Q1 4/5 = 80%, Q2 3/5 = 60%, Q3 2/5 = 40%.
CLASS_QUIZ = {
    "quizId": "quiz-1",
    "title": "Networks Quiz 1",
    "passingScore": 60,
    "totalMarks": 10,
    "questions": [
        {"questionId": "q1", "text": "Q1", "type": "mcq", "marks": 2, "subject": "Networks", "topic": "TCP"},
        {"questionId": "q2", "text": "Q2", "type": "true_false", "marks": 3, "subject": "Networks", "topic": "UDP"},
        {"questionId": "q3", "text": "Q3", "type": "mcq", "marks": 5, "subject": "Networks", "topic": "IP"},
    ],
}


def _class_attempts():
    marks = {"A": (2, 3, 5), "B": (2, 0, 5), "C": (0, 3, 0), "D": (2, 0, 0), "E": (2, 3, 0)}
    attempts = []
    for student, (m1, m2, m3) in marks.items():
        attempts.append(attempt(
            f"attempt-{student}", "2026-03-01T10:00:00Z",
            [result("q1", 2, m1), result("q2", 3, m2), result("q3", 5, m3)],
            student_id=f"student-{student}",
        ))
    return attempts


CLASS_ATTEMPTS = _class_attempts()