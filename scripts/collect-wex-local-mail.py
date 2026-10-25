#!/usr/bin/env python3
"""WEX-only native-cache intake. Called by an existing event worker; no timer/network/AI."""
import argparse
import datetime as dt
import email
import email.policy
import email.utils
import hashlib
import html.parser
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile

SENDER = 'onlineservices@wexinc.com'
FIELDS = ['Tracking Number', 'Reason', 'Authorization Date & Time', 'Units',
          'Units of Measure', 'Merchant Name', 'Merchant Address', 'Merchant City',
          'Merchant State / Province', 'Merchant Postal Code', 'Driver First Name', 'Driver Last Name']


class TextHTML(html.parser.HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.parts, self.hidden = [], 0

    def handle_starttag(self, tag, attrs):
        if tag in ('script', 'style', 'blockquote'): self.hidden += 1
        if tag in ('br', 'p', 'div', 'tr', 'td', 'th', 'li'): self.parts.append('\n')

    def handle_endtag(self, tag):
        if tag in ('script', 'style', 'blockquote'): self.hidden = max(0, self.hidden - 1)
        if tag in ('p', 'div', 'tr', 'td', 'th', 'li'): self.parts.append('\n')

    def handle_data(self, data):
        if not self.hidden: self.parts.append(data)


def parse_emlx(file):
    with Path(file).open('rb') as stream:
        size = int(stream.readline().strip())
        if size < 1 or size > 25_000_000: raise ValueError('invalid_message_size')
        raw = stream.read(size)
    if len(raw) != size: raise ValueError('incomplete_message_file')
    message = email.message_from_bytes(raw, policy=email.policy.default)
    if email.utils.parseaddr(str(message.get('From', '')))[1].lower() != SENDER:
        raise ValueError('source_sender_mismatch')
    identity = str(message.get('Message-ID', '')).strip()
    if not re.fullmatch(r'<[^\s<>]+@[^\s<>]+>', identity): raise ValueError('missing_message_identity')
    body = ''
    for kind in ('plain', 'html'):
        part = message.get_body(preferencelist=(kind,))
        if part is None: continue
        text = part.get_content()
        if kind == 'html':
            parser = TextHTML(); parser.feed(text); text = ''.join(parser.parts)
        if text.strip(): body = text; break
    if not body.strip(): raise ValueError('empty_message_body')
    fields = {}
    for label in FIELDS:
        values = re.findall(re.escape(label) + r':\s*\|?\s*([^\n|]+)', body, re.I)
        if len(values) > 1: raise ValueError('ambiguous_alert_fields')
        fields[label] = ' '.join(values[0].split()) if values else ''
    if not fields['Tracking Number'].isdigit() or not fields['Authorization Date & Time'] or 'fuel' not in fields['Reason'].lower():
        raise ValueError('invalid_wex_alert_fields')
    return identity, '\n'.join(label + ': ' + fields[label] for label in FIELDS)


def scan(account, mailbox, mail_root, accounts_db, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    if not re.fullmatch(r'[A-Za-z0-9-]{1,100}', account): raise ValueError('invalid_account_identifier')
    ac = sqlite3.connect(Path(accounts_db).resolve().as_uri() + '?mode=ro', uri=True)
    try:
        match = ac.execute('select ZUSERNAME from ZACCOUNT where ZIDENTIFIER=?', (account,)).fetchall()
        if len(match) != 1 or match[0][0].lower() != mailbox.lower(): raise ValueError('approved_account_mismatch')
    finally: ac.close()
    root = Path(mail_root)
    db = sqlite3.connect((root / 'MailData/Envelope Index').resolve().as_uri() + '?mode=ro', uri=True)
    try:
        rows = db.execute('''select m.ROWID,m.date_received,b.url from messages m
            join mailboxes b on b.ROWID=m.mailbox join addresses a on a.ROWID=m.sender
            where b.url like ? and lower(a.address)=? and m.date_received>=? and m.deleted=0
            order by m.date_received,m.ROWID limit 1001''',
            ('ews://' + account + '/%', SENDER, (now - dt.timedelta(days=8)).timestamp())).fetchall()
    finally: db.close()
    if len(rows) > 1000: raise ValueError('source_scan_limit_reached')
    messages, sources, gaps, seen = [], [], [], set()
    for row_id, received, folder in rows:
        if any(folder.lower().endswith('/' + name) for name in ('drafts', 'deleted%20items', 'junk%20email', 'trash')): continue
        try:
            if received > now.timestamp(): raise ValueError('future_received_time')
            paths = list((root / account).glob('**/' + str(row_id) + '.emlx'))
            if len(paths) != 1: raise ValueError('body_not_downloaded_or_ambiguous')
            if (root / account).resolve() not in paths[0].resolve().parents: raise ValueError('source_outside_approved_account')
            identity, body = parse_emlx(paths[0])
            ident = 'outlook-local:' + hashlib.sha256((account + '\0' + identity).encode()).hexdigest()
            received_at = dt.datetime.fromtimestamp(received, dt.timezone.utc).isoformat().replace('+00:00', 'Z')
            candidate = {'id': ident, 'sender': SENDER, 'receivedAt': received_at, 'sourceUrl': ident, 'body': body}
            if ident in seen:
                if candidate in messages: continue
                # Preserve both conflicting versions for the guarded importer to
                # reject atomically; never silently select one as price evidence.
                gaps.append({'rowId': row_id, 'reason': 'duplicate_native_identity_conflict'})
            seen.add(ident); messages.append(candidate)
            sources.append({'id': ident, 'accountId': account, 'internetMessageId': identity, 'receivedAt': received_at})
        except (ValueError, OSError, LookupError, TypeError) as error:
            gaps.append({'rowId': row_id, 'reason': str(error)[:80]})
    return {'messages': messages, 'sources': sources}, gaps


def write_status(directory, value):
    directory = Path(directory); directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix='.mail-source-', dir=directory)
    try:
        with os.fdopen(fd, 'w') as output: json.dump(value, output)
        os.replace(temp, directory / 'mail-source-status.json')
    finally:
        if os.path.exists(temp): os.unlink(temp)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--account-id', required=True); parser.add_argument('--mailbox', required=True)
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()
    release = Path(__file__).resolve().parent.parent
    destination = Path(os.environ.get('WEX_FUEL_DATA_DIR', str(Path.home() / '.openclaw/workspace/opsbot/data/integrations/wex-fuel')))
    cause = os.environ.get('INTAKE_EVENT')
    status = {'checkedAt': dt.datetime.now(dt.timezone.utc).isoformat(), 'source': 'Existing Apple Mail Exchange cache',
              'trigger': 'watcher-startup' if cause == 'startup-recovery' else 'mail-watcher-event' if cause else 'manual'}
    try:
        packet, gaps = scan(args.account_id, args.mailbox, Path.home() / 'Library/Mail/V10', Path.home() / 'Library/Accounts/Accounts4.sqlite')
        status.update(status='partial' if gaps else 'available', accepted=len(packet['messages']), rejected=len(gaps), latestReceivedAt=max((s['receivedAt'] for s in packet['sources']), default=None))
        # Never pass raw emails, unrelated correspondence or credentials to the importer.
        result = subprocess.run(['/opt/homebrew/bin/node', '--import', 'tsx', str(release / 'scripts/import-wex-native-mail.ts'), '--dry-run' if args.dry_run else '--apply'],
                                input=json.dumps(packet), text=True, capture_output=True, cwd=release, timeout=120)
        if result.returncode: raise ValueError('native_import_failed')
        status['import'] = json.loads(result.stdout)
        if not args.dry_run: write_status(destination, status)
        print(json.dumps(status))
        return 0
    except Exception as error:
        status.update(status='failed', error=type(error).__name__ + ': ' + str(error)[:100])
        if not args.dry_run: write_status(destination, status)
        print(json.dumps(status)); return 1


if __name__ == '__main__': raise SystemExit(main())
