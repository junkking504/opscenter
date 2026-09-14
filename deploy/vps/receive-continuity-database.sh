#!/usr/bin/env bash
set -euo pipefail
# Serialize only standby restores. This never targets the Mac or the retained old DB.
exec 9>/home/opscenter/.continuity-database.lock
flock -n 9 || exit 75
docker run --rm --network none -v /etc/opscenter/continuity-app.env:/config/app.env:ro node:22-bookworm-slim node -e '
const fs=require("fs");const line=fs.readFileSync("/config/app.env","utf8").split("\n").find(l=>l.startsWith("OPSCENTER_VPS_DATABASE_URL="));
const u=new URL(line.slice(line.indexOf("=")+1));
if(u.hostname!=="database" || u.username!=="opscenter_standby_reader" || u.pathname!=="/opscenter_recovery_20260914") process.exit(78);
'
docker exec -i opscenter-continuity-database-1 psql -X -v ON_ERROR_STOP=1 -U opscenter_admin -d opscenter_recovery_20260914

docker run --rm --network none -v /srv/opscenter/continuity-20260912:/candidate node:22-bookworm-slim node -e '
const fs=require("fs");fs.mkdirSync("/candidate/status",{recursive:true});const p="/candidate/status/database-sync.json";
fs.writeFileSync(p+".tmp",JSON.stringify({status:"success",snapshotAt:new Date().toISOString(),database:"opscenter_recovery_20260914",mode:"read-only-standby"}),{mode:0o644});fs.renameSync(p+".tmp",p);
'
