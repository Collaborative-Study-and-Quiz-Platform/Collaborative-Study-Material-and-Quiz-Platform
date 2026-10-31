"""Input checks for the analytics endpoints.

Each function returns a dictionary of problems keyed by the path of the bad
field (for example "attempts.0.grading.score"), the same style the Node.js
backend uses. An empty dictionary means the request is valid.
"""

import math
from datetime import datetime

from .calculations import COMPLETED_STATUSES

ATTEMPT_STATUSES = ("in_progress",) + COMPLETED_STATUSES
GRADING_STATUSES = ("complete", "pending_manual")


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _is_text(value):
    return isinstance(value, str) and value.strip() != ""


def _is_time(value):
    if not _is_text(value):
        return False
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def _check_optional_text(value, path, errors):
    if value is not None and not isinstance(value, str):
        errors[path] = "Must be text"


def _check_results(results, prefix, errors):
    if not isinstance(results, list):
        errors[prefix] = "Must be a list"
        return

    for index, result in enumerate(results):
        path = f"{prefix}.{index}"
        if not isinstance(result, dict):
            errors[path] = "Must be an object"
            continue

        if not _is_text(result.get("questionId")):
            errors[f"{path}.questionId"] = "Question ID is required"

        max_marks = result.get("maxMarks")
        if not _is_number(max_marks) or max_marks <= 0:
            errors[f"{path}.maxMarks"] = "Must be a number greater than 0"

        awarded = result.get("marksAwarded")
        if awarded is not None:
            if not _is_number(awarded) or awarded < 0:
                errors[f"{path}.marksAwarded"] = "Must be null or a number of 0 or more"
            elif _is_number(max_marks) and awarded > max_marks:
                errors[f"{path}.marksAwarded"] = "Cannot be more than maxMarks"

        _check_optional_text(result.get("subject"), f"{path}.subject", errors)
        _check_optional_text(result.get("topic"), f"{path}.topic", errors)


def _check_grading(grading, prefix, errors):
    if not isinstance(grading, dict):
        errors[prefix] = "Completed attempts need grading details"
        return

    score = grading.get("score")
    if not _is_number(score) or score < 0:
        errors[f"{prefix}.score"] = "Must be a number of 0 or more"

    max_score = grading.get("maxScore")
    if not _is_number(max_score) or max_score <= 0:
        errors[f"{prefix}.maxScore"] = "Must be a number greater than 0"

    percentage = grading.get("percentage")
    if not _is_number(percentage) or not 0 <= percentage <= 100:
        errors[f"{prefix}.percentage"] = "Must be a number from 0 to 100"

    if grading.get("gradingStatus") not in GRADING_STATUSES:
        errors[f"{prefix}.gradingStatus"] = "Must be complete or pending_manual"

    passed = grading.get("passed")
    if passed is not None and not isinstance(passed, bool):
        errors[f"{prefix}.passed"] = "Must be true, false or null"

    _check_results(grading.get("results"), f"{prefix}.results", errors)


def _check_attempts(attempts, prefix, errors, needs_student):
    if not isinstance(attempts, list):
        errors[prefix] = "Must be a list"
        return

    for index, attempt in enumerate(attempts):
        path = f"{prefix}.{index}"
        if not isinstance(attempt, dict):
            errors[path] = "Must be an object"
            continue

        if not _is_text(attempt.get("attemptId")):
            errors[f"{path}.attemptId"] = "Attempt ID is required"
        if needs_student and not _is_text(attempt.get("studentId")):
            errors[f"{path}.studentId"] = "Student ID is required"

        status = attempt.get("status")
        if status not in ATTEMPT_STATUSES:
            errors[f"{path}.status"] = "Must be in_progress, submitted or auto_submitted"
            continue

        if status in COMPLETED_STATUSES:
            if not _is_time(attempt.get("submittedAt")):
                errors[f"{path}.submittedAt"] = "Must be an ISO date-time"
            _check_grading(attempt.get("grading"), f"{path}.grading", errors)


def validate_individual(payload):
    if not isinstance(payload, dict):
        return {"body": "Request body must be a JSON object"}

    errors = {}
    if not _is_text(payload.get("studentId")):
        errors["studentId"] = "Student ID is required"
    _check_attempts(payload.get("attempts"), "attempts", errors, needs_student=False)
    return errors


def validate_class(payload):
    if not isinstance(payload, dict):
        return {"body": "Request body must be a JSON object"}

    errors = {}
    quiz = payload.get("quiz")
    if not isinstance(quiz, dict):
        errors["quiz"] = "Quiz details are required"
    else:
        if not _is_text(quiz.get("quizId")):
            errors["quiz.quizId"] = "Quiz ID is required"
        passing = quiz.get("passingScore")
        if passing is not None and (not _is_number(passing) or not 0 <= passing <= 100):
            errors["quiz.passingScore"] = "Must be a number from 0 to 100"

        questions = quiz.get("questions")
        if not isinstance(questions, list):
            errors["quiz.questions"] = "Must be a list"
        else:
            for index, question in enumerate(questions):
                path = f"quiz.questions.{index}"
                if not isinstance(question, dict) or not _is_text(question.get("questionId")):
                    errors[f"{path}.questionId"] = "Question ID is required"

    _check_attempts(payload.get("attempts"), "attempts", errors, needs_student=True)
    return errors