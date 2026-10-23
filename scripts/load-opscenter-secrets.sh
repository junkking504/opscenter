#!/bin/sh

# This file is sourced by the production web and collector wrappers. It loads
# integration and Web Push credentials from Keychain without printing their values.
load_opscenter_keychain_secret() {
  variable_name="$1"
  service_name="$2"
  eval "current_value=\${$variable_name:-}"
  [ -z "$current_value" ] || return 0
  secret_value=$(/usr/bin/security find-generic-password \
    -a opscenter \
    -s "$service_name" \
    -w 2>/dev/null) || return 0
  [ -n "$secret_value" ] || return 0
  export "$variable_name=$secret_value"
  unset secret_value
}

load_opscenter_keychain_secret INTUIT_CLIENT_ID com.opscenter.intuit-client-id
load_opscenter_keychain_secret INTUIT_CLIENT_SECRET com.opscenter.intuit-client-secret
load_opscenter_keychain_secret QBO_TOKEN_ENCRYPTION_KEY com.opscenter.qbo-token-encryption-key
load_opscenter_keychain_secret PODIUM_CLIENT_ID com.opscenter.podium-client-id
load_opscenter_keychain_secret PODIUM_CLIENT_SECRET com.opscenter.podium-client-secret
load_opscenter_keychain_secret PODIUM_TOKEN_ENCRYPTION_KEY com.opscenter.podium-token-encryption-key
# Keep the new signing capability out of preview and disabled runtimes.
if [ "${OPSCENTER_RUNTIME:-}" = "MISSION_CONTROL" ] && [ "${OPSCENTER_WEB_PUSH_ENABLED:-0}" = "1" ] && [ "${OPSCENTER_PROCESS_ROLE:-}" = "push-dispatcher" ]; then
  load_opscenter_keychain_secret OPSCENTER_WEB_PUSH_PRIVATE_KEY com.opscenter.web-push-vapid-private-key
else
  unset OPSCENTER_WEB_PUSH_PRIVATE_KEY
fi
load_opscenter_keychain_secret LINXUP_PUSH_BEARER_TOKEN com.opscenter.linxup-push-bearer-token

unset current_value variable_name service_name
unset -f load_opscenter_keychain_secret 2>/dev/null || true
