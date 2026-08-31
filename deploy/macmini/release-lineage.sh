#!/bin/zsh

# Pure Git lineage checks shared by the installed Mission Control controller
# and its fixture tests. This file intentionally performs no deployment work.

opscenter_resolve_commit() {
  local repository="$1"
  local ref="$2"

  git -C "$repository" rev-parse --verify "${ref}^{commit}" 2>/dev/null
}

opscenter_require_exact_ref() {
  local repository="$1"
  local requested_commit="$2"
  local required_ref="$3"
  local required_commit

  required_commit="$(opscenter_resolve_commit "$repository" "$required_ref")" || {
    echo "cannot resolve required production ref $required_ref" >&2
    return 1
  }
  if [[ "$requested_commit" != "$required_commit" ]]; then
    echo "requested commit $requested_commit is not the current $required_ref commit $required_commit" >&2
    return 1
  fi
}

opscenter_require_forward_commit() {
  local repository="$1"
  local active_commit="$2"
  local requested_commit="$3"

  if [[ "$requested_commit" == "$active_commit" ]] \
    || git -C "$repository" merge-base --is-ancestor "$active_commit" "$requested_commit"; then
    return 0
  fi

  echo "requested commit $requested_commit does not contain active commit $active_commit" >&2
  return 1
}
