# JunkWare Appointment Creation

OpsCenter creates Schedule appointments through JunkWare and treats the
returned JunkWare appointment as the source of truth. A booking is not shown as
successful merely because a form submission completed.

## Operator flow

1. Open **New Appointment** from the Schedule header.
2. Enter the customer, service, booking, billing, and work details required by
   JunkWare.
3. Review the complete booking before creating it.
4. OpsCenter searches for a matching customer, creates or reuses the customer
   record, and submits the appointment to JunkWare.
5. JunkWare assigns the JK number.
6. OpsCenter opens the returned appointment and verifies the JK number,
   customer, phone, service address, date, start time, category, franchise, and
   truck before reporting success.

`Job` and `Estimate` are separate appointment categories. Creating an Estimate
does not create completed-job production or revenue.

## Duplicate and retry safety

### Desktop Prebooking Review

The desktop **Review Appointment** action checks the selected date before
showing the final booking review. `/api/desktop/schedule/creation/check` is an
authenticated, same-origin, read-only POST so customer details stay out of URLs.
It uses a JunkWare Schedule snapshot no more than five minutes old; missing or
stale snapshots block review and direct the operator to refresh that date.

Matching requires customer name or phone, the same service address, and
overlapping windows. Matches cross franchise, truck, and Job/Estimate category
boundaries without combining identities. Canceled bookings are excluded.
Street-only input can match a full source address when ZIP agrees and no unit
or building distinction is lost. This is a conservative warning, not proof
that all duplicates have been found.

Each match shows its JK reference, category, status, address, window, truck,
and source franchise, with links to its exact OpsCenter record and JunkWare.
Creating another appointment requires a checkbox and a reason of at least ten
characters. The existing reason field carries that explanation into JunkWare
notes. Nothing is automatically merged, canceled, or reassigned.

The create endpoint recomputes a fingerprint of the normalized draft and
matching source records inside the existing reservation lock, before reserving
a new request or calling JunkWare. Changed facts or missing acknowledgement
return 409 and require a new review. Existing saved requests return their
receipt first, preserving verified/uncertain-result recovery. The existing
identity reservation and upstream duplicate guards remain in place; snapshot
review is not a guarantee against a simultaneous external JunkWare booking.

Regression coverage: `npm run verify:duplicate-bookings` includes the prebooking
guard; `node scripts/test-prebooking-browser.mjs` uses the synthetic fixture
served by `desktop-ui/tests/duplicates.vite.config.ts` on port 3148. Live QA
must stop before **Create in JunkWare** unless a test-safe booking is authorized.

Each reviewed submission receives a UUID request ID. OpsCenter stores only the
request fingerprint and sanitized verified result; it does not persist the
customer payload in the idempotency record.

- Repeating a verified request returns the same verified JK result.
- A current-schedule match on phone, service address, date, and time is blocked.
  A second appointment requires an explicit operator reason, which is included
  in the JunkWare appointment notes.
- Appointment creation is serialized so two operators cannot submit competing
  JunkWare creation requests at once.
- A failure before Save is retryable after the operator corrects the booking.
- A failure during Save or read-back is **uncertain**. OpsCenter blocks blind
  retry and directs the operator to search JunkWare for the same date, phone,
  service address, and time.

## Integration boundary

- UI: `components/AppointmentCreateDialog.tsx`
- Authenticated route: `app/api/appointments/route.ts`
- Validation, idempotency, duplicate guard, and process boundary:
  `lib/junkware-appointment-creation.ts`
- JunkWare WebForms adapter: `scripts/create-junkware-appointment.ts`
- Shared WebForms postback helpers: `scripts/junkware-webforms.ts`

Credentials and browser storage remain in the existing protected JunkWare
credential boundary. Customer values are sent to the adapter over stdin rather
than command-line arguments and are omitted from OpsCenter logs.

## Verification

Run the deterministic adapter and lifecycle checks without writing to JunkWare:

```bash
npm run verify:junkware-appointment-creation
```

The test uses `JUNKWARE_APPOINTMENT_CREATION_STUB=1` and verifies input rules,
Job/Estimate separation, duplicate blocking, override attribution,
idempotency, sanitized persistence, and the required write/read-back selectors.

A real live-write acceptance test must use a deliberate test-safe customer and
appointment. Do not create a live appointment merely to prove the UI.
