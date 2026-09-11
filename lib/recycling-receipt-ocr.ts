import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import type { RecyclingReceiptLine } from '../desktop-ui/lib/recycling-receipts';
export type OcrBox = { text: string; confidence: number; x: number; y: number; width: number; height: number };
const run = promisify(execFile);
export async function recognizeRecyclingReceipt(file: string): Promise<OcrBox[]> {
  if (process.platform !== 'darwin') throw new Error('Local receipt recognition requires Mission Control macOS.');
  const { stdout } = await run('/usr/bin/swift', [path.join(process.cwd(), 'scripts/recycling-receipt-ocr.swift'), file], { timeout: 60_000, maxBuffer: 2_000_000 });
  return JSON.parse(stdout);
}
const money = (text: string) => { const match = text.match(/^\$?([\d,]+\.\d{2})$/); return match ? Number(match[1].replaceAll(',', '')) : null; };
export function parseRecyclingOcr(boxes: OcrBox[]) {
  const text = boxes.map(box => box.text).join('\n');
  const rows: RecyclingReceiptLine[] = [], warnings = ['Check all receipt pages and extracted fields against the photos before recording.'];
  const dateBoxes = boxes.filter(box => /^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(box.text.trim()) && box.x < .3).sort((a,b) => b.y-a.y);
  const totalHeader = boxes.find(box => /^total$/i.test(box.text.trim()));
  const netHeader = boxes.find(box => /^net$/i.test(box.text.trim()));
  const rateHeader = boxes.find(box => /^rate$/i.test(box.text.trim()));
  const grossHeader = boxes.find(box => /^gross$/i.test(box.text.trim()));
  const ticketHeader = boxes.find(box => /^ticket\b/i.test(box.text.trim()));
  const amountBoxes = totalHeader && dateBoxes.length ? boxes.filter(box => box.x >= totalHeader.x - .03 && money(box.text) != null && box.y < totalHeader.y && box.y > dateBoxes.at(-1)!.y - .025).sort((a,b) => b.y-a.y) : [];
  const alignedAmounts = amountBoxes.length === dateBoxes.length;
  if (!alignedAmounts) warnings.push('Amount and date columns do not align; missing amounts need manual review.');
  dateBoxes.forEach((anchor, index) => {
    const [month, day, rawYear] = anchor.text.split('/'); const year = rawYear.length === 2 ? `20${rawYear}` : rawYear;
    const date = `${year}-${month.padStart(2,'0')}-${day.padStart(2,'0')}`;
    const ticketBox = ticketHeader ? boxes.filter(box => box.x >= ticketHeader.x - .025 && box.x < ticketHeader.x + .055 && Math.abs(box.y-anchor.y) < .007).sort((a,b) => Math.abs(a.y-anchor.y)-Math.abs(b.y-anchor.y))[0] : undefined;
    const ticket = ticketBox?.text.match(/^\d{5,12}\b/)?.[0] || '';
    const rowBottom = index + 1 < dateBoxes.length ? (anchor.y + dateBoxes[index+1].y)/2 : anchor.y-.006;
    const material = boxes.filter(box => ticketHeader && grossHeader && box.x >= ticketHeader.x + .04 && box.x < grossHeader.x-.02 && box.y <= anchor.y+.006 && box.y >= rowBottom).sort((a,b) => a.x-b.x).map(box => box.text).join(' ').trim() || 'Metal';
    const amountBox = alignedAmounts ? amountBoxes[index] : undefined;
    // Interpolate the photographed row slope from its date to its amount.
    // Comparing raw y positions alone can take the preceding row's weight.
    const rowDistance = (box: OcrBox) => {
      if (!amountBox) return Infinity;
      const left = anchor.x + anchor.width / 2, right = amountBox.x + amountBox.width / 2;
      const fraction = (box.x + box.width / 2 - left) / (right - left);
      return Math.abs(box.y - (anchor.y + fraction * (amountBox.y - anchor.y)));
    };
    const netBoxes = netHeader && rateHeader && amountBox ? boxes.filter(box => box.x >= netHeader.x-.025 && box.x < rateHeader.x-.012 && /^\d[\d,]*(?:\.\d+)?(?:\s*LB)?$/i.test(box.text) && rowDistance(box) < .004).sort((a,b) => rowDistance(a)-rowDistance(b)) : [];
    const weightLb = netBoxes[0] ? Number(netBoxes[0].text.replace(/\s*LB/i, '').replaceAll(',', '')) : null;
    rows.push({ date, ticket, material, weightLb, amount: amountBox ? money(amountBox.text) : null });
  });
  const paymentHeader = boxes.find(box => /payment breakdown/i.test(box.text));
  const paymentAmounts = paymentHeader ? boxes.filter(box => box.y < paymentHeader.y && money(box.text) != null).map(box => money(box.text)!) : [];
  const total = paymentAmounts.length === 1 ? paymentAmounts[0] : null;
  const yard = boxes.find(box => /(?:southern|metal|scrap).*recycl|recycl.*(?:llc|inc)/i.test(box.text))?.text || '';
  if (!rows.length) warnings.push('No supported date/ticket table found. Enter the receipt lines manually using the photos.');
  if (rows.some(row => !row.ticket || row.weightLb == null || row.amount == null)) warnings.push('Some ticket numbers, weights, or amounts were unclear.');
  if (boxes.some(box => box.confidence < .5)) warnings.push('The photo contains low-confidence text.');
  return { text, rows, total, yard, warnings };
}
