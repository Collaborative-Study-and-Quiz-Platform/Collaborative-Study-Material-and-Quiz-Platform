import unittest

from app.calculations import class_report, individual_report, round2
from tests.sample_data import (
    CLASS_ATTEMPTS,
    CLASS_QUIZ,
    INDIVIDUAL_ATTEMPTS,
    attempt,
    result,
)


class RoundingTests(unittest.TestCase):
    def test_halves_round_up(self):
        self.assertEqual(round2(66.665), 66.67)
        self.assertEqual(round2(2 / 3 * 100), 66.67)
        self.assertEqual(round2(0.125), 0.13)

    def test_none_stays_none(self):
        self.assertIsNone(round2(None))


class IndividualReportTests(unittest.TestCase):
    def setUp(self):
        self.report = individual_report("student-1", INDIVIDUAL_ATTEMPTS)

    def test_summary_matches_hand_calculation(self):
        summary = self.report["summary"]
        self.assertEqual(summary["attemptsCompleted"], 3)
        self.assertEqual(summary["fullyGradedAttempts"], 3)
        self.assertEqual(summary["averagePercentage"], 75.0)
        self.assertEqual(summary["bestPercentage"], 90.0)
        self.assertEqual(summary["latestPercentage"], 90.0)
        self.assertEqual(summary["passedCount"], 3)

    def test_trend_is_in_date_order_even_if_input_is_not(self):
        report = individual_report("student-1", list(reversed(INDIVIDUAL_ATTEMPTS)))
        points = report["scoreTrend"]["points"]

        self.assertEqual([p["attemptId"] for p in points], ["a1", "a2", "a3"])
        self.assertEqual([p["percentage"] for p in points], [60.0, 75.0, 90.0])

    def test_trend_direction(self):
        trend = self.report["scoreTrend"]
        self.assertEqual(trend["direction"], "improving")
        self.assertEqual(trend["changePercentagePoints"], 30.0)

    def test_topics_are_grouped_with_correct_percentages(self):
        topics = {t["topic"]: t for t in self.report["topics"]}

        self.assertEqual(topics["TCP"]["percentage"], 100.0)
        self.assertEqual(topics["TCP"]["marksAwarded"], 9)
        self.assertEqual(topics["SQL"]["percentage"], 77.78)
        self.assertEqual(topics["Sorting"]["percentage"], 40.0)
        self.assertEqual(topics["Sorting"]["maxMarks"], 5)

    def test_strengths_and_weaknesses(self):
        self.assertEqual([s["topic"] for s in self.report["strengths"]], ["TCP", "SQL"])
        self.assertEqual([w["topic"] for w in self.report["weaknesses"]], ["Sorting"])

    def test_in_progress_attempts_are_ignored(self):
        in_progress = {"attemptId": "x", "status": "in_progress"}
        report = individual_report("student-1", INDIVIDUAL_ATTEMPTS + [in_progress])

        self.assertEqual(report["summary"]["attemptsCompleted"], 3)

    def test_no_attempts_gives_an_empty_report(self):
        report = individual_report("student-1", [])

        self.assertEqual(report["summary"]["attemptsCompleted"], 0)
        self.assertIsNone(report["summary"]["averagePercentage"])
        self.assertEqual(report["topics"], [])
        self.assertEqual(report["scoreTrend"]["direction"], "insufficient_data")

    def test_one_attempt_is_not_enough_for_a_trend(self):
        report = individual_report("student-1", INDIVIDUAL_ATTEMPTS[:1])

        self.assertEqual(report["scoreTrend"]["direction"], "insufficient_data")
        self.assertIsNone(report["scoreTrend"]["changePercentagePoints"])

    def test_declining_and_steady_trends(self):
        # 90% -> 50% is -40 points (declining); 90% -> 87% is -3 points (steady)
        first = attempt("d1", "2026-04-01T00:00:00Z", [result("a", 100, 90)])
        low = attempt("d2", "2026-04-02T00:00:00Z", [result("a", 100, 50)])
        similar = attempt("d3", "2026-04-02T00:00:00Z", [result("a", 100, 87)])

        self.assertEqual(individual_report("s", [first, low])["scoreTrend"]["direction"], "declining")
        self.assertEqual(individual_report("s", [first, similar])["scoreTrend"]["direction"], "steady")

    def test_pending_manual_attempt_is_listed_but_not_averaged(self):
        pending = attempt("p1", "2026-03-20T10:00:00Z", [result("a", 2, 2, "Networks", "TCP"), result("b", 5, None, "Networks", "Essay")])
        report = individual_report("student-1", INDIVIDUAL_ATTEMPTS + [pending])

        self.assertEqual(report["summary"]["attemptsCompleted"], 4)
        self.assertEqual(report["summary"]["pendingManualAttempts"], 1)
        self.assertEqual(report["summary"]["averagePercentage"], 75.0)
        self.assertEqual(report["summary"]["questionsPendingGrading"], 1)
        self.assertEqual(report["scoreTrend"]["points"][-1]["gradingStatus"], "pending_manual")
        topics = {t["topic"]: t for t in report["topics"]}
        self.assertEqual(topics["TCP"]["marksAwarded"], 11)
        self.assertNotIn("Essay", topics)

    def test_missing_topic_falls_back_to_uncategorised(self):
        report = individual_report("s", [attempt("u1", "2026-03-01T00:00:00Z", [result("a", 4, 3)])])

        self.assertEqual(report["topics"][0]["subject"], "Uncategorised")
        self.assertEqual(report["topics"][0]["topic"], "Uncategorised")
        self.assertEqual(report["topics"][0]["percentage"], 75.0)


