const express = require("express");
const cors = require("cors");
const authRoutes = require("./modules/auth/auth.routes");
const questionBankRoutes = require("./modules/questionBank/questionBank.routes");

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

app.use((error, req, res, next) => {
  console.error("Unhandled server error:", error.message);
  res.status(500).json({
    status: "error",
    message: "An internal server error occurred"
  });
});

module.exports = app;
