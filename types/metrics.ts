export type Appointment = {
  job_id?: string;
  customer_name?: string;
  market?: string;
  truck?: string;
  address?: string;
  lat?: number | null;
  lng?: number | null;
  revenue?: string;
  tip?: string;
  payment_type?: string;
  job_status?: string;
  appointment_type?: string;
};

export type TruckExpenses = {
  dumps?: number;
  gas?: number;
  recycling?: number;
  other?: number;
  total?: number;
};

export type TruckIssue = {
  truck?: string;
  rph?: number;
  target?: number;
};

export type EmployeeRph = {
  name?: string;
  truck?: string;
  trucks?: string[];
  time_in?: string;
  time_out?: string | null;
  clock_in?: string | null;
  clock_out?: string | null;
  clock_out_display?: string;
  hours?: number;
  hours_worked?: number;
  hours_basis?: string;
  shift_status?: string;
  truck_revenue?: number;
  revenue_generated?: number;
  tip?: number;
  truck_revenue_breakdown?: { truck?: string; revenue?: number; tip?: number; crew_size?: number }[];
  rph?: number;
  revenue_per_hour?: number;
  meets_target?: boolean;
};

export type PayrollRecord = {
  date?: string;
  name?: string;
  truck?: string;
  trucks?: string[];
  clock_in?: string | null;
  clock_out?: string | null;
  clock_out_display?: string;
  shift_status?: string;
  hours_worked?: number;
  hours_basis?: string;
  pay?: string;
  revenue_generated?: number;
  revenue_per_hour?: number;
  truck_revenue_breakdown?: { truck?: string; revenue?: number; crew_size?: number }[];
};

export type TruckPerformance = {
  truck?: string;
  crew_hours?: number;
  revenue?: number;
  revenue_per_labor_hour?: number;
  jobs?: number;
  crew_count?: number;
  verified_crew?: string[];
  verified_crew_count?: number;
  rph_verified?: number | null;
};

export type DailyMetrics = {
  date?: string;
  provisional?: boolean;
  provisional_reason?: string;
  total_revenue?: number;
  total_tips?: number;
  total_expenses?: number;
  expenses_by_truck?: Record<string, TruckExpenses>;
  tips_by_truck?: Record<string, number>;
  cc_fee_rate?: number;
  cc_fees?: number;
  net_revenue?: number;
  total_payments_collected?: number;
  open_invoice_total?: number;
  revenue_by_market?: Record<string, number>;
  revenue_by_truck?: Record<string, number>;
  jobs_by_truck?: Record<string, number>;
  jobs_by_market?: Record<string, number>;
  employee_hours_by_truck?: Record<string, number>;
  employees_by_truck?: Record<string, number>;
  employee_count?: number;
  employee_leaderboard?: EmployeeRph[];
  payroll_records?: PayrollRecord[];
  truck_performance?: TruckPerformance[];
  miles_by_truck?: Record<string, number>;
  idle_time_by_truck?: Record<string, string | number>;
  drive_time_by_truck?: Record<string, string | number>;
  truck_utilization?: Record<string, number>;
  rph_by_truck?: Record<string, number>;
  rph_verified_by_truck?: Record<string, number>;
  verified_crew_by_truck?: Record<string, string[]>;
  trucks_below_90_per_hr_person?: TruckIssue[];
  trucks_below_90_hr_person?: TruckIssue[];
  revenue_not_yet_collected?: number;
  appointments?: Appointment[];
  unmatched_payments?: unknown[];
  inputs?: {
    missing?: string[];
  };
};

export type MetricsResult = {
  metrics: DailyMetrics | null;
  dataPath: string;
  lastUpdated?: string;
  error?: string;
};
