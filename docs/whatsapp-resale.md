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

## Upload from OpsCenter

Capital → Resale → Add item or Review item accepts optional JPEG/PNG photos
(up to 10 MB each, 40 megapixels, 25 per item). Choose photos opens the device
library/file picker; Take photo requests the rear camera on supported phones.
HEIC must be exported as JPEG. Selected previews can be removed before saving.
The existing versioned Finance save is verified first, then photos upload one
at a time with visible progress. A failure retains selections and confirms how
many finished; retry continues with the same item/save identity. If the browser
is closed, reopen the saved item and reselect any missing files. Confirmed photos
survive reload; unsubmitted selections are not persisted in the browser.

`POST /api/resale-items/photos` uses the existing manager `sensitive.write`
permission and trusted-origin check. It bounds streamed multipart bytes before
parsing, fully decodes images with the already installed Sharp library, applies
camera orientation, and strips EXIF/GPS metadata. Photos use the existing local
`data/finance/resale-photos` storage and authenticated membership-checked viewer.
An item-and-file hash deduplicates retries, including a lost upload response.
The shared resale lock serializes attachment with WhatsApp and inventory edits;
files are published atomically before inventory membership. A failed attachment
may leave an unreferenced private file, which is never served; retry repairs it.
No new provider, credentials, polling, or external upload is used.

Validation: `npm run verify:resale-photos`, `npm run verify:resale-photos:browser`
(with the isolated Vite fixture server), and `npm run verify:whatsapp-resale`.
The browser fixture uses synthetic local data only.
