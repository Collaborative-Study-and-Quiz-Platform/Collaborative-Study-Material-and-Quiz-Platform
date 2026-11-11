// Seeded sample data for the analytics dashboard (CSQP-F-042).
// Same shape as the reports returned by the analytics service (POST /analytics/individual
// and POST /analytics/class). Generated from a fixed random seed, so it never changes.

export const SEED_INDIVIDUAL_REPORT = {
  studentId: 'seed-student',
  summary: {
    attemptsCompleted: 6,
    fullyGradedAttempts: 6,
    pendingManualAttempts: 0,
    averagePercentage: 62.5,
    bestPercentage: 83.33,
    latestPercentage: 83.33,
    passedCount: 2,
    questionsPendingGrading: 0,
  },
  scoreTrend: {
    direction: 'improving',
    changePercentagePoints: 33.33,
    points: [
      { attemptId: 'a1', quizId: 'quiz-1', quizTitle: 'Networks Basics', submittedAt: '2026-09-08T10:00:00Z', score: 12, maxScore: 24, percentage: 50.0, passed: false, gradingStatus: 'complete' },
      { attemptId: 'a2', quizId: 'quiz-2', quizTitle: 'SQL Fundamentals', submittedAt: '2026-09-15T10:00:00Z', score: 12, maxScore: 24, percentage: 50.0, passed: false, gradingStatus: 'complete' },
      { attemptId: 'a3', quizId: 'quiz-3', quizTitle: 'Sorting Algorithms', submittedAt: '2026-09-22T10:00:00Z', score: 18, maxScore: 24, percentage: 75.0, passed: true, gradingStatus: 'complete' },
      { attemptId: 'a4', quizId: 'quiz-4', quizTitle: 'Routing and Switching', submittedAt: '2026-09-29T10:00:00Z', score: 14, maxScore: 24, percentage: 58.33, passed: false, gradingStatus: 'complete' },
      { attemptId: 'a5', quizId: 'quiz-5', quizTitle: 'Database Design', submittedAt: '2026-10-06T10:00:00Z', score: 14, maxScore: 24, percentage: 58.33, passed: false, gradingStatus: 'complete' },
      { attemptId: 'a6', quizId: 'quiz-6', quizTitle: 'Graphs and Trees', submittedAt: '2026-10-13T10:00:00Z', score: 20, maxScore: 24, percentage: 83.33, passed: true, gradingStatus: 'complete' },
    ],
  },
  topics: [
    { subject: 'Algorithms', topic: 'Graphs', questionsGraded: 12, marksAwarded: 14, maxMarks: 24, percentage: 58.33, classification: 'developing' },
    { subject: 'Algorithms', topic: 'Sorting', questionsGraded: 12, marksAwarded: 12, maxMarks: 24, percentage: 50.0, classification: 'developing' },
    { subject: 'Databases', topic: 'Normalisation', questionsGraded: 12, marksAwarded: 10, maxMarks: 24, percentage: 41.67, classification: 'weakness' },
    { subject: 'Databases', topic: 'SQL', questionsGraded: 12, marksAwarded: 20, maxMarks: 24, percentage: 83.33, classification: 'strength' },
    { subject: 'Networks', topic: 'Routing', questionsGraded: 12, marksAwarded: 14, maxMarks: 24, percentage: 58.33, classification: 'developing' },
    { subject: 'Networks', topic: 'TCP/IP', questionsGraded: 12, marksAwarded: 20, maxMarks: 24, percentage: 83.33, classification: 'strength' },
  ],
  strengths: [
    { subject: 'Databases', topic: 'SQL', percentage: 83.33 },
    { subject: 'Networks', topic: 'TCP/IP', percentage: 83.33 },
  ],
  weaknesses: [
    { subject: 'Databases', topic: 'Normalisation', percentage: 41.67 },
  ],
}

