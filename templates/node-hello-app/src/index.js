const fs = require("node:fs");
const path = require("node:path");

const greeting = process.env.APP_GREETING || "Hello";
const tickInterval = Number(process.env.TICK_INTERVAL_MS || 3000);
const runtimeDir = path.join(process.cwd(), "runtime");
const heartbeatPath = path.join(runtimeDir, "heartbeat.json");

fs.mkdirSync(runtimeDir, { recursive: true });

function writeHeartbeat() {
  const payload = {
    app: "hello-app",
    pid: process.pid,
    greeting,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(heartbeatPath, JSON.stringify(payload, null, 2), "utf8");
}

console.log(`[hello-app] started, pid=${process.pid}, interval=${tickInterval}ms`);
writeHeartbeat();

const timer = setInterval(() => {
  writeHeartbeat();
  console.log(`[hello-app] tick ${new Date().toISOString()}`);
}, tickInterval);

function shutdown(signal) {
  console.log(`[hello-app] received ${signal}, shutting down`);
  clearInterval(timer);
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
