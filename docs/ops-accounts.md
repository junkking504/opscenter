# OpsCenter accounts

The existing shared login remains available. Additional named accounts are private
server configuration in `OPS_AUTH_ACCOUNTS_JSON`, an array of `{username,
displayName,passwordHash,role,active}`. Allowed roles are operator, manager and
admin. Usernames are unique, case-insensitive and cannot shadow the shared login.
Malformed/duplicate rosters fail closed. Passwords use the existing salted
PBKDF2-SHA256 format; store only hashes, never plaintext or live rosters in Git.

Login creates a distinct `<username>@junk-king.com` internal session/audit identity
(the identity is not an assertion that an email mailbox exists). Named account
roles come from the account row. Display names appear through the shared auth
helper. Deactivating/removing an account rejects its existing session and trusted
device cookies on subsequent checks, including when Cloudflare Access is enabled.
Changes to environment configuration require the existing controlled runtime
restart/deployment procedure. Back up the protected file before changing it.

These credentials also sign into Waypoint at `/login?next=/crew-jobs`. Manager and
administrator roles can open its manager portal; operator accounts cannot. Each
hostname retains separate cookies. Phone enrollment and crew closeout safeguards
remain independent. See [Waypoint access](waypoint-manager-scope.md).

Validation: `verify:named-accounts`, `verify:ops-auth`, `verify:role-access`, and `verify:waypoint-manager`, followed by authenticated
read-only login/browser checks on both production hosts.