export const SEED_CLASS_REPORT = {
  quiz: {
    quizId: 'quiz-networks-1',
    title: 'Computer Networks - Mid-term Quiz',
    passingScore: 60,
    totalMarks: 18,
  },
  summary: {
    attemptsCompleted: 24,
    fullyGradedAttempts: 24,
    pendingManualAttempts: 0,
    averageScore: 9.29,
    averagePercentage: 51.62,
    medianPercentage: 44.44,
    highestPercentage: 88.89,
    lowestPercentage: 16.67,
    passedCount: 10,
    passRate: 41.67,
  },
  scoreDistribution: [
    { label: '0-10', from: 0, to: 10, count: 0 },
    { label: '10-20', from: 10, to: 20, count: 1 },
    { label: '20-30', from: 20, to: 30, count: 2 },
    { label: '30-40', from: 30, to: 40, count: 7 },
    { label: '40-50', from: 40, to: 50, count: 3 },
    { label: '50-60', from: 50, to: 60, count: 1 },
    { label: '60-70', from: 60, to: 70, count: 4 },
    { label: '70-80', from: 70, to: 80, count: 4 },
    { label: '80-90', from: 80, to: 90, count: 2 },
    { label: '90-100', from: 90, to: 100, count: 0 },
  ],
  questions: [
    { questionId: 'c1', text: 'Which layer routes packets between networks?', type: 'mcq', subject: 'Networks', topic: 'IP', marks: 2, studentsGraded: 24, answeredCount: 24, fullMarksCount: 22, successRate: 91.67, averageMarksAwarded: 1.83, pendingGradingCount: 0 },
    { questionId: 'c2', text: 'TCP guarantees ordered delivery.', type: 'true_false', subject: 'Networks', topic: 'TCP', marks: 1, studentsGraded: 24, answeredCount: 24, fullMarksCount: 22, successRate: 91.67, averageMarksAwarded: 0.92, pendingGradingCount: 0 },
    { questionId: 'c3', text: 'Which port does HTTPS use by default?', type: 'mcq', subject: 'Networks', topic: 'Application Layer', marks: 2, studentsGraded: 24, answeredCount: 24, fullMarksCount: 20, successRate: 83.33, averageMarksAwarded: 1.67, pendingGradingCount: 0 },
    { questionId: 'c4', text: 'UDP retransmits lost datagrams.', type: 'true_false', subject: 'Networks', topic: 'UDP', marks: 1, studentsGraded: 24, answeredCount: 24, fullMarksCount: 18, successRate: 75.0, averageMarksAwarded: 0.75, pendingGradingCount: 0 },
    { questionId: 'c5', text: 'What does ARP resolve?', type: 'mcq', subject: 'Networks', topic: 'Link Layer', marks: 2, studentsGraded: 24, answeredCount: 24, fullMarksCount: 16, successRate: 66.67, averageMarksAwarded: 1.33, pendingGradingCount: 0 },
    { questionId: 'c6', text: 'Which algorithm finds shortest paths with negative edges?', type: 'mcq', subject: 'Algorithms', topic: 'Graphs', marks: 3, studentsGraded: 24, answeredCount: 24, fullMarksCount: 10, successRate: 41.67, averageMarksAwarded: 1.25, pendingGradingCount: 0 },
    { questionId: 'c7', text: 'Subnet mask for 192.168.1.0/26?', type: 'mcq', subject: 'Networks', topic: 'Subnetting', marks: 3, studentsGraded: 24, answeredCount: 24, fullMarksCount: 7, successRate: 29.17, averageMarksAwarded: 0.88, pendingGradingCount: 0 },
    { questionId: 'c8', text: 'Which TCP phase doubles the congestion window every round trip?', type: 'mcq', subject: 'Networks', topic: 'TCP', marks: 4, studentsGraded: 24, answeredCount: 24, fullMarksCount: 4, successRate: 16.67, averageMarksAwarded: 0.67, pendingGradingCount: 0 },
  ],
}