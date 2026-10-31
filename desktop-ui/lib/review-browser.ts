import type { Review } from './commercial-contract';

export type ReviewFilters = {
  query: string;
  location: string;
  rating: string;
  queue: 'all' | 'low' | 'response' | 'unassigned' | 'check';
  order: 'newest' | 'oldest';
};
export const defaultReviewFilters: ReviewFilters = { query: '', location: '', rating: '', queue: 'all', order: 'newest' };
export const isLowReview = (review: Review) => review.stars > 0 && review.stars <= 3;
// Stored evidence is authoritative for an auto-match; suggestions can change later.
export function reviewMatchStrength(review: Review): 'Strong' | 'Weak' | null {
  if (review.attribution?.status !== 'matched') return null;
  if (review.attribution.matchMethod !== 'inferred_high') return 'Strong';
  const reasons = review.attribution.reasons ?? review.candidates?.find(candidate => candidate.appointmentId === review.attribution?.appointmentId)?.reasons ?? [];
  if (!reasons.length) return null;
  return reasons.some(reason => /email handle/i.test(reason)) ? 'Weak' : 'Strong';
}
export function recordedReviewCrew(review: Review): string[] {
  return review.attribution?.status === 'matched'
    ? [...new Set((review.attribution.crew ?? []).map(name => name.trim()).filter(Boolean))]
    : [];
}
export function browseReviews(reviews: Review[], filters: ReviewFilters, requestedPage = 1) {
  const query = filters.query.trim().toLocaleLowerCase();
  const matching = reviews.filter(review => {
    if (filters.location && review.location !== filters.location) return false;
    if (filters.rating && review.stars !== Number(filters.rating)) return false;
    if (filters.queue === 'check' && reviewMatchStrength(review) !== 'Weak') return false;
    if (filters.queue === 'low' && !isLowReview(review)) return false;
    if (filters.queue === 'response' && review.needsResponse !== true) return false;
    if (filters.queue === 'unassigned' && review.attribution?.status === 'matched') return false;
    return !query || [review.customer, review.excerpt, review.location, review.attribution?.jkNumber,
      review.attribution?.appointmentId, ...recordedReviewCrew(review)].join(' ').toLocaleLowerCase().includes(query);
  }).sort((a, b) => {
    const weakFirst = filters.queue === 'check' ? Number(reviewMatchStrength(b) === 'Weak') - Number(reviewMatchStrength(a) === 'Weak') : 0;
    if (weakFirst) return weakFirst;
    const delta = (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
    return (filters.order === 'oldest' ? -delta : delta) || a.id.localeCompare(b.id);
  });
  const pageCount = Math.max(1, Math.ceil(matching.length / 20));
  const page = Math.max(1, Math.min(pageCount, requestedPage));
  return { rows: matching.slice((page - 1) * 20, page * 20), total: matching.length, page, pageCount,
    start: matching.length ? (page - 1) * 20 + 1 : 0, end: Math.min(page * 20, matching.length) };
}
