import { browseLeads, defaultLeadFilters, type LeadFilters } from './lead-browser';
import { browseReviews, defaultReviewFilters, type ReviewFilters } from './review-browser';
import type { MarketingData, MarketingView } from './commercial-contract';
export type CampaignShortcut = 'followup' | 'contact' | 'response' | 'match';
export const campaignShortcutFilters: Record<CampaignShortcut, { label: string; view: MarketingView; leads?: LeadFilters; reviews?: ReviewFilters }> = {
  followup: { label: 'Follow Up', view: 'overview', leads: { ...defaultLeadFilters, queue: 'recover' } },
  contact: { label: 'No Contact', view: 'overview', leads: { ...defaultLeadFilters, queue: 'all', contact: 'uncontacted' } },
  response: { label: 'Review Response', view: 'reviews', reviews: { ...defaultReviewFilters, queue: 'response' } },
  match: { label: 'Review Match', view: 'reviews', reviews: { ...defaultReviewFilters, queue: 'unassigned' } },
};
export function campaignShortcutCount(data: MarketingData, key: CampaignShortcut): number | null {
  const filter = campaignShortcutFilters[key];
  if (filter.leads) return data.available ? browseLeads(data.leads, filter.leads).total : null;
  return data.reviewAvailable ? browseReviews(data.reviews, filter.reviews!).total : null;
}