class ClassReportTests(unittest.TestCase):
    def setUp(self):
        self.report = class_report(CLASS_QUIZ, CLASS_ATTEMPTS)

    def test_summary_matches_hand_calculation(self):
        summary = self.report["summary"]
        self.assertEqual(summary["attemptsCompleted"], 5)
        self.assertEqual(summary["averageScore"], 5.4)
        self.assertEqual(summary["averagePercentage"], 54.0)
        self.assertEqual(summary["medianPercentage"], 50.0)
        self.assertEqual(summary["highestPercentage"], 100.0)
        self.assertEqual(summary["lowestPercentage"], 20.0)
        self.assertEqual(summary["passedCount"], 2)
        self.assertEqual(summary["passRate"], 40.0)

    def test_score_distribution(self):
        buckets = self.report["scoreDistribution"]
        counts = [bucket["count"] for bucket in buckets]

        self.assertEqual(len(buckets), 10)
        self.assertEqual(counts, [0, 0, 1, 1, 0, 1, 0, 1, 0, 1])
        self.assertEqual(buckets[0]["label"], "0-10")
        self.assertEqual(buckets[9]["label"], "90-100")
        self.assertEqual(sum(counts), 5)

    def test_hundred_percent_lands_in_the_last_bucket(self):
        buckets = self.report["scoreDistribution"]
        self.assertEqual(buckets[9]["count"], 1)

    def test_per_question_success_rate(self):
        questions = {q["questionId"]: q for q in self.report["questions"]}

        self.assertEqual(questions["q1"]["successRate"], 80.0)
        self.assertEqual(questions["q2"]["successRate"], 60.0)
        self.assertEqual(questions["q3"]["successRate"], 40.0)
        self.assertEqual(questions["q1"]["averageMarksAwarded"], 1.6)
        self.assertEqual(questions["q2"]["averageMarksAwarded"], 1.8)
        self.assertEqual(questions["q3"]["averageMarksAwarded"], 2.0)
        self.assertEqual(questions["q3"]["studentsGraded"], 5)

    def test_questions_keep_the_quiz_order(self):
        self.assertEqual([q["questionId"] for q in self.report["questions"]], ["q1", "q2", "q3"])

    def test_no_attempts_gives_an_empty_report(self):
        report = class_report(CLASS_QUIZ, [])

        self.assertEqual(report["summary"]["attemptsCompleted"], 0)
        self.assertIsNone(report["summary"]["averagePercentage"])
        self.assertIsNone(report["summary"]["passRate"])
        self.assertEqual(sum(b["count"] for b in report["scoreDistribution"]), 0)
        self.assertIsNone(report["questions"][0]["successRate"])

    def test_pending_manual_grading_is_kept_out_of_score_statistics(self):
        quiz = {
            "quizId": "quiz-2", "title": "Mixed", "passingScore": 60, "totalMarks": 7,
            "questions": [
                {"questionId": "q1", "type": "mcq", "marks": 2},
                {"questionId": "q2", "type": "short_answer", "marks": 5},
            ],
        }
        graded = attempt("x", "2026-03-01T10:00:00Z", [result("q1", 2, 2), result("q2", 5, 4)], student_id="s-x")
        waiting = attempt("y", "2026-03-01T11:00:00Z", [result("q1", 2, 0), result("q2", 5, None)], student_id="s-y")

        report = class_report(quiz, [graded, waiting])
        summary = report["summary"]
        questions = {q["questionId"]: q for q in report["questions"]}

        self.assertEqual(summary["attemptsCompleted"], 2)
        self.assertEqual(summary["fullyGradedAttempts"], 1)
        self.assertEqual(summary["pendingManualAttempts"], 1)
        self.assertEqual(summary["averagePercentage"], 85.71)
        self.assertEqual(summary["passRate"], 100.0)
        self.assertEqual(questions["q1"]["studentsGraded"], 2)
        self.assertEqual(questions["q1"]["successRate"], 50.0)
        self.assertEqual(questions["q2"]["studentsGraded"], 1)
        self.assertEqual(questions["q2"]["successRate"], 0.0)
        self.assertEqual(questions["q2"]["pendingGradingCount"], 1)

    def test_in_progress_attempts_are_ignored(self):
        in_progress = {"attemptId": "z", "studentId": "s-z", "status": "in_progress"}
        report = class_report(CLASS_QUIZ, CLASS_ATTEMPTS + [in_progress])

        self.assertEqual(report["summary"]["attemptsCompleted"], 5)


if __name__ == "__main__":
    unittest.main()