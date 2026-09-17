# Mobile job closeout design preview

The first mobile review surface presents a truck's jobs, appointment information,
before/after photo selection, and a four-step closeout: Details, Charges, Payment,
Review. The closeout is the existing `AppointmentCloseout` component with an
opt-in mobile presentation. Its default management presentation is unchanged.
All source-version, validation, payment and uncertain-save handling remain in
that component and the existing operation transport.

This is a local design preview, not a launched employee application. Its sample
records are fictional. Its fetch adapter never forwards requests, and its HTML
also forbids network connections through CSP. Confirming returns an explicit
preview-only result. Photo selections use temporary object URLs; they are not
uploaded or persisted. Changing job sections preserves the closeout draft in
memory, but returning to the job list or refreshing discards it.

Build with `node scripts/build-mobile-closeout-preview.mjs <output-directory>`.
Open the generated `index.html` locally. Test with
`node --import tsx scripts/test-mobile-closeout.ts <index.html>`.

## Required before employee launch

- Choose shared truck-phone, individual employee, or combined access. Enforce
  appointment visibility and write scope on the server. A selected truck in the
  interface is not authorization; inspection device credentials do not grant
  closeout or payment access.
- Confirm whether crews record collected payments or submit details for office
  review. Payment recording does not itself charge a card.
- Connect the scoped schedule read and closeout operation to current JunkWare
  records. Preserve review, expected-source versions, durable receipt identity,
  read-back, and prevention of duplicate uncertain writes.
- Connect photos to the existing verified appointment upload workflow, with
  per-photo progress, retry/read-back and explicit upload completion.
- Add private draft persistence appropriate to shared phones, recovery after
  lost connectivity, stale assignment handling, session expiry and sign-out.
  Never silently queue or replay financial writes offline.
- Test the authenticated full workflow on the actual company phones, including
  keyboard, camera, poor network, repeated taps and verified saved results.

The prototype neither broadens authentication nor exposes management data.
It does not add a provider, paid service, background polling or live API route.
