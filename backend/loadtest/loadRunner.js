"use strict";

const { performance } = require("node:perf_hooks");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) {
    return 0;
  }

  const rank = Math.ceil((p / 100) * sortedValues.length);
  return sortedValues[Math.min(sortedValues.length, Math.max(1, rank)) - 1];
}

// Sends one request and measures how long it takes until the full response arrives.
async function timedRequest(url, options) {
  const startedAt = performance.now();

  try {
    const response = await fetch(url, options);
    await response.arrayBuffer();

    return {
      ms: performance.now() - startedAt,
      ok: response.ok,
      status: response.status
    };
  } catch (error) {
    return {
      ms: performance.now() - startedAt,
      ok: false,
      status: 0,
      error: error.message
    };
  }
}

function summarise(results, elapsedMs) {
  const times = results.map((result) => result.ms).sort((a, b) => a - b);
  const failed = results.filter((result) => !result.ok);

  return {
    requests: results.length,
    failed: failed.length,
    firstFailure: failed.length > 0
      ? failed[0].error || `HTTP ${failed[0].status}`
      : null,
    p50: percentile(times, 50),
    p90: percentile(times, 90),
    p99: percentile(times, 99),
    max: times.length > 0 ? times[times.length - 1] : 0,
    requestsPerSecond: results.length / (elapsedMs / 1000)
  };
}

// "Normal load": many virtual users, each sending a request, waiting for the
// answer, then pausing for thinkTimeMs before the next one.
async function steadyLoad({ users, durationMs, thinkTimeMs, buildRequest }) {
  const results = [];
  const startedAt = performance.now();
  const deadline = startedAt + durationMs;

  async function virtualUser(userIndex) {
    await sleep(Math.random() * thinkTimeMs);

    while (performance.now() < deadline) {
      const { url, options } = buildRequest(userIndex);
      results.push(await timedRequest(url, options));
      await sleep(thinkTimeMs);
    }
  }

  await Promise.all(
    Array.from({ length: users }, (_, index) => virtualUser(index))
  );

  return summarise(results, performance.now() - startedAt);
}

// "Burst": every user sends one request at the same moment.
async function burstLoad({ users, buildRequest }) {
  const startedAt = performance.now();

  const results = await Promise.all(
    Array.from({ length: users }, (_, index) => {
      const { url, options } = buildRequest(index);
      return timedRequest(url, options);
    })
  );

  return summarise(results, performance.now() - startedAt);
}

module.exports = { burstLoad, percentile, steadyLoad, summarise };