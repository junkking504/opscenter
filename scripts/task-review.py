#!/usr/bin/env python3
"""Local review handoff checks. No provider calls, command replay, or deployment."""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys


def git(repo, *args):
    return subprocess.check_output(['git', '-C', str(repo), *args], text=True).strip()


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()


def snapshot(repo, base):
    repo = Path(git(repo, 'rev-parse', '--show-toplevel')).resolve()
    if git(repo, 'status', '--porcelain', '--untracked-files=all'):
        raise ValueError('Commit the intended changes first; tracked and untracked changes invalidate a review.')
    base = git(repo, 'rev-parse', '--verify', '--end-of-options', base + '^{commit}')
    head = git(repo, 'rev-parse', 'HEAD')
    subprocess.run(['git', '-C', str(repo), 'merge-base', '--is-ancestor', base, head], check=True)
    return {'repository': str(repo), 'base': base, 'head': head,
            'diffHash': hashlib.sha256(subprocess.check_output(
                ['git', '-C', str(repo), 'diff', '--no-ext-diff', '--no-textconv', '--binary', base, head])).hexdigest(),
            'files': git(repo, 'diff', '--name-only', base, head).splitlines()}


def save_new(file, value, repo):
    file = Path(file).resolve()
    repo = Path(repo).resolve()
    if file == repo or repo in file.parents:
        raise ValueError('Keep private review packets outside the source checkout.')
    file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd = os.open(file, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream, indent=2)
        stream.write('\n')


def filled(value):
    return isinstance(value, str) and bool(value.strip())


def subject(packet):
    # Editing the requirement, prior evidence, scope or validation invalidates review.
    return digest({key: packet[key] for key in
                   ('schema', 'task', 'builder', 'snapshot', 'brief', 'validation')})


