#!/bin/sh

# This file is sourced by the production web and collector wrappers. It loads
# QBO credentials from the local login Keychain without printing their values.
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
load_opscenter_keychain_secret LINXUP_PUSH_BEARER_TOKEN com.opscenter.linxup-push-bearer-token
# The Google Geocoding fallback in the OpsBot geocoder has always been wired
# into every failure path but had no key, so it returned "not configured" and
# the caller discarded that reason - 148 addresses sat unresolved with no sign
# the paid fallback was never running. Store the key once with:
#   security add-generic-password -a opscenter -s com.opscenter.google-maps-api-key -w
load_opscenter_keychain_secret GOOGLE_MAPS_API_KEY com.opscenter.google-maps-api-key

unset current_value variable_name service_name
unset -f load_opscenter_keychain_secret 2>/dev/null || true
