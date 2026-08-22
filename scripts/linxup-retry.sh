#!/bin/bash

# Run a LinxUp refresh callback again after a failure. The callback is invoked
# for every attempt, so API-backed callbacks re-fetch instead of reusing the
# response that failed validation.

linxup_retry() {
  local max_attempts="$1"
  local retry_delay_seconds="$2"
  local callback="$3"
  local attempt=1
  local refresh_status=1

  [[ "$max_attempts" =~ ^[1-9][0-9]*$ ]] || {
    echo "Invalid LinxUp attempt count: $max_attempts" >&2
    return 64
  }
  [[ "$retry_delay_seconds" =~ ^[0-9]+$ ]] || {
    echo "Invalid LinxUp retry delay: $retry_delay_seconds" >&2
    return 64
  }

  while (( attempt <= max_attempts )); do
    if "$callback"; then
      return 0
    else
      refresh_status=$?
    fi

    if (( attempt < max_attempts )); then
      echo "LinxUp refresh attempt $attempt/$max_attempts failed (exit $refresh_status); retrying in $retry_delay_seconds seconds." >&2
      if (( retry_delay_seconds > 0 )); then
        sleep "$retry_delay_seconds"
      fi
    fi
    attempt=$((attempt + 1))
  done

  return "$refresh_status"
}
