const fs = require("fs");
const path = require("path");

const HEALTHCHECK_URL = process.env.HEALTHCHECK_URL
  || "http://127.0.0.1:5000/api/health/ready";
const LOG_FILE = path.resolve(process.env.UPTIME_LOG_FILE || "./logs/uptime.jsonl");
const INTERVAL_MS = Number(process.env.UPTIME_INTERVAL_MS || 60_000);
const OBSERVATION_PERIOD_MS = 14 * 24 * 60 * 60 * 1000;

function readSamples() {
  if (!fs.existsSync(LOG_FILE)) {
    throw new Error(`Uptime log does not exist: ${LOG_FILE}`);
  }
  const lines = fs.readFileSync(LOG_FILE, "utf8").split(/\r?\n/).filter(Boolean);
  return lines.map((line, index) => {
    try {
      return JSON.parse(line);
    } catch (error) {
      throw new Error(`Invalid uptime log entry on line ${index + 1}: ${error.message}`);
    }
  });
}

function printReport() {
  const samples = readSamples();
  if (samples.length === 0) {
    throw new Error("Uptime log contains no observations");
  }
  const first = Date.parse(samples[0].timestamp);
  const last = Date.parse(samples[samples.length - 1].timestamp);
  if (!Number.isFinite(first) || !Number.isFinite(last) || last < first) {
    throw new Error("Uptime log timestamps are invalid");
  }

  const successful = samples.filter((sample) => sample.available === true).length;
  const uptimePercent = successful / samples.length * 100;
  const periodComplete = last - first >= OBSERVATION_PERIOD_MS;
  console.log(JSON.stringify({
    observations: samples.length,
    firstObservation: new Date(first).toISOString(),
    lastObservation: new Date(last).toISOString(),
    uptimePercent: Number(uptimePercent.toFixed(3)),
    targetPercent: 99,
    meetsTarget: periodComplete && uptimePercent >= 99,
    twoWeekObservationComplete: periodComplete
  }, null, 2));
}

async function recordHealthCheck() {
  const startedAt = Date.now();
  const sample = {
    timestamp: new Date(startedAt).toISOString(),
    available: false,
    statusCode: null,
    responseTimeMs: null
  };
  try {
    const response = await fetch(HEALTHCHECK_URL, {
      signal: AbortSignal.timeout(10000)
    });
    sample.statusCode = response.status;
    sample.available = response.ok;
  } catch (error) {
    sample.error = error.message;
  }
  sample.responseTimeMs = Date.now() - startedAt;
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, `${JSON.stringify(sample)}\n`);
  console.log(JSON.stringify(sample));
}

async function monitor() {
  if (!Number.isInteger(INTERVAL_MS) || INTERVAL_MS < 1000) {
    throw new Error("UPTIME_INTERVAL_MS must be an integer of at least 1000");
  }
  await recordHealthCheck();
  const timer = setInterval(() => {
    recordHealthCheck().catch((error) => {
      console.error("Uptime check failed:", error.message);
      process.exitCode = 1;
    });
  }, INTERVAL_MS);
  const stop = () => {
    clearInterval(timer);
    printReport();
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}

if (require.main === module) {
  const operation = process.argv.includes("--report") ? printReport : monitor;
  Promise.resolve(operation()).catch((error) => {
    console.error("Uptime monitor failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { printReport, readSamples, recordHealthCheck };
