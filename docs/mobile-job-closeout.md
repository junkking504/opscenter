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

## Product Design pass — September 17, 2026

### Design brief

The intended user is a crew member finishing a job on site. The primary outcome
is a correctly saved closeout with evidence and a clear result the employee can
trust. The working design assumption is a shared company truck phone. This is
not an approved device-access model; individual identity, crew permission to
record payments, and any office-review requirement still need a product decision.

Preserve OpsCenter's brand tokens and existing JunkWare closeout rules. Prioritize
readable controls in daylight, one-handed use, a visible primary action, and
recovery after interruptions. No new native-app framework is selected by this
brief; the existing source is the current implementation target.

### Proposed employee journey

| Step | Primary action | Required behavior |
| --- | --- | --- |
| 1. Today's jobs | Open job / Continue draft | Show only server-authorized jobs; identify the current truck and signed-in employee. Source status and draft status are separate. |
| 2. Confirm the job | Start closeout | Keep customer, service address, job number and notes visible. Identify Completed records as saved records rather than fresh work. |
| 3. Photos | Add before / after photos | Support camera and photo library. Distinguish selected, uploading, uploaded and failed images. Preserve local images until upload is verified. |
| 4. Work details | Continue to charges | Confirm completion outcome, actual crew and actual times. Mark GPS suggestions as suggestions. Jump to missing required fields before advancing. |
| 5. Charges | Continue to payment | Start from source charges. Show load price, extra charges, discount, tip and total distinctly; collapse unused optional charge groups. |
| 6. Payment | Review job | Separate existing payments from new payment entries and unpaid balances. Clearly state that recording a card payment does not charge it. |
| 7. Review | Confirm closeout | Show identity, work, money and photo-upload status together. Provide an Edit link to each relevant step. |
| 8. Saved result | Next job | Show verified completion, payment recorded/unpaid balance, and any photos still pending separately. Unknown outcomes offer Check saved result, never a fresh submission. |

### Highest-priority implementation work

1. **Draft recovery.** Returning to today's jobs currently unmounts the editor,
   losing its in-memory draft. Add a source-versioned draft owned by the verified
   employee/device and appointment; reconcile it with fresh source data before
   restoring. A saved draft never means the job was closed out.
2. **Separate payment authority.** Do not reuse manager credentials or give an
   inspection device general management access. Define employee closeout scope
   separately from permission to record payments and change prices.
3. **Step validation and recovery.** The existing save validation runs at Review.
   In the mobile presentation, direct each error back to its field and step;
   preserve inputs when the user checks another section or corrects an error.
4. **Photo receipts.** The prototype only previews local images. Live integration
   must report upload progress and server/source acknowledgment per photo.
5. **Completion receipt.** The prototype intentionally declines live writes.
   Production needs distinct verified, pending, failed and uncertain results,
   plus a safe return to today's jobs. Never label pending source verification
   as completion.

### Design references and evidence limits

Mobbin references inspected during this pass:

- [Jobber job creation and detail](https://mobbin.com/flows/59cc7ab8-69a0-4295-93e5-27735c624281),
  preview screens 4, 8 and 11: customer/address context, grouped details,
  and separate invoice/payment sections.
- [Jobber task flow](https://mobbin.com/flows/23b599ad-18e2-45aa-93de-710cfe134d3d),
  preview screen 6: a prominent Complete Task action alongside directions and
  instructions.
- [Jobber payment receipt](https://mobbin.com/flows/d691874d-c3f1-47e5-95f1-593b1287d5f5),
  both screens: Payment Recorded confirmation followed by method, amount and
  transaction details. These are reference patterns, not evidence of OpsCenter
  behavior or a prescription to copy Jobber's navigation.

This pass used the current source and reference screens. A new visual audit was
not completed: the in-app browser URL policy denied the local file preview. The
earlier synthetic browser checks remain separate evidence, not a current
authenticated employee acceptance test. Actual phone-camera behavior, assistive
technology, keyboard obstruction, loss of connectivity, employee scope and live
source read-back remain to be tested before launch.
