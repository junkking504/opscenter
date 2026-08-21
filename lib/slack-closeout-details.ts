import fs from "node:fs";
import path from "node:path";
import { money as moneyText } from "@/lib/money";
import type { AnyRecord } from "@/lib/opsData";

export type TruckCloseoutDetails = {
  jobNumber: string;
  lines: string[];
  slackText: string;
};

function firstText(row: AnyRecord, keys: string[]): string {
  for (const key of keys) {
    const value = String(row?.[key] ?? "").replace(/\s+/g, " ").trim();
    if (value) return value;
  }
  return "";
}

function firstFiniteNumber(row: AnyRecord, keys: string[]): number | null {
  for (const key of keys) {
    if (row?.[key] === null || row?.[key] === undefined || row?.[key] === "") continue;
    const value = Number(String(row[key]).replace(/[$,%\s,]/g, ""));
    if (Number.isFinite(value)) return value;
  }
  return null;
}

function loadSize(value: string): string {
  const parenthetical = value.match(/\(([^)]+)\)/)?.[1]?.trim();
  return parenthetical || value.replace(/^\d+\s*/, "").trim();
}

function pricedLoadLine(label: string, size: string, price: number | null, quantity: string): string {
  if (!size && price === null) return "";
  const normalizedSize = loadSize(size);
  const quantityPrefix = quantity && quantity !== "1" ? `${quantity} × ` : "";
  const description = `${quantityPrefix}${normalizedSize || "Size unavailable"}`;
  return `${label}: ${description}${price !== null ? ` (${moneyText(price)})` : ""}.`;
}

function paymentDescription(payment: AnyRecord): string {
  const method = firstText(payment, ["method", "payment_method", "paymentMethod"]);
  if (!method) return "";
  const detail = firstText(payment, ["detail", "payment_detail", "paymentDetail"]);
  const amount = firstFiniteNumber(payment, ["amount", "payment_amount", "paymentAmount"]);
  const amountText = amount !== null ? ` (${moneyText(amount)})` : "";
  const normalizedMethod = method.toLowerCase();
  if (normalizedMethod.includes("card")) {
    const lastFour = detail.match(/(\d{4})(?!.*\d)/)?.[1] || "";
    return `Card${lastFour ? ` ending ${lastFour}` : ""}${amountText}`;
  }
  if (normalizedMethod.includes("check")) {
    const checkNumber = detail.replace(/^\s*#\s*/, "").trim();
    return `Check${checkNumber ? ` #${checkNumber}` : ""}${amountText}`;
  }
  if (normalizedMethod.includes("cash")) return `Cash${amountText}`;
  return `${method}${amountText}`;
}

export function hasFullCloseoutPayment(row: AnyRecord): boolean {
  const closeout = row?.closeout && typeof row.closeout === "object" ? row.closeout as AnyRecord : null;
  const payments = Array.isArray(closeout?.payments) ? closeout.payments : [];
  return payments.length > 0 && payments.every((payment) =>
    Boolean(payment)
    && typeof payment === "object"
    && Boolean(firstText(payment as AnyRecord, ["method", "payment_method", "paymentMethod"]))
    && firstFiniteNumber(payment as AnyRecord, ["amount", "payment_amount", "paymentAmount"]) !== null,
  );
}

export function truckCloseoutDetails(row: AnyRecord): TruckCloseoutDetails | null {
  const jobNumber = firstText(row, ["job_id", "jk_number", "job_number"]);
  if (!jobNumber) return null;
  const closeout = row?.closeout && typeof row.closeout === "object" ? row.closeout as AnyRecord : {};
  const lines = [
    pricedLoadLine(
      "Load",
      firstText(closeout, ["loadSize", "load_size"]),
      firstFiniteNumber(closeout, ["loadPrice", "load_price"]),
      firstText(closeout, ["loadQuantity", "load_quantity"]),
    ),
    pricedLoadLine(
      "Bedload",
      firstText(closeout, ["bedloadSize", "bedload_size"]),
      firstFiniteNumber(closeout, ["bedloadPrice", "bedload_price"]),
      firstText(closeout, ["bedloadQuantity", "bedload_quantity"]),
    ),
  ].filter(Boolean);

  const otherCharges = Array.isArray(closeout.otherCharges) ? closeout.otherCharges : [];
  for (const charge of otherCharges) {
    if (!charge || typeof charge !== "object") continue;
    const name = firstText(charge, ["name", "label", "description"]);
    const amount = firstFiniteNumber(charge, ["total", "amount", "unitPrice"]);
    if (name && amount !== null) lines.push(`${name}: ${moneyText(amount)}.`);
  }

  const discount = firstFiniteNumber(closeout, ["discount"]);
  if (discount !== null && discount > 0) lines.push(`Discount: ${moneyText(discount)}.`);

  const jobTotal = firstFiniteNumber(row, ["revenue", "job_total", "jobTotal"]);
  if (jobTotal !== null) lines.push(`Job total: ${moneyText(jobTotal)}.`);

  const tip = firstFiniteNumber(closeout, ["tip"])
    ?? firstFiniteNumber(row, ["tip", "tips"])
    ?? 0;
  lines.push(`Tip: ${moneyText(tip)}.`);

  const payments = (Array.isArray(closeout.payments) ? closeout.payments : [])
    .filter((payment): payment is AnyRecord => Boolean(payment) && typeof payment === "object")
    .map(paymentDescription)
    .filter(Boolean);
  if (payments.length) {
    lines.push(`Charged: ${payments.join("; ")}.`);
  } else {
    const chargedTotal = firstFiniteNumber(closeout, ["total"]);
    if (chargedTotal !== null) lines.push(`Total charged: ${moneyText(chargedTotal)}.`);
  }

  return {
    jobNumber,
    lines,
    slackText: [`:white_check_mark: ${jobNumber} closed out.`, ...lines].join(" "),
  };
}

export function readCompletedJunkwareRows(date: string): AnyRecord[] {
  const configured = String(process.env.OPSCENTER_DATA_DIR || "").trim();
  const dataDirectories = Array.from(new Set([
    ...(configured ? [configured] : []),
    path.join(process.cwd(), "data"),
    path.join(process.cwd(), "..", "opsbot", "data"),
    path.join(process.env.HOME || "", ".openclaw", "workspace", "opsbot", "data"),
  ]));

  for (const dataDirectory of dataDirectories) {
    const file = path.join(dataDirectory, "history", "junkware", `junkware_${date}_raw.json`);
    try {
      const payload = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(payload?.completed)) return payload.completed;
    } catch {
      // Try the next known OpsBot data location.
    }
  }
  return [];
}
