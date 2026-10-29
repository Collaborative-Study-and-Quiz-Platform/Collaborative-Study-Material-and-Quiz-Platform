import copy
import unittest

from app.server import create_app
from tests.sample_data import CLASS_ATTEMPTS, CLASS_QUIZ, INDIVIDUAL_ATTEMPTS


class AnalyticsApiTests(unittest.TestCase):
    def setUp(self):
        self.client = create_app().test_client()

    def test_health_check(self):
        response = self.client.get("/health")

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()["status"], "OK")

    def test_individual_report_success(self):
        response = self.client.post("/analytics/individual", json={
            "studentId": "student-1",
            "attempts": INDIVIDUAL_ATTEMPTS,
        })
        body = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["status"], "success")
        self.assertEqual(body["report"]["studentId"], "student-1")
        self.assertEqual(body["report"]["summary"]["averagePercentage"], 75.0)
        self.assertEqual(body["report"]["weaknesses"][0]["topic"], "Sorting")

    def test_class_report_success(self):
        response = self.client.post("/analytics/class", json={
            "quiz": CLASS_QUIZ,
            "attempts": CLASS_ATTEMPTS,
        })
        body = response.get_json()

        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["report"]["summary"]["averageScore"], 5.4)
        self.assertEqual(body["report"]["summary"]["passRate"], 40.0)
        self.assertEqual(body["report"]["questions"][0]["successRate"], 80.0)

    def test_individual_rejects_missing_fields(self):
        response = self.client.post("/analytics/individual", json={})
        body = response.get_json()

        self.assertEqual(response.status_code, 400)
        self.assertEqual(body["status"], "error")
        self.assertEqual(body["errors"]["studentId"], "Student ID is required")
        self.assertEqual(body["errors"]["attempts"], "Must be a list")

    def test_individual_reports_the_exact_bad_field(self):
        attempts = copy.deepcopy(INDIVIDUAL_ATTEMPTS)
        attempts[1]["grading"]["score"] = "lots"
        attempts[2]["submittedAt"] = "yesterday"

        response = self.client.post("/analytics/individual", json={"studentId": "s", "attempts": attempts})
        errors = response.get_json()["errors"]

        self.assertEqual(response.status_code, 400)
        self.assertIn("attempts.1.grading.score", errors)
        self.assertIn("attempts.2.submittedAt", errors)

    def test_marks_awarded_cannot_exceed_maximum(self):
        attempts = copy.deepcopy(INDIVIDUAL_ATTEMPTS)
        attempts[0]["grading"]["results"][0]["marksAwarded"] = 99

        response = self.client.post("/analytics/individual", json={"studentId": "s", "attempts": attempts})

        self.assertEqual(response.status_code, 400)
        self.assertIn("attempts.0.grading.results.0.marksAwarded", response.get_json()["errors"])

    def test_class_rejects_missing_quiz_and_student_ids(self):
        attempts = copy.deepcopy(CLASS_ATTEMPTS)
        del attempts[0]["studentId"]

        response = self.client.post("/analytics/class", json={"attempts": attempts})
        errors = response.get_json()["errors"]

        self.assertEqual(response.status_code, 400)
        self.assertEqual(errors["quiz"], "Quiz details are required")
        self.assertIn("attempts.0.studentId", errors)

    def test_invalid_json_body_is_rejected(self):
        response = self.client.post("/analytics/class", data="not json", content_type="application/json")

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.get_json()["errors"]["body"], "Request body must be a JSON object")

    def test_unknown_route_and_wrong_method_return_json_errors(self):
        missing = self.client.get("/nope")
        wrong_method = self.client.get("/analytics/class")

        self.assertEqual(missing.status_code, 404)
        self.assertEqual(missing.get_json()["status"], "error")
        self.assertEqual(wrong_method.status_code, 405)
        self.assertEqual(wrong_method.get_json()["status"], "error")


if __name__ == "__main__":
    unittest.main()