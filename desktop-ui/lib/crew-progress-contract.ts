export type CrewStep = {
  label: string;
  state: 'complete' | 'next' | 'pending' | 'missing' | 'unknown' | 'not-required';
  detail: string;
  facts?: Array<{label: string; value: string}>;
  photos?: Array<{url: string; category: string; fileName: string}>;
};
export type CrewProgressJob = {
  id: string;
  jobNumber: string;
  truck: string;
  crew: string;
  territory: string;
  window: string;
  status: string;
  href: string;
  customerFacts: Array<{label: string; value: string; href?: string}>;
  steps: CrewStep[];
  next: string;
  needsFollowUp: boolean;
  updateIds: string[];
};
export type CrewProgressSnapshot = {
  jobs: CrewProgressJob[];
  unlinkedUpdateIds: string[];
  scheduleCurrent: boolean;
  visitsCurrent: boolean;
  updatesComplete: boolean;
};