def check(packet, repo, phase):
    errors = []
    if packet.get('schema') != 1:
        raise ValueError('Unsupported review packet schema.')
    current = snapshot(repo, packet['snapshot']['base'])
    if current != packet['snapshot']:
        errors.append('Source changed: create a new packet revision and repeat affected checks/review.')
    if not current['files']:
        errors.append('The selected base contains no changes to review.')
    for field in ('task', 'builder'):
        if not filled(packet.get(field)):
            errors.append('Missing ' + field)
    brief = packet['brief']
    for field in ('problem', 'desiredBehavior', 'scope', 'priorLessons', 'risk', 'recovery'):
        if not filled(brief.get(field)):
            errors.append('Missing brief.' + field)
    criteria = brief.get('acceptanceCriteria')
    if not isinstance(criteria, list) or not criteria or not all(filled(c) for c in criteria) or len(set(criteria)) != len(criteria):
        errors.append('Provide distinct, observable acceptance criteria.')
    validation = packet.get('validation')
    if not isinstance(validation, list) or not validation:
        errors.append('Record at least one relevant validation check.')
    else:
        for row in validation:
            if not isinstance(row, dict) or row.get('status') != 'passed' or not filled(row.get('check')) or not filled(row.get('evidence')) or row.get('head') != current['head']:
                errors.append('Every validation check needs a passed result, evidence and the current commit.')
    if phase in ('reviewed', 'accepted'):
        review = packet.get('review', {})
        if not filled(review.get('reviewer')) or review.get('reviewer', '').strip().casefold() == packet.get('builder', '').strip().casefold():
            errors.append('Record a separate reviewer; the builder cannot attest to independent review.')
        if review.get('subject') != subject(packet):
            errors.append('Review does not cover this requirement, source and validation fingerprint.')
        if review.get('verdict') != 'approved' or not filled(review.get('evidence')):
            errors.append('Independent review needs an approved verdict and an inspectable report.')
        findings = review.get('findings')
        if not isinstance(findings, list) or any(not isinstance(f, dict) or not filled(f.get('finding')) or f.get('status') != 'resolved' or not filled(f.get('evidence')) for f in findings):
            errors.append('Resolve every review finding with evidence; use an empty list only when none were found.')
    if phase == 'accepted':
        acceptance = packet.get('acceptance', [])
        if not isinstance(acceptance, list) or not isinstance(criteria, list) or len(acceptance) != len(criteria) or {r.get('criterion') for r in acceptance if isinstance(r, dict)} != set(criteria):
            errors.append('Record acceptance for each criterion exactly once.')
        if not isinstance(acceptance, list) or any(not isinstance(r, dict) or r.get('status') != 'passed' or r.get('head') != current['head'] or not filled(r.get('evidence')) for r in acceptance):
            errors.append('Acceptance needs passed results, current commit and exact behavior evidence.')
        lesson = packet.get('lesson', {})
        for field in ('summary', 'cause', 'action', 'evidence', 'remaining', 'prevention', 'owner'):
            if not filled(lesson.get(field)):
                errors.append('Missing lesson.' + field)
        if lesson.get('outcome') not in ('fixed', 'follow-up', 'open', 'unknown', 'context'):
            errors.append('Choose an honest historical lesson outcome.')
    return {'phase': phase, 'passed': not errors, 'subject': subject(packet),
            'head': current['head'], 'errors': errors,
            'boundary': 'Recorded evidence only; reviewer identity and claims are attestations, not independently authenticated by this tool.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('command', choices=['init', 'check', 'lesson'])
    parser.add_argument('--repo', default='.')
    parser.add_argument('--packet', required=True)
    parser.add_argument('--base')
    parser.add_argument('--task')
    parser.add_argument('--builder')
    parser.add_argument('--phase', choices=['prepared', 'reviewed', 'accepted'], default='prepared')
    parser.add_argument('--output')
    args = parser.parse_args()
    repo = Path(git(args.repo, 'rev-parse', '--show-toplevel')).resolve()
    if args.command == 'init':
        if not all((args.base, args.task, args.builder)):
            raise ValueError('init requires --base, --task and --builder.')
        packet = {'schema': 1, 'task': args.task, 'builder': args.builder,
                  'snapshot': snapshot(repo, args.base),
                  'brief': {'problem': '', 'desiredBehavior': '', 'scope': '', 'priorLessons': '',
                            'risk': '', 'recovery': '', 'acceptanceCriteria': []},
                  'validation': [], 'review': {'reviewer': '', 'subject': '', 'verdict': 'pending', 'evidence': '', 'findings': []},
                  'acceptance': [], 'lesson': {'summary': '', 'cause': '', 'action': '', 'evidence': '',
                                             'remaining': '', 'prevention': '', 'owner': '', 'outcome': 'unknown'}}
        save_new(args.packet, packet, repo)
        print(json.dumps({'packet': str(Path(args.packet).resolve()), 'head': packet['snapshot']['head']}))
        return
    packet = json.loads(Path(args.packet).read_text())
    report = check(packet, repo, args.phase)
    if args.command == 'lesson':
        # Open/unreviewed work is worth retaining, but cannot be exported as a fixed incident.
        lesson = packet.get('lesson', {})
        for field in ('summary', 'cause', 'action', 'evidence', 'remaining', 'prevention', 'owner'):
            if not filled(lesson.get(field)):
                raise ValueError('Missing lesson.' + field)
        accepted = check(packet, repo, 'accepted')['passed']
        if lesson.get('outcome') not in ('fixed', 'follow-up', 'open', 'unknown', 'context'):
            raise ValueError('Invalid historical outcome.')
        if lesson['outcome'] in ('fixed', 'follow-up') and not accepted:
            raise ValueError('A fix outcome requires review and acceptance. Use open, unknown or context for incomplete work.')
        if not args.output:
            raise ValueError('lesson requires --output; it only creates a draft manifest.')
        body = '\n\n'.join(f'{key.title()}\n{lesson[key]}' for key in
                           ('cause', 'action', 'evidence', 'remaining', 'prevention'))
        record = {'title': packet['task'], 'kind': 'discussion', 'workspace': 'Command',
                  'summary': lesson['summary'], 'body': body, 'sourceLabel': 'OpsCenter task review',
                  'sourceUrl': '', 'sourceNote': f"Packet: {Path(args.packet).resolve()}; commit: {packet['snapshot']['head']}; accepted: {accepted}",
                  'owner': lesson['owner'], 'learning': {'sourceKey': 'task-review:' + digest({'repository': packet['snapshot']['repository'], 'task': packet['task']})[:32],
                      'recordedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(),
                      'outcome': lesson['outcome'], 'topics': ['engineering-review', 'task-learning']}}
        save_new(args.output, {'schema': 1, 'records': [record]}, repo)
        print(json.dumps({'output': args.output, 'accepted': accepted, 'imported': False}))
    else:
        print(json.dumps(report, indent=2))
        if not report['passed']:
            sys.exit(2)


if __name__ == '__main__':
    try:
        main()
    except (ValueError, KeyError, TypeError, AttributeError, OSError, subprocess.CalledProcessError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(2)
