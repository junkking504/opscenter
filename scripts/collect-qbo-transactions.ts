import fs from "fs";
import os from "os";
import path from "path";
import { getQboConfig } from "../lib/qbo-config";
import { getQboCompanyInfo, listQboCreditCardTransactions } from "../lib/qbo-api";

const TIME_ZONE = "America/Chicago";
const outputRoot = path.join(
  os.homedir(),
  ".openclaw",
  "workspace",
  "opsbot",
  "data",
  "imports",
  "intuit_merchant_center",
  "junk_krewe",
);

function argument(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || null : null;
}

function chicagoToday(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

function validateDate(value: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(new Date(`${value}T12:00:00Z`).getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return value;
}

function csvCell(value: unknown): string {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function atomicWrite(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, content, { encoding: "utf8", mode: 0o600 });
  fs.renameSync(temporary, file);
  fs.chmodSync(file, 0o600);
}

function companyName(company: Record<string, unknown>): string {
  return String(company.CompanyName || company.LegalName || "").trim();
}

function normalizedName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

async function main() {
  const date = validateDate(argument("--date") || chicagoToday());
  const outputDirectory = path.resolve(argument("--output-dir") || outputRoot);
  const config = getQboConfig();
  if (!config.ready) {
    throw new Error(`QBO API is not configured: ${config.missing.join(", ")}`);
  }

  const company = await getQboCompanyInfo(config.environment);
  const connectedCompany = companyName(company);
  if (!connectedCompany) throw new Error("QBO did not return a company name for the connected realm.");
  if (
    config.expectedCompanyName
    && normalizedName(connectedCompany) !== normalizedName(config.expectedCompanyName)
  ) {
    throw new Error(`Connected QBO company does not match QBO_EXPECTED_COMPANY_NAME (${connectedCompany}).`);
  }

  const transactions = await listQboCreditCardTransactions(config.environment, date);
  const headers = [
    "Trans ID",
    "Date",
    "Cardholder Name",
    "Card No",
    "Type",
    "Status",
    "Amount",
    "Fee",
    "Net",
    "Merchant Account Name",
    "Payment Method",
  ];
  const rows = transactions.map((transaction) => [
    transaction.transactionId,
    transaction.date,
    transaction.customerName,
    transaction.cardLastFour ? `xxxxxxxxxxxx${transaction.cardLastFour}` : "",
    transaction.transactionType,
    transaction.status,
    transaction.amount.toFixed(2),
    transaction.fee.toFixed(2),
    transaction.net.toFixed(2),
    connectedCompany,
    transaction.paymentMethod,
  ]);
  const csv = [headers, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
  const csvPath = path.join(outputDirectory, `transactions-${date}.csv`);
  const metadataPath = path.join(outputDirectory, `transactions-${date}.json`);
  const collectedAt = new Date().toISOString();
  const total = Number(transactions.reduce((sum, transaction) => sum + transaction.amount, 0).toFixed(2));
  atomicWrite(csvPath, csv);
  atomicWrite(metadataPath, `${JSON.stringify({
    date,
    collected_at: collectedAt,
    account_name: connectedCompany,
    qbo_company_name: connectedCompany,
    transaction_count: transactions.length,
    transaction_total: total,
    source: "https://quickbooks.api.intuit.com/v3/company/{realmId}/query",
    collector: "qbo-accounting-api",
    entities: ["Payment", "SalesReceipt"],
  }, null, 2)}\n`);

  process.stdout.write(`${JSON.stringify({
    status: "ok",
    date,
    output: csvPath,
    collected_at: collectedAt,
    qbo_company_name: connectedCompany,
    transaction_count: transactions.length,
    transaction_total: total,
    source: "qbo-accounting-api",
  })}\n`);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Unknown QBO collection error.";
  process.stderr.write(`${JSON.stringify({ status: "error", error: message })}\n`);
  process.exitCode = 1;
});
