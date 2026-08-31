# Deploying one Silkroad client

One VPS per client (brief §7: ~4 vCPU / 8 GB, Hetzner class). Nothing is shared between clients.

1. Provision the VPS (Ubuntu, Docker + compose plugin), open 443 → 3080 behind your reverse proxy.
2. `git clone <this repo> /opt/silkroad && cd /opt/silkroad`.
3. `npm run client:new -- --name "Acme Corp" --short acme --email owner@acme.com --apply` — writes `librechat.yaml` for the client, creates `brain-acme/`, prints the `.env` lines.
4. Copy `.env.example` → `.env` (leave `MONGO_URI` out — compose pins it); add `OPENAI_API_KEY`, `JWT_SECRET`/`CREDS_*`, the printed `SILKROAD_*` lines, and the Gmail OAuth values (`npm run gmail:auth` once, locally or on the box).
5. Point `BRAIN_VAULT_PATH` at the new vault (or symlink `brain` → `brain-acme`).
6. `cd deploy && docker compose -f docker-compose.silkroad.yml up -d --build` — API, brain worker, Gmail connector, Mongo.
7. Create the owner user (`npm run create-user` inside the api container) with the same email as `SILKROAD_USER_EMAIL`; run `npm run migrate:agent-permissions` once.
8. iMessage: on the client's Mac (or your relay Mac mini), clone the repo, copy the same `SILKROAD_SERVICE_TOKEN`, set `SILKROAD_API_URL=https://<vps-host>`, and run `npm run channel:imessage` (Full Disk Access + Messages signed in). Without Docker, `npx pm2 start config/ecosystem.config.js` supervises all processes on any host.
9. Health: `GET /api/health/silkroad` lists worker/connector liveness; the dashboard's Activity list and budget tile show the rest.
10. Backups: `config/backup-mongo.sh` nightly via cron (14-day retention); restore with `mongorestore --drop`.
