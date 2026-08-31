const os = require('os');

const HEARTBEAT_MS = 30_000;

/**
 * Reports liveness of a long-running Silkroad process every 30 s so the
 * dashboard (/api/health/silkroad) can show which processes are up.
 * Failures are logged and never crash the host process.
 */
function startHeartbeat(methods, name, detail, logger) {
  const beat = () =>
    methods
      .beatHeartbeat(name, { host: os.hostname(), pid: process.pid, detail })
      .catch((error) => logger?.warn?.(`[heartbeat] ${name}: ${error?.message ?? error}`));
  void beat();
  const timer = setInterval(beat, HEARTBEAT_MS);
  timer.unref();
  return () => clearInterval(timer);
}

module.exports = { startHeartbeat, HEARTBEAT_MS };
