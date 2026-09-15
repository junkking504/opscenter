import type { Review } from './commercial-contract';

export type ReviewFilters = {
  query: string;
  location: string;
  rating: string;
  queue: 'all' | 'low' | 'response' | 'unassigned';
  order: 'newest' | 'oldest';
};
export const defaultReviewFilters: ReviewFilters = { query: '', location: '', rating: '', queue: 'all', order: 'newest' };
export const isLowReview = (review: Review) => review.stars > 0 && review.stars <= 3;
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
    if (filters.queue === 'low' && !isLowReview(review)) return false;
    if (filters.queue === 'response' && review.needsResponse !== true) return false;
    if (filters.queue === 'unassigned' && review.attribution?.status === 'matched') return false;
    return !query || [review.customer, review.excerpt, review.location, review.attribution?.jkNumber,
      review.attribution?.appointmentId, ...recordedReviewCrew(review)].join(' ').toLocaleLowerCase().includes(query);
  }).sort((a, b) => {
    const delta = (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0);
    return (filters.order === 'oldest' ? -delta : delta) || a.id.localeCompare(b.id);
  });
  const pageCount = Math.max(1, Math.ceil(matching.length / 20));
  const page = Math.max(1, Math.min(pageCount, requestedPage));
  return { rows: matching.slice((page - 1) * 20, page * 20), total: matching.length, page, pageCount,
    start: matching.length ? (page - 1) * 20 + 1 : 0, end: Math.min(page * 20, matching.length) };
}
