import fs from 'node:fs';
import path from 'node:path';

export type WexFuelTransaction = {
  transactionId: string;
  transactionDate: string;
  transactionTime: string;
  postedDate: string;
  truck: string;
  driver: string;
  driverPromptId: string;
  cardLastFive: string;
  units: number | null;
  unitOfMeasure: string;
  gallons: number | null;
  unitCost: number | null;
  totalFuelCost: number | null;
  totalNonFuelCost: number | null;
  netCost: number;
  product: string;
  productDescription: string;
  merchant: string;
  city: string;
  state: string;
  postalCode: string;
  odometer: number | null;
  ticketNumber: string;
  status: 'posted';
};

export type WexFuelSnapshot = {
  schemaVersion: 1;
  source: 'WEXOnline posted transaction CSV';
  importedAt: string;
  sourceFile: string;
  sourceFileModifiedAt: string;
  coverageFrom: string | null;
  coverageThrough: string | null;
  transactionCount: number;
  transactions: WexFuelTransaction[];
};

export type WexFuelFinanceData = {
  available: boolean;
  status: 'available' | 'missing' | 'invalid';
  importedAt: string | null;
  sourceFileModifiedAt: string | null;
  coverageFrom: string | null;
  coverageThrough: string | null;
  transactionCount: number;
  selectedDate: { count: number; gallons: number; netCost: number };
  month: { count: number; gallons: number; netCost: number };
  transactions: WexFuelTransaction[];
};

const requiredHeaders = [
  'Transaction Date', 'Transaction Time', 'Post Date', 'Card Number', 'Trans ID',
  'Emboss Line 2', 'Custom Vehicle/Asset ID', 'Units', 'Unit of Measure', 'Unit Cost',
  'Total Fuel Cost', 'Total Non-Fuel Cost', 'Net Cost', 'Product', 'Product Description',
  'Merchant Name', 'Merchant City', 'Merchant State / Province', 'Merchant Postal Code',
  'Current Odometer', 'Driver Last Name', 'Driver First Name', 'Transaction Ticket Number',
  'Driver Prompt ID',
] as const;

export function wexFuelDirectory(): string {
  if (process.env.WEX_FUEL_DATA_DIR) return process.env.WEX_FUEL_DATA_DIR;
  const opsRoot = process.env.OPSCENTER_DATA_DIR || process.env.OPSBOT_DATA_DIR
    || path.join(process.env.HOME || '', '.openclaw', 'workspace', 'opsbot', 'data');
  return path.join(opsRoot, 'integrations', 'wex-fuel');
}

export function wexFuelSnapshotFile(): string {
  return path.join(wexFuelDirectory(), 'posted-transactions.json');
}

export function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else field += character;
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ',') { row.push(field); field = ''; }
    else if (character === '\n') { row.push(field.replace(/\r$/, '')); rows.push(row); row = []; field = ''; }
    else field += character;
  }
  if (quoted) throw new Error('WEX CSV contains an unterminated quoted field.');
  if (field || row.length) { row.push(field.replace(/\r$/, '')); rows.push(row); }
  return rows.filter(values => values.some(value => value !== ''));
}

function isoDate(value: string, label: string): string {
  const match = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) throw new Error(`WEX ${label} is invalid.`);
  const [, month, day, year] = match;
  const result = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  const parsed = new Date(`${result}T12:00:00Z`);
  if (Number.isNaN(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== result) throw new Error(`WEX ${label} is invalid.`);
  return result;
}

function decimal(value: string, label: string, required = false): number | null {
  const cleaned = value.trim().replace(/^\$/, '').replaceAll(',', '');
  if (!cleaned) {
    if (required) throw new Error(`WEX ${label} is missing.`);
    return null;
  }
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) throw new Error(`WEX ${label} is invalid.`);
  return parsed;
}

