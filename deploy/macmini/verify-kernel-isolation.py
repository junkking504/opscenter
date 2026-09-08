#!/usr/bin/env python3
"""Read-only kernel coexistence check. Never print connection strings."""
import json
import pathlib
import sys
import urllib.error
import urllib.parse
import urllib.request

CONFIG_DIR = pathlib.Path('/Users/missioncontrol/Library/Application Support/OpsCenter')


def read_environment(file):
    values = {}
    for line in file.read_text().splitlines():
        if not line or line.startswith('#'):
            continue
        key, separator, value = line.partition('=')
        if not separator:
            raise ValueError('Invalid environment entry')
        # Production shell wrappers use quoted assignments; preview uses literal
        # assignments. Decode only enclosing quotes, without executing anything.
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def database_name(environment, variable):
    try:
        url = urllib.parse.urlsplit(environment.get(variable, ''))
        name = urllib.parse.unquote(url.path.lstrip('/')).strip()
        if url.scheme not in ('postgres', 'postgresql') or not name:
            raise ValueError()
        # Do not allow query parameters to override the database in the path.
        if any(key in urllib.parse.parse_qs(url.query) for key in ('database', 'dbname', 'service')):
            raise ValueError()
        return name
    except ValueError:
        raise ValueError('Invalid or ambiguous runtime-specific database configuration') from None


def validate(production, preview, production_health, preview_health, require_preview=False):
    names = []
    for environment, health, runtime, variable in (
        (production, production_health, 'MISSION_CONTROL', 'OPSCENTER_MISSION_CONTROL_DATABASE_URL'),
        (preview, preview_health, 'MAC_MINI_PREVIEW', 'OPSCENTER_PREVIEW_DATABASE_URL'),
    ):
        enabled = environment.get('OPSCENTER_KERNEL_ENABLED', '').strip() == '1'
        kernel = health.get('platformKernel', {})
        if health.get('runtime') != runtime or kernel.get('runtime') != runtime:
            raise ValueError('Kernel runtime identity is missing or incorrect')
        if kernel.get('enabled') is not enabled:
            raise ValueError('Kernel runtime does not match its protected configuration')
        if runtime == 'MAC_MINI_PREVIEW' and require_preview and not enabled:
            raise ValueError('Preview kernel must be enabled for this validation')
        if not enabled:
            if kernel.get('status') != 'disabled':
                raise ValueError('Disabled kernel did not report disabled status')
            continue
        name = database_name(environment, variable)
        if kernel.get('healthy') is not True or kernel.get('status') != 'healthy':
            raise ValueError('Enabled kernel is unhealthy or unavailable')
        if kernel.get('databaseName') != name:
            raise ValueError('Kernel database does not match its protected configuration')
        if runtime == 'MAC_MINI_PREVIEW' and name != 'opscenter_preview':
            raise ValueError('Preview kernel must use the dedicated preview database')
        names.append(name)
    if len(names) == 2 and names[0] == names[1]:
        raise ValueError('Production and preview must use distinct databases')


def health(port):
    try:
        response = urllib.request.urlopen(f'http://127.0.0.1:{port}/api/health', timeout=5)
    except urllib.error.HTTPError as error:
        response = error  # Operational freshness alone is not an isolation failure.
    with response:
        return json.load(response)


if __name__ == '__main__':
    try:
        validate(read_environment(CONFIG_DIR / 'production.env'),
                 read_environment(CONFIG_DIR / 'macmini-preview.env'),
                 health(3000), health(3100), '--require-preview-kernel' in sys.argv[1:])
    except Exception:
        # Fail closed without leaking URLs, passwords, or arbitrary response text.
        print('FAIL  kernel isolation: configuration, runtime health, or distinct database check failed', file=sys.stderr)
        sys.exit(1)
    print('PASS  enabled kernels are healthy and use their distinct configured databases')
