const express = require("express");
const cors = require("cors");
const authRoutes = require("./modules/auth/auth.routes");
const questionBankRoutes = require("./modules/questionBank/questionBank.routes");
const materialRoutes = require("./modules/material/material.routes");
const quizRoutes = require("./modules/quiz/quiz.routes");
const attemptRoutes = require("./modules/attempt/attempt.routes");
const availableQuizRoutes = require("./modules/quiz/availableQuiz.routes");

const app = express();

app.use(cors());
app.use(express.json());

app.get("/api/health", (req, res) => {
  res.json({
    status: "OK",
    message: "Backend is running"
  });
});

app.use("/api/auth", authRoutes);
app.use("/api/questions", questionBankRoutes);
app.use("/api/materials", materialRoutes);
// Registered before quizRoutes so students can reach their quiz routes
app.use("/api/quizzes/available", availableQuizRoutes);
app.use("/api/quizzes/:quizId/attempt", attemptRoutes);
app.use("/api/quizzes", quizRoutes);

app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error);
  res.status(500).json({
    status: "error",
    message: "An internal server error occurred"
  });
});

module.exports = app;