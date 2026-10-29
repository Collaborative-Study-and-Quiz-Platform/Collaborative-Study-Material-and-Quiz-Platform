"""HTTP interface of the analytics microservice.

Only the Node.js backend calls this service (an internal REST API, see SAD
section 3.4). It is stateless: the backend sends the attempt data and receives
the computed report.
"""

import os

from flask import Flask, jsonify, request
from werkzeug.exceptions import HTTPException

from .calculations import class_report, individual_report
from .validation import validate_class, validate_individual

MAX_REQUEST_BYTES = 10 * 1024 * 1024


def create_app():
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_REQUEST_BYTES
    app.json.sort_keys = False

    def error_response(message, status, errors=None):
        body = {"status": "error", "message": message}
        if errors:
            body["errors"] = errors
        return jsonify(body), status

    def read_body():
        return request.get_json(silent=True, force=True)

    @app.get("/health")
    def health():
        return jsonify({"status": "OK", "service": "analytics-service"})

    @app.post("/analytics/individual")
    def individual():
        payload = read_body()
        errors = validate_individual(payload)
        if errors:
            return error_response("Analytics request is invalid", 400, errors)

        report = individual_report(payload["studentId"].strip(), payload["attempts"])
        return jsonify({"status": "success", "report": report})

    @app.post("/analytics/class")
    def class_level():
        payload = read_body()
        errors = validate_class(payload)
        if errors:
            return error_response("Analytics request is invalid", 400, errors)

        report = class_report(payload["quiz"], payload["attempts"])
        return jsonify({"status": "success", "report": report})

    @app.errorhandler(HTTPException)
    def http_error(error):
        return error_response(error.name, error.code)

    @app.errorhandler(Exception)
    def unexpected_error(error):
        app.logger.exception("Unhandled analytics error")
        return error_response("An internal server error occurred", 500)

    return app


app = create_app()

if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("ANALYTICS_PORT", "8000")))