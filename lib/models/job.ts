export type Job = {
  jobNumber: string;

  customer?: string;

  status?: string;

  truck?: string;

  crew?: string[];

  revenue?: number;

  paymentMethod?: string;

  paid?: boolean;

  quickbooksStatus?: string;
};