export function parseWexPostedCsv(input: string): WexFuelTransaction[] {
  const rows = parseCsv(input.replace(/^\uFEFF/, ''));
  if (rows.length < 2) throw new Error('WEX CSV has no posted transaction rows.');
  const headers = rows[0];
  for (const header of requiredHeaders) if (!headers.includes(header)) throw new Error(`WEX CSV is missing ${header}.`);
  const index = new Map(headers.map((header, position) => [header, position]));
  const value = (row: string[], header: string) => String(row[index.get(header)!] || '').trim();
  const transactions = rows.slice(1).map((row, rowIndex): WexFuelTransaction => {
    if (row.length > headers.length) throw new Error(`WEX CSV row ${rowIndex + 2} has unexpected columns.`);
    const transactionId = value(row, 'Trans ID');
    if (!transactionId) throw new Error(`WEX CSV row ${rowIndex + 2} has no transaction ID.`);
    const units = decimal(value(row, 'Units'), 'units');
    const unitOfMeasure = value(row, 'Unit of Measure');
    const driver = [value(row, 'Driver First Name'), value(row, 'Driver Middle Name'), value(row, 'Driver Last Name')].filter(Boolean).join(' ');
    return {
      transactionId,
      transactionDate: isoDate(value(row, 'Transaction Date'), 'transaction date'),
      transactionTime: value(row, 'Transaction Time'),
      postedDate: isoDate(value(row, 'Post Date'), 'post date'),
      truck: value(row, 'Custom Vehicle/Asset ID') || value(row, 'Emboss Line 2') || 'Unassigned',
      driver: driver || 'Unassigned',
      driverPromptId: value(row, 'Driver Prompt ID'),
      cardLastFive: value(row, 'Card Number').replace(/\D/g, '').slice(-5),
      units,
      unitOfMeasure,
      gallons: unitOfMeasure.toUpperCase() === 'GA' ? units : null,
      unitCost: decimal(value(row, 'Unit Cost'), 'unit cost'),
      totalFuelCost: decimal(value(row, 'Total Fuel Cost'), 'total fuel cost'),
      totalNonFuelCost: decimal(value(row, 'Total Non-Fuel Cost'), 'total non-fuel cost'),
      netCost: decimal(value(row, 'Net Cost'), 'net cost', true)!,
      product: value(row, 'Product'),
      productDescription: value(row, 'Product Description'),
      merchant: value(row, 'Merchant Name') || value(row, 'Merchant (Brand)'),
      city: value(row, 'Merchant City'),
      state: value(row, 'Merchant State / Province'),
      postalCode: value(row, 'Merchant Postal Code'),
      odometer: decimal(value(row, 'Current Odometer'), 'odometer'),
      ticketNumber: value(row, 'Transaction Ticket Number'),
      status: 'posted',
    };
  });
  const seen = new Map<string, string>();
  for (const transaction of transactions) {
    const fingerprint = JSON.stringify(transaction);
    const prior = seen.get(transaction.transactionId);
    if (prior && prior !== fingerprint) throw new Error(`WEX transaction ${transaction.transactionId} appears with conflicting values.`);
    seen.set(transaction.transactionId, fingerprint);
  }
  return [...new Map(transactions.map(transaction => [transaction.transactionId, transaction])).values()]
    .sort((left, right) => `${right.transactionDate} ${right.transactionTime}`.localeCompare(`${left.transactionDate} ${left.transactionTime}`));
}

