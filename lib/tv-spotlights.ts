import fs from 'node:fs';
import path from 'node:path';
import { buildPodiumGoogleReviewsView } from './podium-reviews';
import { readDesktopKrewe } from './desktop-krewe';
import { addDays, chicagoDateKey } from './report-dates';
import { verifiedAppointmentMedia } from './verified-job-photos';
import type { InteractiveOpsRole } from './ops-roles';
import { tvPersonalRecords, type TvCard, type TvSpotlights } from '../desktop-ui/lib/tv-spotlights';

// Curated public-facing text only. This file never reads employee birth dates or payroll notes.
export function curatedTvCards(value: unknown, date: string): TvCard[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((row, index) => {
    if (!row || typeof row !== 'object') return [];
    const item = row as Record<string, unknown>;
    const kinds = ['birthday', 'anniversary', 'welcome', 'contest', 'win'];
    const text = (key: string, max: number) => typeof item[key] === 'string' ? item[key].trim().slice(0, max) : '';
    const start = text('start', 10), end = text('end', 10);
    const valid = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(day)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0,10) === day;
    const kind = text('kind', 20);
    if (!kinds.includes(kind) || !valid(start) || !valid(end) || start > date || end < date || start > end || !text('title', 100) || !text('body', 500)) return [];
    // Only existing JunkWare media belonging to the curated appointment is accepted.
    const photo = (key: string) => verifiedAppointmentMedia([text(key, 500)], text('appointmentId', 12))[0]?.url;
    const before = photo('before'), after = photo('after');
    return [{ id: `curated-${index}`, kind: kind as TvCard['kind'], title: text('title', 100), body: text('body', 500), credit: text('credit', 160), detail: `${start}–${end}`, ...(before && after ? { before, after } : {}) }];
  });
}

export function readTvSpotlights(date: string, role: InteractiveOpsRole): TvSpotlights {
  const result: TvSpotlights = { date, generatedAt: new Date().toISOString(), reviewsAt: null, historyAt: null, cards: [], notices: [] };
  try {
    const reviews = buildPodiumGoogleReviewsView();
    result.reviewsAt = reviews.snapshot?.fetchedAt || null;
    if (!reviews.available) result.notices.push('Customer review source unavailable.');
    else result.cards.push(...reviews.locations.flatMap(location => location.reviews.map(review => ({...review, location: location.name}))).sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).filter(review => review.rating === 5 && review.body.trim() && Number.isFinite(Date.parse(review.createdAt)) && chicagoDateKey(new Date(review.createdAt)) >= addDays(date, -30) && chicagoDateKey(new Date(review.createdAt)) <= date).map(review => ({ id: `review-${review.uid}`, kind: 'review' as const, title: 'Five stars for the crew!', body: review.body.slice(0, 500), credit: review.attribution?.status === 'matched' && review.attribution.crew?.length ? review.attribution.crew.join(' & ') : 'Team shout-out · crew attribution unavailable', detail: `${review.location} · ${chicagoDateKey(new Date(review.createdAt))}` })).slice(0, 12));
  } catch { result.notices.push('Customer review source unavailable.'); }
  try {
    const history = readDesktopKrewe(date, 'monthly', role, false);
    result.historyAt = history.sourceUpdatedAt;
    result.cards.push(...tvPersonalRecords(history, date).slice(0, 10));
    if (history.missingDates.length) result.notices.push('Personal records paused: month-to-date history is incomplete.');
  } catch { result.notices.push('Personal-record history unavailable.'); }
  try {
    const filename = path.join(process.env.OPSBOT_DATA_DIR || path.join(process.cwd(), 'data'), 'shop-tv', 'celebrations.json');
    if (fs.statSync(filename).size > 100_000) throw new Error('Oversized content');
    result.cards.push(...curatedTvCards(JSON.parse(fs.readFileSync(filename, 'utf8')), date));
  } catch (error) { result.notices.push((error as NodeJS.ErrnoException).code === 'ENOENT' ? 'Birthdays, anniversaries, welcomes, photo wins and contests appear when scheduled.' : 'Scheduled celebration content unavailable.'); }
  return result;
}
