"""Install only the reviewed bridge extension; never read or change session credentials."""
import hashlib
import shutil
from pathlib import Path
import sys

root = Path.home() / 'Library/HermesPilot/agent/scripts/whatsapp-bridge'
bridge = root / 'bridge.js'
expected = 'ff9e39f84b46705ebb845b7fd90f2b8893f78d71c45c0f5fc71df5e7e39b8bb1'
source = bridge.read_bytes()
if hashlib.sha256(source).hexdigest() != expected:
    raise SystemExit('Bridge changed; review the current source before installing.')
text = source.decode()
changes = [
 ("import { createOutboundIdTracker } from './outbound_ids.js';", "import { createOutboundIdTracker } from './outbound_ids.js';\nimport { installWaypointCodeRoutes, isWaypointCodeEcho } from './operations-waypoint-bridge.mjs';"),
 ('      if (!msg.message) continue;', '      if (!msg.message) continue;\n      if (isWaypointCodeEcho(msg)) continue;'),
 ('// Send a message\n', "installWaypointCodeRoutes(app, () => ({socket:sock,connected:connectionState==='connected'}), trackSentMessageId);\n\n// Send a message\n"),
]
for old,new in changes:
    if text.count(old) != 1:
        raise SystemExit('Unexpected bridge structure; not installed.')
    text=text.replace(old,new)
if sys.argv[1:] != ['--apply']:
    print('Preflight passed; no changes. Use --apply after review.')
    raise SystemExit(0)
backup = root / ('bridge.before-waypoint-' + expected[:16] + '.js')
if backup.exists():
    raise SystemExit('Backup already exists; reconcile before installing.')
shutil.copy2(bridge,backup)
shutil.copy2(Path(__file__).with_name('operations-waypoint-bridge.mjs'),root/'operations-waypoint-bridge.mjs')
temporary=root/'bridge.waypoint-new.js'
temporary.write_text(text)
temporary.replace(bridge)
print('Reviewed extension installed; restart the existing Hermes gateway to load it.')
