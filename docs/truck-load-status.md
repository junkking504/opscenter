# Truck load status

Truck load status is an OpsCenter operational ledger shown directly on the
Schedule. It is separate from Linxup GPS location and from JunkWare's stored
job closeout: those sources provide evidence for events, while this ledger
answers how full each physical truck is right now.

## Daily flow

1. A dispatcher selects each truck's start-of-day load. The selection is saved
   immediately and can be corrected without creating duplicate starting events.
2. Every completed **Job** contributes its selected JunkWare load size to the
   assigned physical truck. Two separate 1/4-truck jobs produce 1/2 truck.
   Estimates, open appointments, and canceled appointments add no load. A blank
   load quantity is treated as one load; an explicit zero stays zero. Saving
   the same appointment again replaces its contribution instead of adding it
   twice. Converting a completed job to an estimate retracts that contribution;
   converting a completed estimate to a job adds it once.
3. OpsBot accepts a current snapshot as three plain-text lines:

       Truck 9
       1/2 truck
       some metal, mostly junk

   The truck line may be `Truck 9`, `T9`, `#9`, or a standalone `9`. Load size
   may be entered as a fraction or decimal (`1/2 truck`, `1/2 BRT`, `.5 truck`,
   `.5 BRT`) or as its pickup-load equivalent (`3 pickups`, `3 loads`, `3pu`,
   `3 pu`). One OpsCenter truck equals six pickup loads. These truck-number
   variations also work for photo captions, confirmations, and yard resets.
   OpsBot replies with the recorded status and shows the contents on the
   Schedule.
4. When a truck unloads, the dispatcher taps **Dumped** or **Metal yard**, or
   reports the reset to OpsBot. A dump expense resets the truck only after that
   expense is verified in JunkWare. The event retains the day's audit trail.
5. At end of day, send **Consolidation plan** to OpsBot. It inventories the
   recorded loads and proposes compatible same-stream transfers for the next
   morning. Mixed or unknown contents are flagged for human sorting instead of
   being silently combined.

## Optional photo estimate

Send a photo captioned **Truck status 9** (or first send that text, then the
photo). OpsBot uses the OpenAI Responses API to estimate the closest supported
load fraction, visible contents, and confidence. The estimate never updates the
ledger by itself: reply **CONFIRM TRUCK 9** to accept it, or send corrected
manual values. A low-confidence or obstructed photo returns the manual template.

The production WhatsApp worker loads `OPENAI_API_KEY` from the host-only
`/Users/missioncontrol/opscenter-v2/.env.openai.local`. The file is outside the
repository and must never be committed. `OPSBOT_TRUCK_VISION_MODEL` can override
the default `gpt-5.4-mini` model.

A LinxUp **GEOFENCE_ENTERED** event at a transfer station, landfill, or metal
recycling yard automatically resets the load to empty under the operating rule.
Later completed jobs add to that new load. Warehouse entries remain informational
and never reset the load. Ordinary GPS points, stop/ignition records, exits, and
unknown geofences do not reset it. Native entries and their reset effects share
one stable event ID, so refreshes and delivery retries do not repeat a reset.
The source event remains visible in Command's chronological timeline. The reset
is a read projection from the collected LinxUp event; it does not assert a paid
dump receipt or create a JunkWare payment.

## Runtime data and API

- Store: `data/fleet/truck_load_status.json` (the production `data` symlink
  resolves to the protected OpsBot runtime-data directory).
- API: `GET|POST /api/truck-load-status`.
- Authorized operators may set start loads and record yard resets.
- The store uses an atomic file replacement and a short cross-process lock so a
  closeout and a dispatcher update cannot silently overwrite one another.

Schedule and Fleet share the closeout projection in
`lib/truck-load-closeouts.ts`. It combines this ledger with completed jobs in
the collected JunkWare schedule by appointment ID, so direct JunkWare closeouts
also appear. A verified local save takes precedence until a newer collected
source arrives. This read projection does not rewrite historical source or
ledger files. Schedule shows the load beside each truck; Fleet shows the same
fraction and capacity meter.

Confirmed visit departure or an existing closeout event places an added load
before or after an unload or observation. The schedule's `completed_at` field
can contain the appointment window end and is not used as actual pickup time.
If ordering matters and cannot be verified, the UI displays **Verify load**.
Manual Fleet/API unloads and load observations retain the IDs of jobs already
closed on that truck, so those loads remain covered even if their visit times
are missing or their closeouts are later corrected. A saved starting load is
the day's baseline; without one, completed job contributions accumulate from
zero. No recorded load evidence is shown as **Load not recorded**.

Load sizes use the fractions visible in JunkWare, including Minimum/1/12,
eighths, sixths, quarters, thirds, halves, three-quarters, seven-eighths, and a
full truck. If accumulated load exceeds one truck, OpsCenter keeps the amount
visible as an over-capacity exception rather than hiding it by capping at 100%.
