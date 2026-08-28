# OpsCenter Role Model

OpsCenter uses the role vocabulary defined in the OS Constitution. Browser sessions currently use three interactive roles:

| Role | Daily operations | Finance and payroll | Sensitive or destructive writes | Identity and platform policy |
| --- | --- | --- | --- | --- |
| `operator` | Read and routine writes | No | No | No |
| `manager` | Read and routine writes | Read and write | Yes | No |
| `admin` | Read and routine writes | Read and write | Yes | Yes |

The separate Krewe Portal remains the `crew` boundary. The `service` and `agent` roles are reserved for narrow integrations, scheduled work, and delegated actions; they are not accepted as ordinary browser roles.

## Enforcement

The signed session resolves its role on every request. Page navigation is filtered for usability, while middleware is the security boundary:

- Finance and the Krewe pay-period/monthly payroll views require `manager` or `admin` access. Daily Krewe remains available to operators with compensation fields removed.
- Payroll corrections, manual bonuses, resale inventory, and QBO controls require `manager` or `admin` access.
- Cancellation, closeout writes, template changes, and all authenticated `DELETE` requests require `manager` or `admin` access.
- Routine operational writes such as assignments, notes, maintenance updates, and inbox work remain available to `operator`, `manager`, and `admin`.
- A denied API request returns HTTP `403` with `code: "role_forbidden"`; a denied page request opens the role-protected access page.

## Configuration

The configured `OPS_AUTH_USERNAME` identity defaults to `admin` so the existing primary account is not locked out. Set its role explicitly with:

```text
OPS_AUTH_ROLE=admin
```

Cloudflare Access identities default to `operator`. Override individual identities with a JSON object or comma-separated bindings:

```text
OPS_AUTH_ROLE_BINDINGS={"manager@junk-king.com":"manager","dispatcher@junk-king.com":"operator"}
```

```text
OPS_AUTH_ROLE_BINDINGS=manager@junk-king.com=manager,dispatcher@junk-king.com=operator
```

`OPS_AUTH_DEFAULT_ROLE` may be `operator`, `manager`, or `admin`; leaving it unset keeps the safer `operator` default for identities without an explicit binding. Role changes take effect on the next request because the role is resolved from protected runtime configuration rather than permanently embedded in the session cookie.
