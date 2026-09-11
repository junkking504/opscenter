# OpsBot Resale intake

Send a product photo to the existing OpsBot WhatsApp number with this caption,
or send the text first and then photos from the same phone within ten minutes:

```text
Resale
Oak dresser
150
```

Each new name submission creates a To list item with a permanent number such as
RS-0001. Additional captionless photos use the preceding message, scoped to the
sender and receiving WhatsApp number. Send a new three-line message for each
new item. Use an existing item number in line two to update its asking price or
add photos later. Keep unrelated messages out of the photo batch.

To record a sale:

```text
Resale
RS-0001
125
sold
```

An exact, case-insensitive item name also works when only one unsold item has
that name. Ambiguous or missing matches make no change and receive guidance.
The sale preserves the asking price and photos, stores the actual sale price,
and marks the item sold. It records operator-reported inventory evidence;
it does not post to QBO or verify payment. An already sold item requires a
correction on the Resale page rather than another sold message.

## Storage and processing

The signed, receiving-number-checked WhatsApp webhook routes Resale text before
closeout, load and expense interpreters. Newlines survive parsing and captured
photo context. The existing photo worker intercepts Resale photos before any
JunkWare matching or upload and uses the existing verified Meta media download.
No AI/provider SDK, paid routing or new polling service is introduced.

`data/finance/resale_items.json` stores inventory, a persistent number counter,
and message receipts atomically under a shared web/worker lock. Existing items
receive numbers on first read; numbers survive edits and are never reused after
deletions. Message receipts prevent webhook and worker retries from repeating
sales or creating items. Corrupt inventory fails closed. An orphaned `.lock`
requires checking the writer before recovery; it is never removed based on age.

Photos are copied into `data/finance/resale-photos` and served through an
authenticated item-membership-checked route. Inventory edits preserve photos.
The live Finance Resale list shows numbers, photo thumbnails and sold prices;
the item drawer opens the full gallery. The existing Finance refresh updates
incoming inventory. OpsBot sends one item receipt per message/context, not one
per photo. The receipt confirms the inventory record, not completion of an album.

Validation: `npm run verify:whatsapp-resale`, existing WhatsApp parser/media
regressions, desktop build and production build. Use isolated fixture data and
mock media downloads; never send test messages to real recipients.
