export type RawJunkwareScheduleRecord = {
  jobId: string;
  jobType?: string;
  truck?: number | null;
  customer?: string;
  phone?: string;
  address?: string;
  scheduledStart?: string;
  scheduledEnd?: string;
  paymentType?: string;
  amount?: number;
  status?: string;
  durationMinutes?: number | null;
  reason?: string;
  rawText?: string;
};

export type RawJunkwareSchedulePayload = {
  scrapedAt: string;
  source: string;
  territory: string;
  activeJobs: RawJunkwareScheduleRecord[];
  cancelledJobs: RawJunkwareScheduleRecord[];
};

export type NormalizedJob = {
  jobId: string;
  source: "junkware";
  territory: string;
  jobType: string;
  truck: number | null;
  customer: string;
  phone: string;
  address: string;
  scheduledStart: string;
  scheduledEnd: string;
  revenue: number;
  paymentType: string;
  status: string;
  durationMinutes: number | null;
  cancelled: boolean;
  cancellationReason?: string;
};

export function normalizeSchedule(payload: RawJunkwareSchedulePayload): NormalizedJob[] {
  const active = payload.activeJobs.map((job) => ({
    jobId: job.jobId,
    source: "junkware" as const,
    territory: payload.territory,
    jobType: job.jobType ?? "",
    truck: job.truck ?? null,
    customer: job.customer ?? "",
    phone: job.phone ?? "",
    address: job.address ?? "",
    scheduledStart: job.scheduledStart ?? "",
    scheduledEnd: job.scheduledEnd ?? "",
    revenue: job.amount ?? 0,
    paymentType: job.paymentType ?? "",
    status: job.status ?? "",
    durationMinutes: job.durationMinutes ?? null,
    cancelled: false,
  }));

  const cancelled = payload.cancelledJobs.map((job) => ({
    jobId: job.jobId,
    source: "junkware" as const,
    territory: payload.territory,
    jobType: job.jobType ?? "",
    truck: null,
    customer: job.customer ?? "",
    phone: job.phone ?? "",
    address: job.address ?? "",
    scheduledStart: job.scheduledStart ?? "",
    scheduledEnd: job.scheduledEnd ?? "",
    revenue: 0,
    paymentType: "",
    status: "Cancelled",
    durationMinutes: null,
    cancelled: true,
    cancellationReason: job.reason ?? "",
  }));

  return [...active, ...cancelled];
}
