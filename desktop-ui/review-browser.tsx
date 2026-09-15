import { useMemo, useRef, useState } from 'react';
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Search, Star, Users } from 'lucide-react';
import { Button } from './components/ui/button';
import { commercialDate, type Review } from './lib/commercial-contract';
import { browseReviews, defaultReviewFilters, isLowReview, recordedReviewCrew, type ReviewFilters } from './lib/review-browser';
import './review-browser.css';

type Props = {
  reviews: Review[];
  canAssign: boolean;
  busy: boolean;
  selections: Record<string, string>;
  onSelect: (id: string, appointment: string) => void;
  onConfirm: (id: string) => void;
};

export function ReviewBrowser({ reviews, canAssign, busy, selections, onSelect, onConfirm }: Props) {
  const [filters, setFilters] = useState<ReviewFilters>(defaultReviewFilters);
  const [page, setPage] = useState(1);
  const resultsHeading = useRef<HTMLHeadingElement>(null);
  const result = useMemo(() => browseReviews(reviews, filters, page), [reviews, filters, page]);
  const locations = useMemo(() => [...new Set(reviews.map(review => review.location))].sort(), [reviews]);
  const updateFilters = (next: Partial<ReviewFilters>) => { setFilters(current => ({ ...current, ...next })); setPage(1); };
  const reset = () => { setFilters(defaultReviewFilters); setPage(1); };
  const changePage = (next: number) => { setPage(next); resultsHeading.current?.focus(); resultsHeading.current?.scrollIntoView({ block: 'start' }); };
  const queues = [
    { key: 'all', label: 'All reviews', count: reviews.length },
    { key: 'low', label: 'Low ratings · 1–3 stars', count: reviews.filter(isLowReview).length },
    { key: 'response', label: 'Need response', count: reviews.filter(review => review.needsResponse === true).length },
    { key: 'unassigned', label: 'Need attribution', count: reviews.filter(review => review.attribution?.status !== 'matched').length },
  ] as const;
  const pagination = <nav className="review-pagination" aria-label="Review pages">
    <span>Page {result.page} of {result.pageCount}</span>
    <Button variant="outline" size="sm" disabled={result.page <= 1} onClick={() => changePage(result.page - 1)} aria-label="Previous review page"><ChevronLeft size={15} />Previous</Button>
    <Button variant="outline" size="sm" disabled={result.page >= result.pageCount} onClick={() => changePage(result.page + 1)} aria-label="Next review page">Next<ChevronRight size={15} /></Button>
  </nav>;
  return <section className="review-browser" aria-label="Customer reviews">
    <header className="review-browser-heading"><div><span className="section-kicker">Google reviews via Podium</span><h2>Customer reviews</h2><p>Read feedback, find reviews that need attention, and see the crew behind each job.</p></div><span>{locations.length} locations · Latest 100 per location</span></header>
    <div className="review-queues" aria-label="Review quick filters">{queues.map(queue => <button key={queue.key} type="button" aria-pressed={filters.queue === queue.key} className={queue.key === 'low' ? 'review-queue-low' : ''} onClick={() => updateFilters({ queue: queue.key, rating: '' })}><span>{queue.label}</span><strong>{queue.count}</strong></button>)}</div>
    <div className="review-browser-filters">
      <label className="review-search"><span>Search reviews</span><div><Search size={16} aria-hidden="true" /><input type="search" value={filters.query} placeholder="Reviewer, feedback, JK number or crew" onChange={event => updateFilters({ query: event.target.value })} /></div></label>
      <label><span>Location</span><select value={filters.location} onChange={event => updateFilters({ location: event.target.value })}><option value="">All locations</option>{locations.map(location => <option key={location}>{location}</option>)}</select></label>
      <label><span>Rating</span><select value={filters.rating} onChange={event => updateFilters({ rating: event.target.value })}><option value="">All ratings</option>{[1, 2, 3, 4, 5].map(rating => <option key={rating} value={rating}>{rating} {rating === 1 ? 'star' : 'stars'}</option>)}</select></label>
      <label><span>Sort</span><select value={filters.order} onChange={event => updateFilters({ order: event.target.value as ReviewFilters['order'] })}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
      <Button variant="ghost" size="sm" onClick={reset}>Reset filters</Button>
    </div>
    <div className="review-results-heading"><h3 ref={resultsHeading} tabIndex={-1} aria-live="polite">{result.start}–{result.end} of {result.total} matching reviews</h3>{pagination}</div>
    <div className="review-browser-list">{result.rows.map(review => {
      const attributed = review.attribution?.status === 'matched';
      const jk = review.attribution?.jkNumber;
      const crew = recordedReviewCrew(review);
      const selected = selections[review.id] ?? review.attribution?.appointmentId ?? '';
      const selectedJk = review.candidates.find(candidate => candidate.appointmentId === selected)?.jkNumber
        || (selected === review.attribution?.appointmentId ? jk : undefined);
      return <article key={review.id} className={isLowReview(review) ? 'review-row review-row-low' : 'review-row'} aria-label={`${review.customer}, ${review.stars} stars`}>
        <div className="review-feedback">
          <header><div className="review-rating"><Star size={15} fill="currentColor" aria-hidden="true" /><strong>{review.stars}/5</strong></div><h3>{review.customer}</h3>{isLowReview(review) && <span className="review-low-label"><AlertTriangle size={13} />Low rating</span>}{review.needsResponse === true && <span className="review-response-label">Needs response</span>}</header>
          <div className="review-meta">{review.location} · {commercialDate(review.createdAt)}</div>
          {review.excerpt.length > 320 ? <details className="review-full-text"><summary>{review.excerpt.slice(0, 240)}… <span>Read full review</span></summary><p>{review.excerpt}</p></details> : <p>{review.excerpt || 'Rating only — no written review.'}</p>}
          {/^https?:\/\//i.test(review.sourceUrl) && <a href={review.sourceUrl} target="_blank" rel="noreferrer">Open original review ↗</a>}
        </div>
        <aside className="review-assignment" aria-label={`Appointment and crew for ${review.customer}`}>
          {attributed ? <><div className="review-job"><Check size={15} /><span>Attributed to {jk ? <a href={`/schedule?job=${encodeURIComponent(jk)}`}>{jk}</a> : 'completed appointment'}</span></div><div className="review-crew"><Users size={15} /><div><strong>Recorded crew</strong><span>{crew.length ? crew.join(' · ') : 'Crew not recorded'}</span></div></div></> : <div className="review-unassigned">No appointment attributed</div>}
          <details className="review-assignment-editor"><summary>{attributed ? 'Change attribution' : 'Match to appointment'}</summary>
            <p>Confirm a completed JunkWare appointment before crediting this review.</p>
            <label><span>Completed appointment ID</span><input disabled={!canAssign || busy} value={selected} onChange={event => onSelect(review.id, event.target.value)} list={`review-${review.id}`} placeholder="Select or enter appointment ID" /></label>
            <datalist id={`review-${review.id}`}>{review.candidates.map(candidate => <option key={candidate.appointmentId} value={candidate.appointmentId}>{candidate.label}</option>)}</datalist>
            {selected && <a className="review-proposed-link" href={`/schedule?job=${encodeURIComponent(selectedJk || selected)}`} target="_blank" rel="noreferrer">Review {selectedJk || 'appointment'} ↗</a>}
            <small>{review.candidates.length} name-match {review.candidates.length === 1 ? 'suggestion' : 'suggestions'} · Confirmation required</small>
            <Button disabled={busy || !canAssign || !selected} size="sm" onClick={() => onConfirm(review.id)}>Confirm / Reassign Match</Button>
          </details>
        </aside>
      </article>;
    })}</div>
    {!result.total && <div className="review-browser-empty"><strong>No reviews match these filters.</strong><p>Try another name, rating or location. Reviews not yet supplied by Podium will not appear here.</p><Button variant="outline" size="sm" onClick={reset}>Show all reviews</Button></div>}
    <footer className="review-browser-footer"><span>Counts reflect the loaded reviews. “Needs response” is reported by Podium.</span>{pagination}</footer>
  </section>;
}
