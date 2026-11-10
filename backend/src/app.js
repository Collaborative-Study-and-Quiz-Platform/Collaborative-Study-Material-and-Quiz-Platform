const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");
const authRoutes = require("./modules/auth/auth.routes");
const questionBankRoutes = require("./modules/questionBank/questionBank.routes");
const materialRoutes = require("./modules/material/material.routes");
const quizRoutes = require("./modules/quiz/quiz.routes");
const attemptRoutes = require("./modules/attempt/attempt.routes");
const availableQuizRoutes = require("./modules/quiz/availableQuiz.routes");
const manualGradingRoutes = require("./modules/grading/manualGrading.routes");
const notificationRoutes = require("./modules/notification/notification.routes");
const requireSecureTransport = require("./middleware/requireSecureTransport");
const { sanitizeJsonBody } = require("./middleware/sanitizeJsonBody");

const app = express();

if (process.env.TRUST_PROXY_HOPS) {
  if (!/^[1-9]\d*$/.test(process.env.TRUST_PROXY_HOPS)) {
    throw new Error("TRUST_PROXY_HOPS must be a positive integer");
  }
  app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS));
}

app.use(requireSecureTransport);
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(sanitizeJsonBody);

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    message: "Backend is running"
  });
});

app.get("/api/health/live", (req, res) => {
  return res.status(200).json({ status: "alive" });
});

app.get(["/api/ready", "/api/health/ready"], (req, res) => {
  const ready = mongoose.connection.readyState === 1;
  return res.status(ready ? 200 : 503).json({
    status: ready ? "ready" : "not_ready"
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/questions", questionBankRoutes);
app.use("/api/materials", materialRoutes);
// Registered before quizRoutes so students can reach their quiz routes
app.use("/api/quizzes/available", availableQuizRoutes);
app.use("/api/quizzes/:quizId/attempt", attemptRoutes);
app.use("/api/quizzes/:quizId/submissions", manualGradingRoutes);
app.use("/api/quizzes", quizRoutes);

app.use((error, req, res, next) => {
  if (error && error.type === "entity.parse.failed") {
    return res.status(400).json({
      status: "error",
      message: "Request body contains invalid JSON"
    });
  }
  if (error && error.type === "entity.too.large") {
    return res.status(413).json({
      status: "error",
      message: "Request body exceeds the 1 MiB limit"
    });
  }
  console.error("Unhandled server error:", error);
  res.status(500).json({
    status: "error",
    message: "An internal server error occurred"
  });
});

module.exports = app;