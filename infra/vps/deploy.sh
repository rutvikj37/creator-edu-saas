#!/usr/bin/env bash
# Deploys the committed HEAD to the TechX LMS VPS. Run from the repo root on a machine whose SSH key
# the server accepts:  infra/vps/deploy.sh   (override the target with LMS_SSH=user@host)
# Uploads `git archive HEAD` as a new release, builds it with Node 24, runs migrations, switches
# /opt/lms/current and reloads the API and worker. The last 3 releases are kept for rollback:
#   ssh root@<host> 'ln -sfn /opt/lms/releases/<old> /opt/lms/current && pm2 reload /opt/lms/ecosystem.config.cjs'
set -euo pipefail
HOST=${LMS_SSH:-root@189.72.153.211}
cd "$(git rev-parse --show-toplevel)"
[ -z "$(git status --porcelain)" ] || { echo "Commit your changes first (deploy uses the committed HEAD)."; exit 1; }
REL=$(git rev-parse --short HEAD)
echo "→ uploading $REL to $HOST"
git archive --format=tar HEAD | ssh "$HOST" "mkdir -p /opt/lms/releases/$REL && tar -x -C /opt/lms/releases/$REL"
ssh "$HOST" "REL=$REL bash -s" <<'REMOTE'
set -euo pipefail
export PATH=/opt/node24/bin:$PATH COREPACK_ENABLE_DOWNLOAD_PROMPT=0
R=/opt/lms/releases/$REL
cd "$R" && ln -sfn /opt/lms/shared/.env .env
pnpm install --frozen-lockfile --reporter=silent
(cd apps/api && pnpm exec prisma generate >/dev/null && pnpm build >/dev/null && pnpm exec prisma migrate deploy && pnpm db:sync-pricing)
(cd apps/web && pnpm build >/dev/null)
ln -sfn "$R" /opt/lms/current
pm2 reload /opt/lms/ecosystem.config.cjs --update-env >/dev/null && pm2 save >/dev/null
sleep 5
curl -fsS -H 'Host: lms.techxsolutions.io' http://127.0.0.1:4100/api/v1/health >/dev/null && echo "✓ $REL is live"
ls -1dt /opt/lms/releases/* | tail -n +4 | xargs -r rm -rf
REMOTE
