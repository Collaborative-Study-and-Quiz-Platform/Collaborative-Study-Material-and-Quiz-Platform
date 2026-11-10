const fs = require("fs");
const http = require("http");
const https = require("https");
const mongoose = require("mongoose");
require("dotenv").config();
const app = require("./app");
const PORT = Number(process.env.PORT || 5000);

function createHttpServer() {
  const keyFile = process.env.HTTPS_KEY_FILE;
  const certificateFile = process.env.HTTPS_CERT_FILE;

  if (Boolean(keyFile) !== Boolean(certificateFile)) {
    throw new Error("HTTPS_KEY_FILE and HTTPS_CERT_FILE must be configured together");
  }

  let server;
  if (keyFile && certificateFile) {
    server = https.createServer({
      key: fs.readFileSync(keyFile),
      cert: fs.readFileSync(certificateFile),
      minVersion: "TLSv1.2"
    }, app);
  } else if (process.env.NODE_ENV === "production"
    && !process.env.TRUST_PROXY_HOPS) {
    throw new Error(
      "Production requires HTTPS certificate files or a trusted TLS-terminating proxy (TRUST_PROXY_HOPS)"
    );
  } else {
    server = http.createServer(app);
  }

  server.requestTimeout = 120000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  return server;
}

async function startServer() {
  if (!Number.isInteger(PORT) || PORT < 1 || PORT > 65535) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }
  if (!process.env.MONGODB_URI) {
    throw new Error("MONGODB_URI is missing from the .env file");
  }
  if (!process.env.JWT_SECRET) {
    throw new Error("JWT_SECRET is missing from the .env file");
  }
  if (process.env.NODE_ENV === "production"
    && Buffer.byteLength(process.env.JWT_SECRET, "utf8") < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes in production");
  }

  try {
    const mongoOptions = process.env.NODE_ENV === "production" ? { tls: true } : {};
    await mongoose.connect(process.env.MONGODB_URI, mongoOptions);
    console.log("MongoDB connected successfully");

    const server = createHttpServer();
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(PORT, () => {
        server.removeListener("error", reject);
        resolve();
      });
    });
    console.log(`Server listening on port ${PORT}`);
    return server;
  } catch (error) {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
    throw error;
  }
}

if (require.main === module) {
  startServer()
    .then((server) => {
      let shuttingDown = false;
      const shutdown = (signal) => {
        if (shuttingDown) return;
        shuttingDown = true;
        console.log(`${signal} received; closing server`);
        server.close((error) => {
          if (error) {
            console.error("HTTP server shutdown failed:", error.message);
            process.exitCode = 1;
          }
          mongoose.disconnect()
            .then(() => {
              if (error) process.exitCode = 1;
            })
            .catch((disconnectError) => {
              console.error("MongoDB shutdown failed:", disconnectError.message);
              process.exitCode = 1;
            });
        });
      };
      process.once("SIGINT", () => shutdown("SIGINT"));
      process.once("SIGTERM", () => shutdown("SIGTERM"));
    })
    .catch((error) => {
      console.error("Server startup failed:", error.message);
      process.exitCode = 1;
    });
}

module.exports = { createHttpServer, startServer };