export function importWexPostedCsv(sourceFile: string, outputFile = wexFuelSnapshotFile(), now = new Date()): WexFuelSnapshot {
  const incoming = parseWexPostedCsv(fs.readFileSync(sourceFile, 'utf8'));
  fs.mkdirSync(path.dirname(outputFile), { recursive: true, mode: 0o700 });
  const lock = `${outputFile}.import-lock`;
  const descriptor = fs.openSync(lock, 'wx', 0o600);
  try {
  let prior: WexFuelTransaction[] = [];
  try {
    const saved = JSON.parse(fs.readFileSync(outputFile, 'utf8'));
    if (!validSnapshot(saved)) throw new Error('Existing WEX snapshot is invalid; recover it before importing.');
    prior = saved.transactions;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const merged = new Map<string, WexFuelTransaction>();
  for (const transaction of [...prior, ...incoming]) {
    const existing = merged.get(transaction.transactionId);
    if (existing && JSON.stringify(existing) !== JSON.stringify(transaction)) throw new Error(`WEX transaction ${transaction.transactionId} conflicts with saved evidence; review both exports.`);
    merged.set(transaction.transactionId, transaction);
  }
  const transactions = [...merged.values()].sort((left, right) => `${right.transactionDate} ${right.transactionTime}`.localeCompare(`${left.transactionDate} ${left.transactionTime}`));
  const dates = transactions.map(transaction => transaction.transactionDate).sort();
  const snapshot: WexFuelSnapshot = {
    schemaVersion: 1,
    source: 'WEXOnline posted transaction CSV',
    importedAt: now.toISOString(),
    sourceFile: path.basename(sourceFile),
    sourceFileModifiedAt: fs.statSync(sourceFile).mtime.toISOString(),
    coverageFrom: dates[0] || null,
    coverageThrough: dates.at(-1) || null,
    transactionCount: transactions.length,
    transactions,
  };
  fs.mkdirSync(path.dirname(outputFile), { recursive: true, mode: 0o700 });
  const temporary = `${outputFile}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(snapshot, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, outputFile);
  fs.chmodSync(outputFile, 0o600);
  return snapshot;
  } finally {
    fs.closeSync(descriptor);
    fs.unlinkSync(lock);
  }
}

function validSnapshot(value: unknown): value is WexFuelSnapshot {
  const snapshot = value as WexFuelSnapshot;
  return snapshot?.schemaVersion === 1 && snapshot.source === 'WEXOnline posted transaction CSV'
    && typeof snapshot.importedAt === 'string' && Array.isArray(snapshot.transactions)
    && snapshot.transactions.every(transaction => transaction?.status === 'posted' && typeof transaction.transactionId === 'string' && Number.isFinite(transaction.netCost));
}

const totals = (transactions: WexFuelTransaction[]) => ({
  count: transactions.length,
  gallons: Number(transactions.reduce((sum, transaction) => sum + (transaction.gallons || 0), 0).toFixed(3)),
  netCost: Number(transactions.reduce((sum, transaction) => sum + transaction.netCost, 0).toFixed(2)),
});

export function readWexFuelFinance(date: string, snapshotFile = wexFuelSnapshotFile()): WexFuelFinanceData {
  const unavailable = (status: 'missing' | 'invalid'): WexFuelFinanceData => ({
    available: false, status, importedAt: null, sourceFileModifiedAt: null, coverageFrom: null,
    coverageThrough: null, transactionCount: 0, selectedDate: totals([]), month: totals([]), transactions: [],
  });
  try {
    const snapshot = JSON.parse(fs.readFileSync(snapshotFile, 'utf8'));
    if (!validSnapshot(snapshot)) return unavailable('invalid');
    const selected = snapshot.transactions.filter(transaction => transaction.transactionDate === date);
    const month = snapshot.transactions.filter(transaction => transaction.transactionDate.startsWith(date.slice(0, 7)));
    return {
      available: true,
      status: 'available',
      importedAt: snapshot.importedAt,
      sourceFileModifiedAt: snapshot.sourceFileModifiedAt,
      coverageFrom: snapshot.coverageFrom,
      coverageThrough: snapshot.coverageThrough,
      transactionCount: snapshot.transactionCount,
      selectedDate: totals(selected),
      month: totals(month),
      transactions: selected,
    };
  } catch (error) {
    return unavailable((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'missing' : 'invalid');
  }
}
