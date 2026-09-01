# Truck load status

Truck load status is an OpsCenter operational ledger shown directly on the
Schedule. It is separate from Linxup GPS location and from JunkWare's stored
job closeout: those sources provide evidence for events, while this ledger
answers how full each physical truck is right now.

## Daily flow

1. A dispatcher selects each truck's start-of-day load. The selection is saved
   immediately and can be corrected without creating duplicate starting events.
2. A successful, verified OpsCenter job closeout contributes the selected
   JunkWare load size to the assigned physical truck. A blank load quantity is
   treated as one load, matching the existing JunkWare records. Saving the same
   appointment again replaces its contribution instead of adding it twice.
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

GPS presence at a dump or recycler does not by itself prove the truck unloaded,
so GPS alone never resets a load.

## Runtime data and API

- Store: `data/fleet/truck_load_status.json` (the production `data` symlink
  resolves to the protected OpsBot runtime-data directory).
- API: `GET|POST /api/truck-load-status`.
- Authorized operators may set start loads and record yard resets.
- The store uses an atomic file replacement and a short cross-process lock so a
  closeout and a dispatcher update cannot silently overwrite one another.

Load sizes use the fractions visible in JunkWare, including Minimum/1/12,
eighths, sixths, quarters, thirds, halves, three-quarters, seven-eighths, and a
full truck. If accumulated load exceeds one truck, OpsCenter keeps the amount
visible as an over-capacity exception rather than hiding it by capping at 100%.
