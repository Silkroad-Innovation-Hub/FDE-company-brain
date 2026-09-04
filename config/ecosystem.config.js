/**
 * pm2 process file for one Silkroad instance — the API, the brain worker, and the
 * channel connectors, each restarted on crash.
 *
 * pm2 is not a project dependency; run it through npx from the repo root:
 *   npx pm2 start config/ecosystem.config.js
 *   npx pm2 logs
 *   npx pm2 delete config/ecosystem.config.js
 *
 * Every script loads ./.env itself (dotenv), so no env is duplicated here.
 * `silkroad-imessage` (chat.db) only makes sense on a Mac with Messages signed in;
 * `silkroad-photon` (the agent's own iMessage number) runs anywhere. On a VPS:
 * `npx pm2 start config/ecosystem.config.js --only silkroad-api,silkroad-worker,silkroad-photon,silkroad-gmail`.
 */
const path = require('path');

const root = path.resolve(__dirname, '..');

const common = {
  cwd: root,
  autorestart: true,
  restart_delay: 5000,
  max_restarts: 20,
  time: true,
  merge_logs: true,
};

const app = (name, script, args) => ({
  ...common,
  name,
  script,
  ...(args ? { args } : {}),
  out_file: path.join(root, 'logs', `${name}.out.log`),
  error_file: path.join(root, 'logs', `${name}.err.log`),
});

module.exports = {
  apps: [
    app('silkroad-api', 'npm', 'run backend'),
    app('silkroad-worker', 'config/brain-worker.js'),
    app('silkroad-imessage', 'config/channel-imessage.js'),
    app('silkroad-photon', 'config/channel-photon.js'),
    app('silkroad-gmail', 'config/channel-gmail.js'),
  ],
};
