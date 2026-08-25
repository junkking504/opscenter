import fs from "node:fs";
import path from "node:path";
import { money as moneyText } from "@/lib/money";
import type { AnyRecord } from "@/lib/opsData";
import { formatSlackMessage, type SlackMessageField } from "@/lib/slack-message-format";

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

function paymentLine(payment: AnyRecord): string {
  const method = firstText(payment, ["method", "payment_method", "paymentMethod"]);
  if (!method) return "";
  const detail = firstText(payment, ["detail", "payment_detail", "paymentDetail"]);
  const amount = firstFiniteNumber(payment, ["amount", "payment_amount", "paymentAmount"]);
  const amountText = amount !== null ? ` (${moneyText(amount)})` : "";
  const normalizedMethod = method.toLowerCase();
  if (normalizedMethod.includes("card")) {
    const lastFour = detail.match(/(\d{4})(?!.*\d)/)?.[1] || "";
    return `Card Ending: ${lastFour || "Unavailable"}${amountText}.`;
  }
  if (normalizedMethod.includes("check")) {
    const checkNumber = detail.replace(/^\s*#\s*/, "").trim();
    return `Check: ${checkNumber ? `#${checkNumber}` : "Number unavailable"}${amountText}.`;
  }
  if (normalizedMethod.includes("cash")) return `Cash: ${amountText.trim() || "Amount unavailable"}.`;
  return `${method}: ${amountText.trim() || "Amount unavailable"}.`;
}

function closeoutChargeLabel(name: string): string {
  const normalized = name.toLowerCase().replace(/\s+/g, " ").trim();
  if (normalized.includes("surcharge") && normalized.includes("card present")) return "CC 3%";
  return name;
}

function slackFields(lines: string[]): SlackMessageField[] {
  return lines.flatMap((line) => {
    const match = line.match(/^([^:]+):\s*(.*?)\.?$/);
    return match ? [{ label: match[1], value: match[2] }] : [];
  });
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
    if (name && amount !== null) lines.push(`${closeoutChargeLabel(name)}: ${moneyText(amount)}.`);
  }

  const discount = firstFiniteNumber(closeout, ["discount"]);
  if (discount !== null && discount > 0) lines.push(`Discount: ${moneyText(discount)}.`);

  const jobTotal = firstFiniteNumber(row, ["revenue", "job_total", "jobTotal"]);
  if (jobTotal !== null) lines.push(`Total: ${moneyText(jobTotal)}.`);

  const tip = firstFiniteNumber(closeout, ["tip"])
    ?? firstFiniteNumber(row, ["tip", "tips"])
    ?? 0;
  lines.push(`Tips: ${moneyText(tip)}.`);

  const payments = (Array.isArray(closeout.payments) ? closeout.payments : [])
    .filter((payment): payment is AnyRecord => Boolean(payment) && typeof payment === "object")
    .map(paymentLine)
    .filter(Boolean);
  if (payments.length) {
    lines.push(...payments);
  } else {
    const chargedTotal = firstFiniteNumber(closeout, ["total"]);
    if (chargedTotal !== null) lines.push(`Total charged: ${moneyText(chargedTotal)}.`);
  }

  return {
    jobNumber,
    lines,
    slackText: formatSlackMessage({
      icon: ":white_check_mark:",
      title: "Job Closed",
      fields: [{ label: "Job", value: jobNumber }, ...slackFields(lines)],
    }),
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
