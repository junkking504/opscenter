import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { whatsappSenderTruckMap } from "../lib/whatsapp-sender-truck-map";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "opscenter-whatsapp-map-"));
const previous = process.env.OPS_CREW_PHONE_DIR;
try {
  process.env.OPS_CREW_PHONE_DIR = root;
  fs.writeFileSync(path.join(root, "directory.json"), JSON.stringify({
    schema: 1,
    company: [{ label: "Phone 8", truck: "Truck 8", number: "504-555-0101" }],
    managers: [],
  }));
  assert.deepEqual(whatsappSenderTruckMap(""), { "5045550101": "Truck 8" });
  assert.deepEqual(whatsappSenderTruckMap(JSON.stringify({ "(504) 555-0101": "Truck 9", "504-555-0102": "Truck 10" })), {
    "5045550101": "Truck 9",
    "5045550102": "Truck 10",
  });
  console.log("WhatsApp sender mapping passed: company-phone baseline with explicit narrow overrides.");
} finally {
  if (previous === undefined) delete process.env.OPS_CREW_PHONE_DIR; else process.env.OPS_CREW_PHONE_DIR = previous;
  fs.rmSync(root, { recursive: true, force: true });
}
