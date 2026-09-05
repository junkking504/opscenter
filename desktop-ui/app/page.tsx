'use client';

import {
  Activity, ArrowLeft, ArrowRight, BarChart3, Bell, CalendarDays, Check, GripVertical,
  CircleDollarSign, Command, Copy, Gauge, MapPin, Megaphone, Search,
  PhoneCall, Play, ShieldCheck, Star, Truck, Users, Wrench, X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { DesktopLiveProps } from '@/lib/live-contract';
import LiveControl from '../live-control';
import { navigationValue, workspaceUrl } from '../lib/workspace-navigation';
import LiveKrewe from '../live-krewe';
import LiveFleet from '../live-fleet';
import { LiveMarketing } from '../live-marketing';
import { LiveFinance } from '../live-finance';
import LiveSearch from '../live-search';
import LiveSchedule, { dateForDay } from '../live-schedule';
import CommandMap from '../command-map';

type Priority = 'critical' | 'warning' | 'watch';
type AppointmentLoadStream = 'mixed' | 'metal' | 'donation';
type WorkItem = {
  id: number | string; domain: string; priority: Priority; title: string; detail: string;
  label: string; owner: string; detected: string; source: string; action: string; context: string;
  facts: Array<{ label: string; value: string; wide?: boolean; href?: string }>;
};
type AlertViewFilter = 'open' | 'action' | 'control' | 'acknowledged' | 'resolved' | 'all';
type DrawerRecord = {
  kicker: string; title: string; summary: string; action: string; source: string; updated: string;
  facts: Array<{ label: string; value: string; href?: string }>;
  appointmentId?: string;
  jobReferenceId?: string;
  followupId?: string;
  kreweId?: string;
  fleetTruckId?: string;
  fleetIssueId?: string;
  actionQueueId?: string;
  customerId?: string;
  territoryId?: ScheduleTerritory;
  areaId?: string;
};
type RecordNavigationEntry = {
  drawer: DrawerRecord | null;
  label: string;
  pageScrollTop: number;
  drawerScrollTop: number;
  context: {
    activeNav: string;
    view: 'now' | 'today' | 'monitor';
    query: string;
    alertViewFilter: AlertViewFilter;
    auditFilter: 'All' | AuditWorkspace;
    actionQueueFilter: 'all' | 'urgent' | 'approval' | 'verification' | 'mine';
    operatingDate: string;
    calendarDateDraft: string;
    scheduleDay: ScheduleDay;
    scheduleView: 'board' | 'calendar' | 'followup' | 'history';
    scheduleScope: string;
    scheduleStatusFilter: ScheduleStatusFilter;
    followupFilter: 'all' | 'estimates' | 'closed' | 'unclosed' | 'photos';
    historyFilter: ScheduleHistoryFilter;
    territoryPriority: string | null;
    selectedCalendarDay: number;
    showScheduleMap: boolean;
    kreweView: KreweView;
    kreweFilter: KreweFilter;
    kreweMonth: 'august' | 'july';
    fleetView: FleetView;
    fleetIssueFilter: FleetIssueFilter;
    fleetSummaryFilter: FleetSummaryFilter;
    selectedServiceTruck: string;
    fleetReportMonth: 'august' | 'july';
    marketingView: MarketingView;
    marketingLeadFilter: 'recover' | 'lost' | 'followup' | 'all';
    financeView: FinanceView;
  };
};
type ScheduleJob = {
  start: number; duration: number; time: string; jk: string; customer: string; area: string; kind: string; state: string;
  addressVerified?: boolean; cancellationReason?: string; estimatedPickups?: number; estimatedLoadStream?: AppointmentLoadStream;
  details?: { phone: string; address: string; scope: string; value: string; notes: string };
};
type ScheduleRow = { truck: string; crew: string; status: string; tone: string; jobs: ScheduleJob[] };
type RouteLegTone = 'clear' | 'tight' | 'late' | 'unavailable';
type RouteLeg = {
  from: ScheduleJob; to: ScheduleJob; minutes: number; miles: number; buffer: number; tone: RouteLegTone;
};
type TruckCandidate = {
  truckId: string; truck: string; origin: string; available: string; minutes: number; miles: number;
  arrival: string; buffer: number | null; tone: RouteLegTone; reason: string; gpsFresh: boolean;
};
type ScheduleMoveSegment = { label: string; minutes: number; miles: number; buffer: number; tone: RouteLegTone };
type PendingScheduleMove = {
  appointmentId: string; sourceTruck: string; targetTruck: string; sourceTime: string; targetTime: string;
  targetStart: number; duration: number; conflictIds: string[]; routeSegments: ScheduleMoveSegment[];
};
type ScheduleChangeSyncState = 'writing' | 'verifying' | 'verified' | 'uncertain' | 'searching' | 'safe-retry';
type ScheduleChangeKind = 'move' | 'edit' | 'cancel';
type ScheduleChangeReceipt = {
  id: string; day: ScheduleDay; appointmentId: string; customer: string;
  sourceTruck: string; targetTruck: string; sourceTime: string; targetTime: string;
  previousJob: ScheduleJob; nextJob: ScheduleJob; removedOpenCapacity: ScheduleJob[];
  kind: ScheduleChangeKind; changes: string[];
  requiresCustomerConfirmation: boolean; requiresCrewNotification: boolean;
  customerConfirmed: boolean; crewNotified: boolean; undone: boolean;
  syncState: ScheduleChangeSyncState; sourceVerifiedAt?: string;
};
type AppointmentChangeDraft = {
  truck: string; time: string; callAhead: boolean; addressVerified: boolean;
  cancel: boolean; cancellationReason: string;
};
type AppointmentCategory = 'Job' | 'Estimate';
type EstimateCloseoutOutcome = 'Follow-Up Required' | 'Not Booked';
type AppointmentCloseoutDraft = {
  category: AppointmentCategory; amount: string; paymentMethod: string;
  estimateOutcome: EstimateCloseoutOutcome; followUpDate: string; notes: string;
};
type AppointmentCloseoutReceipt = {
  appointmentId: string; day: ScheduleDay; originalCategory: AppointmentCategory; finalCategory: AppointmentCategory;
  previousState: string; finalState: 'Completed' | 'Estimate Closed'; amount: number;
  paymentMethod?: string; estimateOutcome?: EstimateCloseoutOutcome; followUpDate?: string; notes: string; recordedAt: string;
};
type SchedulePointerDrag = { appointmentId: string; pointerId: number; startX: number; startY: number; active: boolean };
type ScheduleHistoryType = 'Created' | 'Rescheduled' | 'Reassigned' | 'Cancelled' | 'Verified' | 'Status';
type ScheduleDay = 'today' | 'tomorrow';
type ScheduleHistoryRow = { type: ScheduleHistoryType; time: string; jk: string; change: string; by: string; source: string; day: ScheduleDay };
type ScheduleStatusFilter = 'all' | 'completed' | 'closed-estimates' | 'open' | 'unassigned' | 'verify';
type ScheduleHistoryFilter = 'all' | 'plan' | 'cancelled' | 'confirmation';
type JunkWareCreationState = 'idle' | 'creating' | 'verifying' | 'uncertain' | 'searching' | 'safe-retry' | 'created';
type AppointmentDeliveryState = 'not-sent' | 'sending' | 'delivered';
type AppointmentCreationReceipt = {
  appointmentId: string; day: ScheduleDay; customerDelivery: AppointmentDeliveryState;
  crewDelivery: AppointmentDeliveryState; callAheadRequired: boolean;
};
const scheduleChangeSyncCopy: Record<ScheduleChangeSyncState, { label: string; detail: string }> = {
  writing: { label: 'Writing', detail: 'Sending the truck and time change' },
  verifying: { label: 'Verifying', detail: 'Reading back the exact JK record' },
  verified: { label: 'Verified', detail: 'Truck and time match the read-back' },
  uncertain: { label: 'Needs Attention', detail: 'The write outcome could not be confirmed' },
  searching: { label: 'Searching', detail: 'Checking for an existing source update' },
  'safe-retry': { label: 'Safe to Retry', detail: 'No matching source update was found' },
};
type NewAppointmentForm = {
  kind: 'Job' | 'Estimate'; window: string; truck: string; area: string;
  customer: string; phone: string; address: string; scope: string; value: string; notes: string; loadPickups: number; loadStream: AppointmentLoadStream;
};
type NewAppointmentPlacement = {
  truck: string; crew: string; window: string; windowLabel: string; origin: string;
  minutes: number; miles: number; buffer: number; tone: RouteLegTone; reason: string;
  sameTerritory: boolean; gpsFresh: boolean; score: number; currentLoad: number; jobLoad: number;
  projectedLoad: number; capacityStatus: 'fit' | 'dump' | 'insufficient'; capacityMessage: string;
};
type NewAppointmentAddressVerification = {
  status: 'verified' | 'review' | 'outside' | 'incomplete'; input: string; normalizedAddress: string;
  message: string; matchedArea?: string; territory?: ScheduleTerritory; areaCode?: string;
  latitude?: number; longitude?: number; mapSrc?: string; linkedAppointments: string[]; manual?: boolean;
};
type KreweStatus = 'Clocked in' | 'Job attributed' | 'Missing clock-in' | 'Off today';
type KrewePeriod = {
  regularHours: number; overtimeHours: number; jobs: number; revenue: number; labor: number;
  tips: number; bonuses: number; automatedBonuses: number; manualBonuses: number; supplemental: number; totalPay: number;
};
type KreweMember = {
  id: string; name: string; initials: string; role: string; status: KreweStatus; clockIn: string; clockOut: string;
  truck: string; territory: string; jobs: number | null; hours: number | null; jobRevenue: number | null;
  revenue: number | null; rph: number | null; averageJob: number | null; estimatesClosed?: number | null; closeRate?: number | null; hourlyRate: number | null;
  regularPay: number | null; overtimeAdditional: number | null; tips: number | null; revenueBonus: number | null;
  manualBonus: number | null; otherBonus?: number | null; supplementalPay: number | null; totalPay: number | null; driverScore: number | null;
  driverStatus: string; assignmentConfidence: string; weeklyHours: number; period: KrewePeriod; month: KrewePeriod; issue?: string;
};
type KreweFilter = 'all' | 'working' | 'unassigned' | 'attention' | 'off';
type KreweView = 'today' | 'callin' | 'payperiod' | 'monthly';
type CallInStatus = 'Recommended' | 'Called' | 'Confirmed' | 'Unavailable';
type CallInCandidate = {
  memberId: string; rank: number; suggestedRole: string; reason: string; projectedHours: number;
  recentRph: number; recentJobs: number; overtimeRisk?: boolean; status: CallInStatus;
};
type FleetView = 'overview' | 'maintenance' | 'service' | 'reports';
type FleetReadiness = 'Ready' | 'Attention' | 'Out of service';
type FleetTruck = {
  id: string; label: string; vehicle: string; readiness: FleetReadiness; operatingStatus: string; driver: string; navigator: string;
  territory: string; assignment: string; location: string; gpsAge: string; gpsFresh: boolean; odometer: number; checklist: 'Complete' | 'Missing';
  loadPercent: number; loadNote: string; metalNote: string; nextService: string; serviceTone: 'current' | 'soon' | 'due';
  driverScore: number | null; jobs: number; revenue: number; miles: number; idleMinutes: number;
};
type FleetIssueStatus = 'Open' | 'In progress' | 'Resolved';
type FleetIssueSeverity = 'Monitor' | 'Repair soon' | 'Out of service';
type FleetIssue = {
  id: string; truckId: string; title: string; description: string; severity: FleetIssueSeverity; status: FleetIssueStatus;
  owner: string; due: string; cost: number | null; downtime: number; resolution: string;
};
type FleetIssueFilter = 'active' | 'all';
type FleetSummaryFilter = 'all' | 'ready' | 'working' | 'attention' | 'out' | 'service' | 'stale';
type MarketingView = 'overview' | 'leads' | 'reviews' | 'performance';
type MarketingLeadStatus = 'Lost' | 'Needs follow-up' | 'Contacted' | 'Booked' | 'Not qualified';
type MarketingLead = {
  id: string; customer: string; phone: string; territory: string; intent: string; quotedValue: number | null;
  status: MarketingLeadStatus; age: string; source: string; reason: string; lastContact: string; callDuration: string;
};
type MarketingReview = {
  id: string; customer: string; location: string; stars: number; age: string; excerpt: string;
  selectedAppointment: string; candidates: string[]; status: 'Needs attribution' | 'Attributed';
};
type FinanceView = 'overview' | 'payments' | 'resale' | 'recycling' | 'trends';
type FinancePaymentStatus = 'Matched' | 'Needs review' | 'Unmatched';
type FinancePayment = {
  id: string; customer: string; truck: string; jobTotal: number; paymentAmount: number; adjustment: number;
  method: string; reference: string; status: FinancePaymentStatus; note: string;
};
type FinanceRecoveryStatus = 'Awaiting disposition' | 'Held' | 'Listed' | 'Sold' | 'Awaiting yard' | 'Ticket missing' | 'Submitted' | 'Paid';
type FinanceRecoveryItem = {
  id: string; kind: 'Resale' | 'Recycling'; sourceJob: string; item: string; location: string; quantity: string;
  expectedValue: number; realizedValue: number | null; status: FinanceRecoveryStatus; owner: string; age: string; note: string;
};
type GlobalSearchKind = 'customer' | 'territory' | 'area' | 'appointment' | 'krewe' | 'truck' | 'lead' | 'review' | 'payment' | 'resale' | 'recycling';
type GlobalSearchResult = {
  key: string; kind: GlobalSearchKind; group: 'Customers' | 'Schedule' | 'Krewe' | 'Fleet' | 'Marketing' | 'Finance';
  refId: string; title: string; subtitle: string; context: string; status: string; source: string; searchable: string;
  day?: ScheduleDay;
};
type LauncherCommandId = 'new-appointment' | 'today-schedule' | 'tomorrow-plan' | 'urgent-actions' | 'truck-load' | 'krewe-correction' | 'payment-reconciliation' | 'source-health';
type LauncherCommand = {
  id: LauncherCommandId; label: string; description: string; workspace: string; keywords: string; icon: LucideIcon;
};
type AuditWorkspace = 'Command' | 'Schedule' | 'Krewe' | 'Fleet' | 'Marketing' | 'Finance';
type AuditResult = 'Completed' | 'Needs review';
type AuditEvent = {
  id: string; workspace: AuditWorkspace; action: string; record: string; summary: string;
  previous: string; next: string; actor: string; source: string; time: string; result: AuditResult; refId?: string;
};
type ActionQueueStatus = 'Open' | 'In Progress' | 'Awaiting Verification' | 'Waiting' | 'Blocked';
type ActionApproval = 'Not required' | 'Pending approval' | 'Approved' | 'Rejected';
type ActionQueueItem = {
  id: string; workspace: AuditWorkspace; priority: Priority; title: string; detail: string; record: string;
  owner: string; due: string; source: string; action: string; status: ActionQueueStatus; note: string; escalated: boolean;
  recommendation: string; approval: ActionApproval; verification: string; refId?: string; alertId?: number | string;
  verificationSource?: string; proposedResolution?: string; verificationEvidence?: string; verificationCheckedAt?: string;
};
type CloseoutQueueFilter = 'all' | 'jobs' | 'estimates' | 'urgent';
type CloseoutQueueItem = {
  id: string; appointmentId: string; category: AppointmentCategory; customer: string; truck: string; window: string;
  amount: string; exception: string; detail: string; owner: string; due: string; source: string;
  priority: 'critical' | 'warning' | 'watch'; primaryAction: string;
};
type DayStartGateId = 'schedule' | 'fleet' | 'krewe' | 'carryovers' | 'alerts';
type DayStartGate = {
  id: DayStartGateId; title: string; detail: string; source: string; count: number; unit: string;
  owner: string; due: string; reviewLabel: string; workspace: AuditWorkspace; owned: boolean;
};
type DayCloseGateId = 'appointments' | 'jobs' | 'estimates' | 'fleet' | 'handoffs';
type DayCloseCarryover = { owner: string; due: string; note: string; recordedAt: string };
type DayCloseGate = {
  id: DayCloseGateId; title: string; detail: string; source: string; count: number; unit: string;
  owner: string; reviewLabel: string;
};
type AlertOutcome = { actionId: string; resolution: string; source: string; evidence: string; time: string };

const nav = [
  { label: 'Command', icon: Command, count: 5 },
  { label: 'Schedule', icon: CalendarDays, count: 18 },
  { label: 'Krewe', icon: Users, count: 2 },
  { label: 'Fleet', icon: Truck, count: 7 },
  { label: 'Marketing', icon: Megaphone, count: 16 },
  { label: 'Finance', icon: CircleDollarSign, count: 3 },
];

const launcherCommands: LauncherCommand[] = [
  { id: 'new-appointment', label: 'New Appointment', description: 'Start a dispatch-ready JunkWare appointment.', workspace: 'Schedule', keywords: 'create book job estimate customer dispatch', icon: CalendarDays },
  { id: 'today-schedule', label: 'Today’s Live Schedule', description: 'Open the current truck board and map.', workspace: 'Schedule', keywords: 'today live board map dispatch appointments', icon: Play },
  { id: 'tomorrow-plan', label: 'Tomorrow’s Planning Board', description: 'Open tomorrow’s assignments and coverage.', workspace: 'Schedule', keywords: 'tomorrow plan call in routes assignments coverage', icon: CalendarDays },
  { id: 'urgent-actions', label: 'Urgent Action Queue', description: 'Show only work requiring immediate ownership.', workspace: 'Command', keywords: 'urgent critical action queue exceptions owner due', icon: Command },
  { id: 'truck-load', label: 'Record Truck Load Update', description: 'Open the load ledger for a truck needing review.', workspace: 'Fleet', keywords: 'truck fleet load dump metal update ledger', icon: Truck },
  { id: 'krewe-correction', label: 'Start Krewe Correction', description: 'Open the first attendance or assignment exception.', workspace: 'Krewe', keywords: 'krewe attendance time clock correction assignment payroll', icon: Users },
  { id: 'payment-reconciliation', label: 'Open Payment Reconciliation', description: 'Review the first unmatched job payment.', workspace: 'Finance', keywords: 'finance payment qbo reconcile unmatched adjustment', icon: CircleDollarSign },
  { id: 'source-health', label: 'View Source Health', description: 'Check source freshness and connection status.', workspace: 'Monitor', keywords: 'source health systems connected freshness monitor', icon: ShieldCheck },
];

const commandKpis = [
  { label: 'Completed jobs', value: '2', detail: 'Goal: 8.4 jobs', progress: 24, tone: 'critical' },
  { label: 'Active trucks', value: '2', detail: '2 of 9 producing revenue', progress: 22, tone: 'healthy' },
  { label: 'Revenue / truck', value: '$379.56', detail: 'Goal: $2,739.73', progress: 14, tone: 'critical' },
  { label: 'Profit / job', value: '$25.55', detail: 'Goal: $130.00', progress: 20, tone: 'critical' },
  {
    label: 'Today’s jobs', value: '16', detail: '2 jobs · 0 estimates · 14 unclosed', progress: 100, tone: 'warning',
    segments: [
      { label: 'Jobs', value: 12.5, tone: 'healthy' },
      { label: 'Estimates', value: 0, tone: 'warning' },
      { label: 'Unclosed', value: 87.5, tone: 'critical' },
    ],
  },
  { label: 'Revenue plan', value: '$759.11', detail: '14% of $5,479.45', progress: 14, tone: 'critical' },
  { label: 'Labor', value: '$552.33', detail: '9.1% projected · Goal: under 16%', progress: 57, tone: 'healthy' },
  { label: 'Crew coverage', value: '10', detail: 'Clocked in or assigned to jobs', progress: 100, tone: 'healthy' },
];

const referenceWorkItems: WorkItem[] = [
  {
    id: 1, domain: 'Schedule', priority: 'warning', label: 'New appointment', title: 'JK4001234 · 11:00 AM–12:00 PM',
    detail: 'Sample Customer · Northshore.', owner: 'Dispatch', detected: '4 min ago', source: 'Slack',
    action: 'Open appointment', context: 'Place in today’s route plan.',
    facts: [
      { label: 'Customer', value: 'Sample Customer' },
      { label: 'Phone', value: '(504) 555-0142', href: 'tel:+15045550142' },
      { label: 'Service address', value: '123 Example Street, Covington, LA 70433', wide: true },
      { label: 'Items', value: 'Sofa; desk; moving boxes', wide: true },
    ],
  },
  {
    id: 2, domain: 'Schedule', priority: 'watch', label: 'On site', title: 'Truck 2 · JK4001241',
    detail: 'Confirmed arrival at 10:18 AM.', owner: 'Dispatch', detected: '3 min ago', source: 'Slack',
    action: 'Open job', context: 'Arrival confirmed by LinxUp.',
    facts: [
      { label: 'Arrival', value: '10:18 AM CT' },
      { label: 'Customer', value: 'Example Resident' },
      { label: 'Phone', value: '(985) 555-0188', href: 'tel:+19855550188' },
      { label: 'Service address', value: '430 Sample Lane, Covington, LA 70433', wide: true },
    ],
  },
  {
    id: 3, domain: 'Schedule', priority: 'critical', label: 'Cancellation', title: 'JK4001288 · 2:00 PM–3:00 PM',
    detail: 'Customer cancelled today’s Baton Rouge appointment.', owner: 'Dispatch', detected: '11 min ago', source: 'Slack',
    action: 'Open schedule', context: 'Reassign the open capacity.',
    facts: [
      { label: 'Customer', value: 'Example Customer' },
      { label: 'Phone', value: '(225) 555-0116', href: 'tel:+12255550116' },
      { label: 'Service address', value: '88 Sample Drive, Baton Rouge, LA 70810', wide: true },
      { label: 'Reason', value: 'Customer changed plans', wide: true },
    ],
  },
  {
    id: 4, domain: 'Finance', priority: 'watch', label: 'Job closed', title: 'JK4001204 · Truck 8',
    detail: '$1,248.00 total · Card payment recorded.', owner: 'Finance', detected: '19 min ago', source: 'Slack',
    action: 'Open closeout', context: 'Verify totals and payment.',
    facts: [
      { label: 'Krewe', value: 'Crew A · Crew B', wide: true },
      { label: 'Load', value: '$1,100.00 · 3/4 load' },
      { label: 'Labor', value: '$82.00' },
      { label: 'CC 3%', value: '$33.00' },
      { label: 'Tips', value: '$33.00' },
      { label: 'Total', value: '$1,248.00' },
      { label: 'Payment', value: 'Card Ending 4242 ($1,215.00)', wide: true },
    ],
  },
  {
    id: 5, domain: 'Schedule', priority: 'watch', label: 'Photos uploaded', title: 'JK4001204 · 8 photos verified',
    detail: 'The full photo batch is recorded in JunkWare.', owner: 'Dispatch', detected: '22 min ago', source: 'Slack',
    action: 'View photos', context: 'Complete · No action required.',
    facts: [
      { label: 'Truck', value: 'Truck 8' },
      { label: 'Photos', value: '8 total' },
      { label: 'Verification', value: 'Verified in JunkWare', wide: true },
    ],
  },
];

const schedule = [
  { truck: 'Truck 2', crew: 'Crew A', status: 'On site', tone: 'healthy', current: 'JK4001241 · Covington', currentMeta: 'Arrived 10:18 AM', next: '11:30 AM · Mandeville', stops: '1 of 3', progress: 38 },
  { truck: 'Truck 4', crew: 'Crew B', status: 'En route', tone: 'watch', current: 'JK4001260 · Metairie', currentMeta: 'ETA 10:42 AM', next: '12:00 PM · Kenner', stops: '1 of 2', progress: 50 },
  { truck: 'Truck 8', crew: 'Crew C', status: 'Available', tone: 'healthy', current: 'JK4001204 · Closed', currentMeta: 'Photos verified', next: '1:00 PM · Slidell', stops: '2 of 4', progress: 58 },
  { truck: 'Truck 9', crew: 'Crew D', status: 'Needs plan', tone: 'critical', current: 'Route gap at 2:00 PM', currentMeta: 'Cancellation', next: '3:30 PM · Baton Rouge', stops: '1 of 3', progress: 34 },
];

const initialActionQueue: ActionQueueItem[] = [
  { id: 'AQ-101', workspace: 'Schedule', priority: 'critical', title: 'Fill Truck 9 route gap', detail: 'Open capacity from 2:00–4:00 PM in Baton Rouge.', record: 'Truck 9', owner: 'Mission Control', due: 'Before 11:30 AM', source: 'JunkWare Schedule', action: 'Open Board', status: 'Open', note: 'Find a compatible Baton Rouge appointment or rebalance the route.', escalated: false, recommendation: 'Move a compatible Baton Rouge appointment into the open window, then confirm the customer and crew.', approval: 'Pending approval', verification: 'Truck 9 board has no unfilled 2:00–4:00 PM route gap.', alertId: 3 },
  { id: 'AQ-102', workspace: 'Krewe', priority: 'critical', title: 'Correct missing clock-in', detail: 'Malik Johnson is assigned to Truck 9 without a time record.', record: 'Malik Johnson', owner: 'Ops Manager', due: 'Before payroll', source: 'JunkWare Attendance', action: 'Open Krewe', status: 'Open', note: 'Confirm arrival time with the Truck 9 driver.', escalated: false, recommendation: 'Confirm the actual start time with the driver before recording a manager correction.', approval: 'Pending approval', verification: 'Corrected time includes the manager, reason, timestamp, and before-and-after values.', refId: 'KM-108' },
  { id: 'AQ-103', workspace: 'Fleet', priority: 'warning', title: 'Verify Truck 4 location', detail: 'The last individual LinxUp position is 18 minutes old.', record: 'Truck 4', owner: 'Mission Control', due: 'Now', source: 'LinxUp GPS', action: 'Open Fleet', status: 'In Progress', note: 'Call the crew if telemetry does not recover.', escalated: false, recommendation: 'Check the latest individual LinxUp position; call the crew only if telemetry remains stale.', approval: 'Not required', verification: 'A fresh position or crew-confirmed location is attached to Truck 4.', refId: 'FT-4' },
  { id: 'AQ-104', workspace: 'Finance', priority: 'warning', title: 'Reconcile $33 payment difference', detail: 'Captured card payment does not match the recorded job total.', record: 'JK4001204', owner: 'Finance', due: 'Before daily close', source: 'JunkWare + QBO', action: 'Open Payment', status: 'Open', note: 'Confirm whether the difference is the card fee.', escalated: false, recommendation: 'Confirm the $33 difference from the payment source before posting an adjustment.', approval: 'Pending approval', verification: 'JunkWare total and QBO payment reconcile with an attributable adjustment or correction.', refId: 'JK4001204', alertId: 4 },
  { id: 'AQ-105', workspace: 'Marketing', priority: 'watch', title: 'Confirm today’s review match', detail: 'Sample Customer review is likely tied to JK4001204.', record: 'RV-301', owner: 'Marketing', due: 'By 2:00 PM', source: 'Podium + JunkWare', action: 'Open Review', status: 'Waiting', note: 'Manager confirmation is required before attribution.', escalated: false, recommendation: 'Confirm or reassign the proposed JunkWare appointment match.', approval: 'Pending approval', verification: 'The Podium review is attributed to a manager-confirmed JK number.', refId: 'RV-301' },
];

const healthSources = [
  { name: 'JunkWare', area: 'Schedule and closeouts', state: 'Healthy', freshness: 'Updated 1 min ago', tone: 'healthy' },
  { name: 'LinxUp', area: 'Vehicle positions', state: 'Attention', freshness: 'Truck 4 stale · 18 min', tone: 'warning' },
  { name: 'QuickBooks', area: 'Payments and accounting', state: 'Healthy', freshness: 'Updated 5 min ago', tone: 'healthy' },
  { name: 'SearchKings', area: 'Calls and lead recovery', state: 'Healthy', freshness: 'Updated 8 min ago', tone: 'healthy' },
];

const referenceConnectedSources = [
  { ...healthSources[0], workspace: 'Schedule', action: 'Open Schedule' },
  { ...healthSources[1], workspace: 'Fleet', action: 'Open Fleet' },
  { ...healthSources[2], workspace: 'Finance', action: 'Open Finance' },
  { ...healthSources[3], workspace: 'Marketing', action: 'Open Lead Recovery' },
  { name: 'Podium', area: 'Reviews and attribution', state: 'Healthy', freshness: 'Updated 6 min ago', tone: 'healthy', workspace: 'Marketing', action: 'Open Reviews' },
  { name: 'Slack', area: 'Alerts and OpsBot events', state: 'Healthy', freshness: 'Latest alert 4 min ago', tone: 'healthy', workspace: 'Command', action: 'Open Alerts' },
];

const monitorWatchlist = [
  { priority: 'critical', label: 'Fleet', title: 'Truck 4 stopped reporting', detail: 'Last LinxUp position received 18 minutes ago.', action: 'Open Fleet' },
  { priority: 'warning', label: 'Finance', title: 'One closeout needs review', detail: 'Card payment and recorded total differ by $33.00.', action: 'Review closeout' },
  { priority: 'watch', label: 'Marketing', title: '5 leads are nearing SLA', detail: 'Oldest unanswered qualified call is 21 minutes old.', action: 'Open recovery' },
];

const monitorSignals = [
  { label: 'Revenue pace', value: '18% behind', detail: 'Against plan at this hour', progress: 42, tone: 'critical', icon: BarChart3 },
  { label: 'Labor buffer', value: '6.9 pts', detail: 'Below the 16% ceiling', progress: 57, tone: 'healthy', icon: Users },
  { label: 'Fleet telemetry', value: '8 of 9', detail: 'Vehicles reporting live', progress: 89, tone: 'warning', icon: Wrench },
  { label: 'Lead response', value: '3m median', detail: '5 qualified calls at risk', progress: 68, tone: 'warning', icon: Gauge },
];

const period = (regularHours: number, overtimeHours: number, jobs: number, revenue: number, labor: number, tips: number, bonuses: number, supplemental: number, totalPay: number): KrewePeriod => ({ regularHours, overtimeHours, jobs, revenue, labor, tips, bonuses, automatedBonuses: Math.round(bonuses * .82 * 100) / 100, manualBonuses: Math.round(bonuses * .18 * 100) / 100, supplemental, totalPay });
const kreweRoster: KreweMember[] = [
  { id: 'KM-101', name: 'Marcus Reed', initials: 'MR', role: 'Driver', status: 'Clocked in', clockIn: '6:42 AM', clockOut: '—', truck: 'Truck 2', territory: 'Northshore', jobs: 3, hours: 4.1, jobRevenue: 1357, revenue: 1357, rph: 331, averageJob: 452, hourlyRate: 21, regularPay: 86.1, overtimeAdditional: 0, tips: 24, revenueBonus: 33.93, manualBonus: 5, supplementalPay: 0, totalPay: 149.03, driverScore: 94, driverStatus: 'Current · LinxUp', assignmentConfidence: 'High', weeklyHours: 34.2, period: period(72.4, 3.2, 18, 7850, 1701, 154, 196, 0, 2051), month: period(156, 8, 74, 31940, 3820, 612, 826, 0, 5258) },
  { id: 'KM-102', name: 'Devin Ross', initials: 'DR', role: 'Navigator', status: 'Clocked in', clockIn: '6:45 AM', clockOut: '—', truck: 'Truck 2', territory: 'Northshore', jobs: 3, hours: 4, jobRevenue: 1357, revenue: 1120, rph: 280, averageJob: 452, hourlyRate: 18, regularPay: 72, overtimeAdditional: 0, tips: 18, revenueBonus: 28, manualBonus: 0, supplementalPay: 0, totalPay: 118, driverScore: null, driverStatus: 'Not a driver', assignmentConfidence: 'High', weeklyHours: 31.6, period: period(68.1, 0, 17, 6910, 1226, 128, 164, 0, 1518), month: period(149, 2.4, 69, 28440, 2756, 502, 701, 0, 3959) },
  { id: 'KM-103', name: 'Carlos Diaz', initials: 'CD', role: 'Driver', status: 'Clocked in', clockIn: '6:51 AM', clockOut: '—', truck: 'Truck 4', territory: 'Jefferson Parish', jobs: 3, hours: 3.9, jobRevenue: 2430, revenue: 2430, rph: 623, averageJob: 810, hourlyRate: 22, regularPay: 85.8, overtimeAdditional: 0, tips: 32, revenueBonus: 60.75, manualBonus: 0, supplementalPay: 0, totalPay: 178.55, driverScore: 91, driverStatus: 'Current · LinxUp', assignmentConfidence: 'High', weeklyHours: 37.8, period: period(75.6, 5.5, 22, 11320, 1998, 204, 281, 0, 2483), month: period(162, 11.2, 86, 45270, 4497, 798, 1132, 0, 6427) },
  { id: 'KM-104', name: 'Jaylen Brown', initials: 'JB', role: 'Navigator', status: 'Clocked in', clockIn: '6:54 AM', clockOut: '—', truck: 'Truck 4', territory: 'Jefferson Parish', jobs: 3, hours: 3.8, jobRevenue: 2430, revenue: 1910, rph: 503, averageJob: 810, hourlyRate: 18, regularPay: 68.4, overtimeAdditional: 0, tips: 26, revenueBonus: 47.75, manualBonus: 10, supplementalPay: 0, totalPay: 152.15, driverScore: null, driverStatus: 'Not a driver', assignmentConfidence: 'High', weeklyHours: 35.1, period: period(70.3, 2.1, 20, 9820, 1328, 183, 253, 0, 1764), month: period(151, 5.7, 79, 38960, 3018, 714, 986, 0, 4718) },
  { id: 'KM-105', name: 'Antoine Clark', initials: 'AC', role: 'Driver', status: 'Clocked in', clockIn: '7:01 AM', clockOut: '—', truck: 'Truck 8', territory: 'New Orleans', jobs: 3, hours: 3.7, jobRevenue: 1540, revenue: 1540, rph: 416, averageJob: 513, hourlyRate: 21, regularPay: 77.7, overtimeAdditional: 0, tips: 20, revenueBonus: 38.5, manualBonus: 0, supplementalPay: 0, totalPay: 136.2, driverScore: 88, driverStatus: 'Watch · LinxUp', assignmentConfidence: 'High', weeklyHours: 38.9, period: period(76.8, 6.4, 21, 10540, 1882, 192, 264, 75, 2413), month: period(164, 13.5, 83, 42170, 4328, 756, 1069, 150, 6303) },
  { id: 'KM-106', name: 'Elijah Price', initials: 'EP', role: 'Navigator', status: 'Job attributed', clockIn: '—', clockOut: '—', truck: 'Truck 8', territory: 'New Orleans', jobs: 2, hours: null, jobRevenue: 1015, revenue: 1015, rph: null, averageJob: 508, hourlyRate: 18, regularPay: null, overtimeAdditional: null, tips: 16, revenueBonus: 25.38, manualBonus: 0, supplementalPay: 0, totalPay: null, driverScore: null, driverStatus: 'Not a driver', assignmentConfidence: 'Job attribution only', weeklyHours: 28.4, period: period(61.7, 0, 16, 6420, 1111, 119, 151, 0, 1381), month: period(137, 0, 63, 25780, 2466, 477, 646, 0, 3589) },
  { id: 'KM-107', name: 'Brandon Lee', initials: 'BL', role: 'Driver', status: 'Clocked in', clockIn: '6:58 AM', clockOut: '—', truck: 'Truck 9', territory: 'Baton Rouge', jobs: 2, hours: 3.8, jobRevenue: 1620, revenue: 1620, rph: 426, averageJob: 810, hourlyRate: 22, regularPay: 83.6, overtimeAdditional: 0, tips: 22, revenueBonus: 40.5, manualBonus: 0, supplementalPay: 0, totalPay: 146.1, driverScore: 96, driverStatus: 'Current · LinxUp', assignmentConfidence: 'High', weeklyHours: 36.4, period: period(73.4, 4.8, 19, 9210, 1802, 166, 231, 0, 2199), month: period(158, 9.6, 76, 37420, 4044, 651, 937, 0, 5632) },
  { id: 'KM-108', name: 'Malik Johnson', initials: 'MJ', role: 'Navigator', status: 'Missing clock-in', clockIn: '—', clockOut: '—', truck: 'Truck 9', territory: 'Baton Rouge', jobs: 2, hours: null, jobRevenue: 1620, revenue: 1320, rph: null, averageJob: 810, hourlyRate: 18, regularPay: null, overtimeAdditional: null, tips: 18, revenueBonus: 33, manualBonus: 0, supplementalPay: 0, totalPay: null, driverScore: null, driverStatus: 'Not a driver', assignmentConfidence: 'Scheduled + job attribution', weeklyHours: 30.2, period: period(64.8, 0, 17, 7380, 1166, 132, 177, 0, 1475), month: period(142, 1.2, 68, 29410, 2598, 533, 739, 0, 3870), issue: 'Assigned to Truck 9 with no recorded clock-in.' },
  { id: 'KM-109', name: 'Terrence Hall', initials: 'TH', role: 'Driver', status: 'Clocked in', clockIn: '7:03 AM', clockOut: '—', truck: 'Unassigned', territory: '—', jobs: 0, hours: 3.7, jobRevenue: 0, revenue: 0, rph: 0, averageJob: null, hourlyRate: 21, regularPay: 77.7, overtimeAdditional: 0, tips: 0, revenueBonus: 0, manualBonus: 0, supplementalPay: 0, totalPay: 77.7, driverScore: 90, driverStatus: 'Current · LinxUp', assignmentConfidence: 'No truck assignment', weeklyHours: 33.7, period: period(69.2, 2.7, 15, 6120, 1535, 104, 143, 0, 1782), month: period(148, 6.8, 61, 24670, 3481, 418, 617, 0, 4516), issue: 'Clocked in but not assigned to a truck.' },
  { id: 'KM-110', name: 'Shawn Davis', initials: 'SD', role: 'Navigator', status: 'Off today', clockIn: '—', clockOut: '—', truck: 'Not scheduled', territory: '—', jobs: null, hours: null, jobRevenue: null, revenue: null, rph: null, averageJob: null, hourlyRate: null, regularPay: null, overtimeAdditional: null, tips: null, revenueBonus: null, manualBonus: null, supplementalPay: null, totalPay: null, driverScore: null, driverStatus: 'Not scheduled', assignmentConfidence: 'Roster only', weeklyHours: 24.5, period: period(49, 0, 11, 4410, 882, 87, 104, 0, 1073), month: period(118, 0, 47, 18760, 2124, 351, 469, 0, 2944) },
];

const initialCallInCandidates: CallInCandidate[] = [
  { memberId: 'KM-110', rank: 1, suggestedRole: 'Navigator', reason: 'Best available fit for Northshore demand and remains below the weekly-hours threshold.', projectedHours: 32.5, recentRph: 286, recentJobs: 11, status: 'Recommended' },
  { memberId: 'KM-109', rank: 2, suggestedRole: 'Driver', reason: 'Adds driver coverage for Baton Rouge; confirm assignment before making the commitment.', projectedHours: 41.7, recentRph: 352, recentJobs: 15, overtimeRisk: true, status: 'Recommended' },
  { memberId: 'KM-106', rank: 3, suggestedRole: 'Navigator', reason: 'Strong recent activity with adequate weekly-hours capacity.', projectedHours: 36.4, recentRph: 301, recentJobs: 16, status: 'Recommended' },
];

const fleetTrucks: FleetTruck[] = [
  { id: 'FT-2', label: 'Truck 2', vehicle: '2021 Isuzu NPR', readiness: 'Ready', operatingStatus: 'On site', driver: 'Marcus Reed', navigator: 'Devin Ross', territory: 'Northshore', assignment: 'JK4001241 · Covington', location: 'Covington', gpsAge: '42 sec', gpsFresh: true, odometer: 81240, checklist: 'Complete', loadPercent: 58, loadNote: 'Mixed household load', metalNote: 'Small metal fraction', nextService: 'Oil · 1,240 mi', serviceTone: 'current', driverScore: 94, jobs: 18, revenue: 7850, miles: 486, idleMinutes: 74 },
  { id: 'FT-4', label: 'Truck 4', vehicle: '2020 Isuzu NPR-HD', readiness: 'Attention', operatingStatus: 'En route', driver: 'Carlos Diaz', navigator: 'Jaylen Brown', territory: 'Jefferson Parish', assignment: 'JK4001260 · Kenner', location: 'Metairie', gpsAge: '18 min', gpsFresh: false, odometer: 96710, checklist: 'Complete', loadPercent: 72, loadNote: 'Furniture and household load', metalNote: 'No metal noted', nextService: 'Tire inspection · Sep 3', serviceTone: 'soon', driverScore: 91, jobs: 22, revenue: 11320, miles: 527, idleMinutes: 93 },
  { id: 'FT-8', label: 'Truck 8', vehicle: '2022 Isuzu NPR', readiness: 'Ready', operatingStatus: 'Available', driver: 'Antoine Clark', navigator: 'Elijah Price', territory: 'New Orleans', assignment: 'Next · JK4001280', location: 'New Orleans', gpsAge: '1 min', gpsFresh: true, odometer: 64280, checklist: 'Complete', loadPercent: 25, loadNote: 'Light post-closeout load', metalNote: 'Appliance metal separated', nextService: 'Hydraulics · 24 days', serviceTone: 'current', driverScore: 88, jobs: 21, revenue: 10540, miles: 402, idleMinutes: 66 },
  { id: 'FT-9', label: 'Truck 9', vehicle: '2019 Isuzu NPR-HD', readiness: 'Attention', operatingStatus: 'Route gap', driver: 'Brandon Lee', navigator: 'Malik Johnson', territory: 'Baton Rouge', assignment: 'Open capacity · 2:00–4:00', location: 'Baton Rouge', gpsAge: '2 min', gpsFresh: true, odometer: 104930, checklist: 'Complete', loadPercent: 83, loadNote: 'Nearly full mixed load', metalNote: 'Moderate scrap metal', nextService: 'Hydraulic inspection · Due', serviceTone: 'due', driverScore: 96, jobs: 19, revenue: 9210, miles: 612, idleMinutes: 84 },
  { id: 'FT-3', label: 'Truck 3', vehicle: '2021 Isuzu NPR', readiness: 'Ready', operatingStatus: 'On route', driver: 'Krewe assignment', navigator: 'Krewe assignment', territory: 'Northshore', assignment: 'JK4001258 · Hammond', location: 'Hammond', gpsAge: '4 min', gpsFresh: true, odometer: 73180, checklist: 'Complete', loadPercent: 10, loadNote: 'Route started empty', metalNote: 'No metal noted', nextService: 'Brakes · 41 days', serviceTone: 'current', driverScore: 86, jobs: 16, revenue: 6420, miles: 458, idleMinutes: 71 },
  { id: 'FT-5', label: 'Truck 5', vehicle: '2018 Isuzu NPR', readiness: 'Attention', operatingStatus: 'Available', driver: 'Krewe assignment', navigator: 'Krewe assignment', territory: 'Baton Rouge', assignment: 'Next · JK4001306', location: 'Gonzales', gpsAge: '7 min', gpsFresh: true, odometer: 118420, checklist: 'Missing', loadPercent: 45, loadNote: 'Partial household load', metalNote: 'Metal status not recorded', nextService: 'Oil · 620 mi', serviceTone: 'soon', driverScore: 82, jobs: 14, revenue: 5870, miles: 539, idleMinutes: 102 },
  { id: 'FT-6', label: 'Truck 6', vehicle: '2019 Isuzu NPR-HD', readiness: 'Out of service', operatingStatus: 'Shop hold', driver: 'Unassigned', navigator: 'Unassigned', territory: 'New Orleans', assignment: 'Removed from dispatch', location: 'Laplace shop', gpsAge: '3 min', gpsFresh: true, odometer: 109740, checklist: 'Complete', loadPercent: 0, loadNote: 'Empty · shop hold', metalNote: 'No metal', nextService: 'Return-to-service inspection', serviceTone: 'due', driverScore: null, jobs: 0, revenue: 0, miles: 0, idleMinutes: 0 },
  { id: 'FT-7', label: 'Truck 7', vehicle: '2020 Isuzu NPR', readiness: 'Ready', operatingStatus: 'Available', driver: 'Krewe assignment', navigator: 'Krewe assignment', territory: 'Baton Rouge', assignment: 'JK4001271 · Denham Springs', location: 'Denham Springs', gpsAge: '5 min', gpsFresh: true, odometer: 88410, checklist: 'Complete', loadPercent: 0, loadNote: 'Empty and available', metalNote: 'No metal', nextService: 'Oil · 880 mi', serviceTone: 'soon', driverScore: 89, jobs: 15, revenue: 6120, miles: 447, idleMinutes: 69 },
];

const initialFleetIssues: FleetIssue[] = [
  { id: 'FI-204', truckId: 'FT-4', title: 'Front passenger tire', description: 'Wear noted during daily inspection; confirm tread depth before the next full route.', severity: 'Monitor', status: 'Open', owner: 'Tire shop', due: 'Sep 3', cost: null, downtime: 0, resolution: '' },
  { id: 'FI-205', truckId: 'FT-9', title: 'Hydraulic seep', description: 'Light seep at lift assembly. Inspection and repair decision required.', severity: 'Repair soon', status: 'In progress', owner: 'Fleet shop', due: 'Sep 2', cost: null, downtime: 1.5, resolution: '' },
  { id: 'FI-206', truckId: 'FT-6', title: 'Rear door latch', description: 'Latch will not secure consistently. Truck remains out of service.', severity: 'Out of service', status: 'Open', owner: 'Fleet shop', due: 'Sep 1', cost: null, downtime: 8, resolution: '' },
  { id: 'FI-197', truckId: 'FT-2', title: 'Rear door adjustment', description: 'Door alignment repaired and verified.', severity: 'Repair soon', status: 'Resolved', owner: 'Fleet shop', due: 'Aug 27', cost: 420, downtime: 3.5, resolution: 'Adjusted hinges, replaced latch hardware, and verified secure closure.' },
];

const serviceTypes = [
  { key: 'oil', label: 'Oil and filter', interval: 'Every 5,000 miles or 180 days' },
  { key: 'tires', label: 'Tire inspection', interval: 'Every 30 days' },
  { key: 'brakes', label: 'Brake inspection', interval: 'Every 90 days' },
  { key: 'hydraulics', label: 'Hydraulic / lift service', interval: 'Every 90 days' },
  { key: 'inspection', label: 'Annual vehicle inspection', interval: 'Every 365 days' },
];

const initialMarketingLeads: MarketingLead[] = [
  { id: 'SK-4182', customer: 'Sample Customer', phone: '(504) 555-0182', territory: 'New Orleans', intent: 'Full garage cleanout', quotedValue: 980, status: 'Lost', age: '24 min', source: 'SearchKings · Paid Search', reason: 'Call ended after pricing discussion.', lastContact: 'No outbound contact', callDuration: '4m 18s' },
  { id: 'SK-4180', customer: 'Example Resident', phone: '(985) 555-0140', territory: 'Northshore', intent: 'Hot tub removal', quotedValue: 650, status: 'Lost', age: '38 min', source: 'SearchKings · Google Ads', reason: 'Customer wanted a same-day answer.', lastContact: 'No outbound contact', callDuration: '3m 42s' },
  { id: 'SK-4176', customer: 'Sample Office', phone: '(225) 555-0176', territory: 'Baton Rouge', intent: 'Commercial furniture pickup', quotedValue: 1250, status: 'Needs follow-up', age: '52 min', source: 'SearchKings · Organic', reason: 'Decision-maker requested a callback.', lastContact: 'Callback due by 11:00 AM', callDuration: '6m 05s' },
  { id: 'SK-4171', customer: 'Example Home', phone: '(504) 555-0171', territory: 'Jefferson Parish', intent: 'Appliance and debris removal', quotedValue: 475, status: 'Lost', age: '1h 16m', source: 'SearchKings · Paid Search', reason: 'No appointment was placed after qualification.', lastContact: 'Voicemail left at 9:18 AM', callDuration: '2m 51s' },
  { id: 'SK-4168', customer: 'Sample Resident', phone: '(985) 555-0168', territory: 'Northshore', intent: 'Estate cleanout estimate', quotedValue: null, status: 'Needs follow-up', age: '1h 34m', source: 'SearchKings · Google Business', reason: 'Photos and estimate window still needed.', lastContact: 'Text requested by customer', callDuration: '5m 27s' },
  { id: 'SK-4159', customer: 'Example Customer', phone: '(337) 555-0159', territory: 'Lafayette', intent: 'Shed removal', quotedValue: 720, status: 'Booked', age: 'Yesterday', source: 'SearchKings · Paid Search', reason: 'Matched to a JunkWare appointment.', lastContact: 'Booked · JK4001412', callDuration: '7m 12s' },
];

const initialMarketingReviews: MarketingReview[] = [
  { id: 'RV-301', customer: 'Sample Customer', location: 'New Orleans', stars: 5, age: '18 min', excerpt: 'The team was fast, careful, and communicated the whole time.', selectedAppointment: 'JK4001204', candidates: ['JK4001204', 'JK4001280'], status: 'Needs attribution' },
  { id: 'RV-298', customer: 'Example Resident', location: 'Northshore', stars: 5, age: '2h', excerpt: 'Great service and the crew arrived exactly when promised.', selectedAppointment: 'JK4001241', candidates: ['JK4001241', 'JK4001338'], status: 'Needs attribution' },
  { id: 'RV-294', customer: 'Sample Office', location: 'Baton Rouge', stars: 4, age: 'Yesterday', excerpt: 'Very professional commercial pickup. Scheduling was easy.', selectedAppointment: 'JK4001306', candidates: ['JK4001306', 'JK4001344'], status: 'Needs attribution' },
  { id: 'RV-289', customer: 'Example Home', location: 'Jefferson Parish', stars: 5, age: 'Yesterday', excerpt: 'Pricing was clear and the truck team did an excellent job.', selectedAppointment: 'JK4001260', candidates: ['JK4001260', 'JK4001332'], status: 'Needs attribution' },
];

const marketingSources = [
  { source: 'SearchKings · Paid Search', calls: 214, qualified: 108, bookings: 61, completed: 43, revenue: 39860, cost: 12420 },
  { source: 'Google Business Profile', calls: 91, qualified: 47, bookings: 26, completed: 19, revenue: 17140, cost: 0 },
  { source: 'Organic Search', calls: 52, qualified: 24, bookings: 11, completed: 8, revenue: 7420, cost: 1820 },
  { source: 'Referral / Direct', calls: 27, qualified: 8, bookings: 5, completed: 4, revenue: 4000, cost: 0 },
];

const initialFinancePayments: FinancePayment[] = [
  { id: 'JK4001204', customer: 'Example Office', truck: 'Truck 8', jobTotal: 1248, paymentAmount: 1215, adjustment: 0, method: 'Card · 4242', reference: 'QP-89241', status: 'Needs review', note: 'Recorded total exceeds the captured card payment by $33.00.' },
  { id: 'JK4001241', customer: 'Example Resident', truck: 'Truck 2', jobTotal: 535, paymentAmount: 535, adjustment: 0, method: 'Card · 8817', reference: 'QP-89256', status: 'Matched', note: 'Exact payment match.' },
  { id: 'JK4001260', customer: 'Sample Customer', truck: 'Truck 4', jobTotal: 575, paymentAmount: 575, adjustment: 0, method: 'Cash', reference: 'TR-40186', status: 'Matched', note: 'Cash recorded in the truck closeout.' },
];

const initialFinanceRecoveryItems: FinanceRecoveryItem[] = [
  { id: 'RR-204', kind: 'Resale', sourceJob: 'JK4001204', item: 'Commercial steel shelving', location: 'Kenner warehouse', quantity: '4 sections', expectedValue: 350, realizedValue: null, status: 'Awaiting disposition', owner: 'Mission Control', age: '2h', note: 'Photos and dimensions recorded at closeout.' },
  { id: 'RR-201', kind: 'Resale', sourceJob: 'JK4001241', item: 'Teak patio set', location: 'New Orleans warehouse', quantity: '5 pieces', expectedValue: 600, realizedValue: null, status: 'Listed', owner: 'Resale team', age: '1d', note: 'Listed locally; buyer messages pending.' },
  { id: 'RR-194', kind: 'Resale', sourceJob: 'JK4001098', item: 'Vintage record cabinet', location: 'Northshore storage', quantity: '1 item', expectedValue: 275, realizedValue: 240, status: 'Sold', owner: 'Resale team', age: '4d', note: 'Payment received and item released.' },
  { id: 'RC-118', kind: 'Recycling', sourceJob: 'JK4001260', item: 'Mixed appliance metal', location: 'Truck 4', quantity: '420 lb estimated', expectedValue: 82, realizedValue: null, status: 'Ticket missing', owner: 'Carlos Diaz', age: '3h', note: 'Yard visit recorded; weight ticket has not been attached.' },
  { id: 'RC-114', kind: 'Recycling', sourceJob: 'JK4001194', item: 'Copper and insulated wire', location: 'EMR Harvey', quantity: '86 lb', expectedValue: 214, realizedValue: 226, status: 'Paid', owner: 'Mission Control', age: '2d', note: 'Ticket and yard payment reconciled.' },
  { id: 'RC-109', kind: 'Recycling', sourceJob: 'JK4001168', item: 'Aluminum patio material', location: 'Baton Rouge yard', quantity: '240 lb', expectedValue: 98, realizedValue: 104, status: 'Submitted', owner: 'Brandon Lee', age: '3d', note: 'Ticket recorded; payment confirmation pending.' },
];

const financeCosts = [
  { category: 'Payroll and Krewe earnings', amount: 22940, prior: 21880, source: 'Krewe + payroll records' },
  { category: 'Disposal and landfill', amount: 10620, prior: 10240, source: 'Truck Records' },
  { category: 'Fuel', amount: 6140, prior: 5920, source: 'QBO + fuel cards' },
  { category: 'Repairs and maintenance', amount: 4280, prior: 3710, source: 'Fleet + QBO' },
  { category: 'Marketing', amount: 7240, prior: 6980, source: 'QBO + SearchKings' },
  { category: 'Insurance and overhead', amount: 3500, prior: 3410, source: 'QBO' },
];

const financeTerritories = [
  { territory: 'New Orleans', jobs: 82, revenue: 38240, costs: 8980, margin: 76.5 },
  { territory: 'Jefferson Parish', jobs: 64, revenue: 29180, costs: 7240, margin: 75.2 },
  { territory: 'Northshore', jobs: 57, revenue: 24760, costs: 6380, margin: 74.2 },
  { territory: 'Baton Rouge', jobs: 49, revenue: 21620, costs: 5880, margin: 72.8 },
  { territory: 'Lafayette', jobs: 34, revenue: 14840, costs: 3300, margin: 77.8 },
];

const financeMonthlyTrend = [
  { month: 'Jan', revenue: 111420, jobs: 251, costs: 51200, profit: 60220 },
  { month: 'Feb', revenue: 116850, jobs: 259, costs: 52680, profit: 64170 },
  { month: 'Mar', revenue: 124310, jobs: 274, costs: 54820, profit: 69490 },
  { month: 'Apr', revenue: 119760, jobs: 266, costs: 53740, profit: 66020 },
  { month: 'May', revenue: 132440, jobs: 291, costs: 57690, profit: 74750 },
  { month: 'Jun', revenue: 138920, jobs: 304, costs: 60120, profit: 78800 },
  { month: 'Jul', revenue: 120440, jobs: 274, costs: 53360, profit: 67080 },
  { month: 'Aug', revenue: 128640, jobs: 286, costs: 54720, profit: 73920 },
];

const kreweTruckOptions = ['Truck 2', 'Truck 4', 'Truck 8', 'Truck 9', 'Truck 3', 'Truck 5', 'Truck 6', 'Truck 7', 'Unassigned'];
const truckTerritory: Record<string, string> = { 'Truck 2': 'Northshore', 'Truck 4': 'Jefferson Parish', 'Truck 8': 'New Orleans', 'Truck 9': 'Baton Rouge', 'Truck 3': 'Northshore', 'Truck 5': 'Baton Rouge', 'Truck 6': 'New Orleans', 'Truck 7': 'Baton Rouge' };
const timeLabelToInput = (label: string) => {
  if (label === '—') return '';
  const match = label.match(/(\d+):(\d+)\s(AM|PM)/);
  if (!match) return '';
  let hour = Number(match[1]);
  if (match[3] === 'PM' && hour !== 12) hour += 12;
  if (match[3] === 'AM' && hour === 12) hour = 0;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
};
const timeInputToLabel = (value: string) => {
  if (!value) return '—';
  const [rawHour, minute] = value.split(':').map(Number);
  const suffix = rawHour >= 12 ? 'PM' : 'AM';
  const hour = rawHour % 12 || 12;
  return `${hour}:${String(minute).padStart(2, '0')} ${suffix}`;
};
const moneyValue = (value: number | null | undefined) => value == null
  ? '—'
  : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value);
const parseMoneyValue = (value: string) => Number(value.replace(/[^0-9.-]/g, ''));
const isFinalAppointmentState = (state: string) => ['Completed', 'Estimate Closed', 'Canceled'].includes(state);
const metricValue = (value: number | null | undefined, suffix = '') => value == null ? '—' : `${value.toFixed(value % 1 === 0 ? 0 : 1)}${suffix}`;
const googleMapsHref = (address: string) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
const unavailableAddresses = new Set(['Address unavailable', 'No service address', '']);

function GoogleMapsAddress({ address }: { address: string }) {
  if (unavailableAddresses.has(address.trim())) return <strong>{address}</strong>;
  return (
    <strong className="google-maps-address-shell">
      <a
        className="google-maps-address"
        href={googleMapsHref(address)}
        target="_blank"
        rel="noreferrer noopener"
        aria-label={`Open ${address} in Google Maps`}
        title="Open in Google Maps"
      >
        {address}
      </a>
    </strong>
  );
}

function PhoneContact({ phone, copy = false }: { phone: string; copy?: boolean }) {
  const [copied, setCopied] = useState(false);
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return <span>{phone}</span>;
  const dialingNumber = digits.length === 10 ? `+1${digits}` : digits.startsWith('1') ? `+${digits}` : digits;
  const copyPhone = () => {
    if (!navigator.clipboard) return;
    void navigator.clipboard.writeText(phone).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <span className="phone-contact">
      <a className="phone-link" href={`tel:${dialingNumber}`} aria-label={`Call ${phone}`}>{phone}</a>
      {copy && (
        <button className={copied ? 'phone-copy copied' : 'phone-copy'} type="button" onClick={copyPhone} aria-label={copied ? `${phone} copied` : `Copy ${phone}`} title={copied ? 'Copied' : 'Copy phone number'}>
          {copied ? <Check size={11} /> : <Copy size={11} />}
        </button>
      )}
    </span>
  );
}
const routeClockLabel = (minutes: number) => {
  const normalized = ((minutes % 1440) + 1440) % 1440;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${hour % 12 || 12}:${String(minute).padStart(2, '0')} ${hour >= 12 ? 'PM' : 'AM'}`;
};
const workedHoursFromCorrection = (clockIn: string, clockOut: string) => {
  if (!clockIn) return null;
  const [inHour, inMinute] = clockIn.split(':').map(Number);
  const [outHour, outMinute] = (clockOut || '10:24').split(':').map(Number);
  return Math.max(0, Math.round((((outHour * 60) + outMinute - ((inHour * 60) + inMinute)) / 60) * 10) / 10);
};

const scheduleTimes = ['8 AM', '9 AM', '10 AM', '11 AM', '12 PM', '1 PM', '2 PM', '3 PM', '4 PM'];
const scheduleBoard: ScheduleRow[] = [
  {
    truck: 'Truck 2', crew: 'Crew A', status: 'On route', tone: 'blue',
    jobs: [
      { start: 1, duration: 2, time: '9:00–11:00', jk: 'JK4001241', customer: 'Example Resident', area: 'Covington', kind: 'Job', state: 'On site' },
      { start: 4, duration: 1, time: '12:00–1:00', jk: 'JK4001292', customer: 'Sample Customer', area: 'Mandeville', kind: 'Estimate', state: 'Confirmed' },
      { start: 6, duration: 2, time: '2:00–4:00', jk: 'JK4001310', customer: 'Example Home', area: 'Slidell', kind: 'Job', state: 'Confirmed' },
    ],
  },
  {
    truck: 'Truck 4', crew: 'Crew B', status: 'En route', tone: 'red',
    jobs: [
      { start: 0, duration: 2, time: '8:00–10:00', jk: 'JK4001228', customer: 'Sample Resident', area: 'Metairie', kind: 'Job', state: 'Completed' },
      { start: 3, duration: 2, time: '11:00–1:00', jk: 'JK4001260', customer: 'Example Customer', area: 'Kenner', kind: 'Job', state: 'En route' },
      { start: 7, duration: 1, time: '3:00–4:00', jk: 'JK4001332', customer: 'Sample Home', area: 'Harahan', kind: 'Estimate', state: 'Confirmed' },
    ],
  },
  {
    truck: 'Truck 8', crew: 'Crew C', status: 'Available', tone: 'gold',
    jobs: [
      { start: 1, duration: 1, time: '9:00–10:00', jk: 'JK4001204', customer: 'Example Office', area: 'New Orleans', kind: 'Job', state: 'Completed' },
      { start: 4, duration: 2, time: '12:00–2:00', jk: 'JK4001280', customer: 'Sample Customer', area: 'Chalmette', kind: 'Job', state: 'Call ahead' },
      { start: 8, duration: 1, time: '4:00–5:00', jk: 'JK4001344', customer: 'Example Resident', area: 'New Orleans East', kind: 'Estimate', state: 'Confirmed' },
    ],
  },
  {
    truck: 'Truck 9', crew: 'Crew D', status: 'Route gap', tone: 'purple',
    jobs: [
      { start: 0, duration: 1, time: '8:00–9:00', jk: 'JK4001217', customer: 'Sample Customer', area: 'Baton Rouge', kind: 'Job', state: 'Completed' },
      { start: 2, duration: 2, time: '10:00–12:00', jk: 'JK4001254', customer: 'Example Resident', area: 'Prairieville', kind: 'Job', state: 'Confirmed' },
      { start: 6, duration: 2, time: '2:00–4:00', jk: 'Open capacity', customer: 'Route gap', area: 'Baton Rouge', kind: 'Open', state: 'Needs plan' },
    ],
  },
  {
    truck: 'Truck 3', crew: 'Crew E', status: 'On route', tone: 'blue',
    jobs: [
      { start: 2, duration: 2, time: '10:00–12:00', jk: 'JK4001258', customer: 'Example Customer', area: 'Hammond', kind: 'Job', state: 'Confirmed' },
    ],
  },
  {
    truck: 'Truck 5', crew: 'Crew F', status: 'Available', tone: 'gold',
    jobs: [
      { start: 5, duration: 1, time: '1:00–2:00', jk: 'JK4001306', customer: 'Sample Office', area: 'Gonzales', kind: 'Estimate', state: 'Confirmed' },
    ],
  },
  {
    truck: 'Truck 6', crew: 'Crew G', status: 'On route', tone: 'red',
    jobs: [
      { start: 7, duration: 1, time: '3:00–4:00', jk: 'JK4001338', customer: 'Example Home', area: 'Laplace', kind: 'Job', state: 'Call ahead' },
    ],
  },
  {
    truck: 'Truck 7', crew: 'Crew H', status: 'Available', tone: 'purple',
    jobs: [
      { start: 3, duration: 1, time: '11:00–12:00', jk: 'JK4001271', customer: 'Sample Resident', area: 'Denham Springs', kind: 'Job', state: 'Confirmed' },
    ],
  },
  {
    truck: 'Unassigned', crew: 'Virtual', status: 'Needs dispatch', tone: 'neutral',
    jobs: [
      { start: 5, duration: 1, time: '1:00–2:00', jk: 'JK4001301', customer: 'Sample Resident', area: 'Gretna', kind: 'Job', state: 'Assign truck' },
    ],
  },
];

const plannedJob = (
  jk: string, start: number, duration: number, time: string, customer: string, area: string, kind: 'Job' | 'Estimate',
  phone: string, address: string, scope: string, value: string, notes: string, addressVerified = true,
): ScheduleJob => ({
  jk, start, duration, time, customer, area, kind, state: 'Confirmed', addressVerified,
  details: { phone, address, scope, value, notes },
});

const tomorrowScheduleBoard: ScheduleRow[] = [
  {
    truck: 'Truck 2', crew: 'Crew A', status: 'Planned', tone: 'blue', jobs: [
      plannedJob('JK4001401', 0, 2, '8:00–10:00', 'Northshore Storage', 'Covington', 'Job', '(985) 555-0201', '410 North Columbia Street, Covington, LA 70433', 'Storage unit cleanout', '$840', 'Unit 12 · Office has access code'),
      plannedJob('JK4001407', 5, 1, '1:00–2:00', 'Sample Resident', 'Mandeville', 'Estimate', '(985) 555-0207', '1825 Florida Street, Mandeville, LA 70448', 'Garage estimate', '$475 quoted', 'Call before arrival', false),
    ],
  },
  {
    truck: 'Truck 4', crew: 'Crew B', status: 'Planned', tone: 'red', jobs: [
      plannedJob('JK4001402', 1, 2, '9:00–11:00', 'Example Office', 'Metairie', 'Job', '(504) 555-0202', '3300 Causeway Boulevard, Metairie, LA 70002', 'Office furniture removal', '$1,120', 'Use freight entrance'),
      plannedJob('JK4001408', 6, 2, '2:00–4:00', 'Sample Home', 'Kenner', 'Job', '(504) 555-0208', '2100 Williams Boulevard, Kenner, LA 70062', 'Household cleanout', '$760', 'Customer requests call ahead'),
    ],
  },
  {
    truck: 'Truck 8', crew: 'Crew C', status: 'Planned', tone: 'gold', jobs: [
      plannedJob('JK4001403', 0, 1, '8:00–9:00', 'Warehouse Sample', 'New Orleans', 'Job', '(504) 555-0203', '801 Tchoupitoulas Street, New Orleans, LA 70130', 'Commercial pickup', '$680', 'Loading zone reserved'),
      plannedJob('JK4001409', 4, 2, '12:00–2:00', 'Example Resident', 'Chalmette', 'Estimate', '(504) 555-0209', '1915 Paris Road, Chalmette, LA 70043', 'Appliance estimate', '$390 quoted', 'Photos attached', false),
    ],
  },
  {
    truck: 'Truck 9', crew: 'Crew D', status: 'Planned', tone: 'purple', jobs: [
      plannedJob('JK4001404', 2, 2, '10:00–12:00', 'Sample Customer', 'Baton Rouge', 'Job', '(225) 555-0204', '7474 Corporate Boulevard, Baton Rouge, LA 70809', 'Apartment cleanout', '$915', 'Property manager on site'),
      plannedJob('JK4001410', 7, 2, '3:00–5:00', 'Example Builder', 'Prairieville', 'Job', '(225) 555-0210', '17100 Airline Highway, Prairieville, LA 70769', 'Construction debris', '$1,080', 'Driveway access confirmed'),
    ],
  },
  {
    truck: 'Truck 3', crew: 'Crew E', status: 'Planned', tone: 'blue', jobs: [
      plannedJob('JK4001405', 3, 2, '11:00–1:00', 'Hammond Retail', 'Hammond', 'Job', '(985) 555-0205', '1200 West Thomas Street, Hammond, LA 70401', 'Retail fixture removal', '$790', 'Meet store manager'),
    ],
  },
  {
    truck: 'Truck 5', crew: 'Crew F', status: 'Planned', tone: 'gold', jobs: [
      plannedJob('JK4001411', 5, 2, '1:00–3:00', 'Ascension Office', 'Gonzales', 'Estimate', '(225) 555-0211', '1500 South Burnside Avenue, Gonzales, LA 70737', 'Office cleanout estimate', '$725 quoted', 'Facilities contact in lobby', false),
    ],
  },
  {
    truck: 'Truck 6', crew: 'Crew G', status: 'Planned', tone: 'red', jobs: [
      plannedJob('JK4001406', 1, 1, '9:00–10:00', 'River Parish Home', 'Laplace', 'Job', '(985) 555-0206', '1016 Main Street, Laplace, LA 70068', 'Yard debris removal', '$495', 'Gate unlocked at 8:30 AM'),
    ],
  },
  {
    truck: 'Truck 7', crew: 'Crew H', status: 'Planned', tone: 'purple', jobs: [
      plannedJob('JK4001412', 6, 1, '2:00–3:00', 'Lafayette Sample', 'Lafayette', 'Job', '(337) 555-0212', '210 Jefferson Street, Lafayette, LA 70501', 'Furniture removal', '$560', 'Elevator reserved'),
    ],
  },
  { truck: 'Unassigned', crew: 'Virtual', status: 'Clear', tone: 'neutral', jobs: [] },
];

const appointmentDetails: Record<string, { phone: string; address: string; scope: string; value: string; notes: string }> = {
  JK4001241: { phone: '(985) 555-0141', address: '214 Pine Street, Covington, LA 70433', scope: 'Full truck cleanout', value: '$742', notes: 'Gate code confirmed · Customer on site' },
  JK4001292: { phone: '(985) 555-0192', address: '88 Magnolia Drive, Mandeville, LA 70471', scope: 'Garage estimate', value: '$425 quoted', notes: 'Review photos before arrival' },
  JK4001310: { phone: '(985) 555-0110', address: '1200 Gause Boulevard, Slidell, LA 70458', scope: 'Furniture removal', value: '$615', notes: 'Call 20 minutes ahead' },
  JK4001228: { phone: '(504) 555-0128', address: '4516 Lake Villa Drive, Metairie, LA 70002', scope: 'Estate cleanout', value: '$1,180', notes: 'Payment and photos verified' },
  JK4001260: { phone: '(504) 555-0160', address: '930 Williams Boulevard, Kenner, LA 70062', scope: 'Office cleanout', value: '$860', notes: 'Loading dock behind building' },
  JK4001332: { phone: '(504) 555-0132', address: '711 Colonial Club Drive, Harahan, LA 70123', scope: 'Shed estimate', value: '$390 quoted', notes: 'Text customer on arrival' },
  JK4001204: { phone: '(504) 555-0104', address: '625 Poydras Street, New Orleans, LA 70130', scope: 'Commercial pickup', value: '$535', notes: 'Closeout complete' },
  JK4001280: { phone: '(504) 555-0180', address: '3015 Paris Road, Chalmette, LA 70043', scope: 'Appliance removal', value: '$480', notes: 'Call ahead required · Side entrance' },
  JK4001344: { phone: '(504) 555-0144', address: '7821 Hayne Boulevard, New Orleans, LA 70126', scope: 'Attic estimate', value: '$525 quoted', notes: 'Address verified this morning' },
  JK4001217: { phone: '(225) 555-0117', address: '10432 Jefferson Highway, Baton Rouge, LA 70809', scope: 'Apartment cleanout', value: '$695', notes: 'Completed · Awaiting closeout review' },
  JK4001254: { phone: '(225) 555-0154', address: '17342 Airline Highway, Prairieville, LA 70769', scope: 'Construction debris', value: '$925', notes: 'Two-person carry · Driveway access' },
  JK4001258: { phone: '(985) 555-0158', address: '1400 West Thomas Street, Hammond, LA 70401', scope: 'Storage cleanout', value: '$780', notes: 'Unit B14 · Manager has key' },
  JK4001306: { phone: '(225) 555-0106', address: '1225 East Ascension Street, Gonzales, LA 70737', scope: 'Office estimate', value: '$610 quoted', notes: 'Meet facilities manager in lobby' },
  JK4001338: { phone: '(985) 555-0138', address: '901 Main Street, Laplace, LA 70068', scope: 'Yard debris', value: '$445', notes: 'Call ahead · Dog in rear yard' },
  JK4001271: { phone: '(225) 555-0171', address: '307 Range Avenue, Denham Springs, LA 70726', scope: 'Furniture removal', value: '$520', notes: 'Second-floor pickup · Elevator reserved' },
  JK4001301: { phone: '(504) 555-0101', address: '1700 Lafayette Street, Gretna, LA 70053', scope: 'Household cleanout', value: '$675', notes: 'Truck assignment required' },
};

type ScheduleTerritory = 'New Orleans' | 'Jefferson Parish' | 'Northshore' | 'Baton Rouge' | 'Lafayette';
const territoryOrder: ScheduleTerritory[] = ['New Orleans', 'Jefferson Parish', 'Northshore', 'Baton Rouge', 'Lafayette'];
const territoryDesignators: Record<ScheduleTerritory, string> = {
  'New Orleans': 'NO', 'Jefferson Parish': 'JP', Northshore: 'NS', 'Baton Rouge': 'BR', Lafayette: 'LF',
};
const appointmentTerritoryForArea = (area: string): ScheduleTerritory => {
  if (['Covington', 'Mandeville', 'Slidell', 'Hammond'].includes(area)) return 'Northshore';
  if (['Baton Rouge', 'Prairieville', 'Gonzales', 'Denham Springs'].includes(area)) return 'Baton Rouge';
  if (['Metairie', 'Kenner', 'Harahan', 'Gretna'].includes(area)) return 'Jefferson Parish';
  if (['Lafayette', 'Broussard', 'Carencro'].includes(area)) return 'Lafayette';
  return 'New Orleans';
};
const areaDesignatorForArea = (area: string): { code: string; label: string } => {
  if (['Chalmette', 'New Orleans East'].includes(area)) return { code: 'EM', label: 'East Metro' };
  if (area === 'Gretna') return { code: 'WB', label: 'Westbank' };
  if (area === 'Laplace') return { code: 'RP', label: 'River Parishes' };
  if (['Prairieville', 'Gonzales'].includes(area)) return { code: 'ASC', label: 'Ascension' };
  if (area === 'Denham Springs') return { code: 'LIV', label: 'Livingston' };
  const codes: Record<string, string> = {
    'New Orleans': 'NO', Metairie: 'MET', Kenner: 'KEN', Harahan: 'HAR',
    Covington: 'COV', Mandeville: 'MAN', Slidell: 'SLI', Hammond: 'HAM', 'Baton Rouge': 'BR',
    Lafayette: 'LAF', Broussard: 'BRO', Carencro: 'CAR',
  };
  return { code: codes[area] || area.slice(0, 3).toUpperCase(), label: area };
};

const buildScheduledAppointments = (rows: ScheduleRow[]) => rows.flatMap((row) => row.jobs
  .filter((job) => job.jk !== 'Open capacity')
  .map((job) => ({
    ...job,
    addressVerified: job.addressVerified ?? !['JK4001292', 'JK4001301', 'JK4001306', 'JK4001332'].includes(job.jk),
    truck: row.truck, crew: row.crew,
    territory: appointmentTerritoryForArea(job.area), areaDesignator: areaDesignatorForArea(job.area),
    details: job.details || appointmentDetails[job.jk] || { phone: 'Not available', address: 'Address unavailable', scope: job.kind, value: 'Not available', notes: 'Review source appointment' },
  })));
const routeEstimateOverrides: Record<string, { minutes: number; miles: number }> = {
  'Covington>Mandeville': { minutes: 24, miles: 17.2 },
  'Mandeville>Slidell': { minutes: 29, miles: 24.6 },
  'Metairie>Kenner': { minutes: 16, miles: 8.4 },
  'Kenner>Harahan': { minutes: 19, miles: 10.1 },
  'New Orleans>Chalmette': { minutes: 22, miles: 9.8 },
  'Chalmette>New Orleans East': { minutes: 18, miles: 8.6 },
  'Baton Rouge>Prairieville': { minutes: 24, miles: 17.5 },
};
const routeEstimate = (from: string, to: string) => {
  const exact = routeEstimateOverrides[`${from}>${to}`] || routeEstimateOverrides[`${to}>${from}`];
  if (exact) return exact;
  if (from === to) return { minutes: 12, miles: 5.2 };
  const sameTerritory = appointmentTerritoryForArea(from) === appointmentTerritoryForArea(to);
  const seed = [...`${from}>${to}`].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const minutes = sameTerritory ? 22 + (seed % 12) : 48 + (seed % 28);
  return { minutes, miles: Math.round((minutes * (sameTerritory ? .63 : .72)) * 10) / 10 };
};
const routeToneForBuffer = (buffer: number): RouteLegTone => buffer < 0 ? 'late' : buffer < 20 ? 'tight' : 'clear';
const buildRouteLegs = (row: ScheduleRow): RouteLeg[] => {
  const jobs = row.jobs.filter((job) => job.jk !== 'Open capacity').sort((a, b) => a.start - b.start);
  return jobs.slice(0, -1).flatMap((from, index) => {
    const to = jobs[index + 1];
    const gap = to.start - (from.start + from.duration);
    if (gap <= 0) return [];
    const estimate = routeEstimate(from.area, to.area);
    const buffer = (gap * 60) - estimate.minutes;
    return [{ from, to, ...estimate, buffer, tone: routeToneForBuffer(buffer) }];
  });
};
const groupAppointmentsByTerritory = (appointments: ReturnType<typeof buildScheduledAppointments>) => territoryOrder.map((territory) => {
  const territoryAppointments = appointments.filter((appointment) => appointment.territory === territory);
  const areaKeys = Array.from(new Set(territoryAppointments.map((appointment) => appointment.areaDesignator.code)));
  return {
    territory,
    designator: territoryDesignators[territory],
    appointments: territoryAppointments,
    areas: areaKeys.map((code) => ({
      code,
      label: territoryAppointments.find((appointment) => appointment.areaDesignator.code === code)?.areaDesignator.label || code,
      appointments: territoryAppointments.filter((appointment) => appointment.areaDesignator.code === code),
    })),
  };
}).filter((group) => group.appointments.length > 0);

const scheduleWindowOptions = [
  { label: '8:00–9:00 AM', value: '8:00–9:00', start: 0, duration: 1 },
  { label: '8:00–10:00 AM', value: '8:00–10:00', start: 0, duration: 2 },
  { label: '9:00–10:00 AM', value: '9:00–10:00', start: 1, duration: 1 },
  { label: '9:00–11:00 AM', value: '9:00–11:00', start: 1, duration: 2 },
  { label: '10:00–11:00 AM', value: '10:00–11:00', start: 2, duration: 1 },
  { label: '10:00 AM–12:00 PM', value: '10:00–12:00', start: 2, duration: 2 },
  { label: '11:00 AM–12:00 PM', value: '11:00–12:00', start: 3, duration: 1 },
  { label: '11:00 AM–1:00 PM', value: '11:00–1:00', start: 3, duration: 2 },
  { label: '12:00–1:00 PM', value: '12:00–1:00', start: 4, duration: 1 },
  { label: '12:00–2:00 PM', value: '12:00–2:00', start: 4, duration: 2 },
  { label: '1:00–2:00 PM', value: '1:00–2:00', start: 5, duration: 1 },
  { label: '1:00–3:00 PM', value: '1:00–3:00', start: 5, duration: 2 },
  { label: '2:00–3:00 PM', value: '2:00–3:00', start: 6, duration: 1 },
  { label: '2:00–4:00 PM', value: '2:00–4:00', start: 6, duration: 2 },
  { label: '3:00–4:00 PM', value: '3:00–4:00', start: 7, duration: 1 },
  { label: '3:00–5:00 PM', value: '3:00–5:00', start: 7, duration: 2 },
  { label: '4:00–5:00 PM', value: '4:00–5:00', start: 8, duration: 1 },
];

const newAppointmentAreaOptions = [
  'New Orleans', 'Chalmette', 'New Orleans East', 'Laplace',
  'Metairie', 'Kenner', 'Harahan', 'Gretna',
  'Covington', 'Mandeville', 'Slidell', 'Hammond',
  'Baton Rouge', 'Prairieville', 'Gonzales', 'Denham Springs',
  'Lafayette', 'Broussard', 'Carencro',
];
const serviceAreaCoordinates: Record<string, { latitude: number; longitude: number }> = {
  'New Orleans': { latitude: 29.9511, longitude: -90.0715 }, Chalmette: { latitude: 29.9433, longitude: -89.9634 }, 'New Orleans East': { latitude: 30.033, longitude: -89.958 }, Laplace: { latitude: 30.0666, longitude: -90.4815 },
  Metairie: { latitude: 29.9841, longitude: -90.1529 }, Kenner: { latitude: 29.9941, longitude: -90.2417 }, Harahan: { latitude: 29.9405, longitude: -90.2031 }, Gretna: { latitude: 29.9146, longitude: -90.0539 },
  Covington: { latitude: 30.4755, longitude: -90.1009 }, Mandeville: { latitude: 30.3583, longitude: -90.0656 }, Slidell: { latitude: 30.2752, longitude: -89.7812 }, Hammond: { latitude: 30.5044, longitude: -90.4612 },
  'Baton Rouge': { latitude: 30.4515, longitude: -91.1871 }, Prairieville: { latitude: 30.302, longitude: -90.972 }, Gonzales: { latitude: 30.2385, longitude: -90.92 }, 'Denham Springs': { latitude: 30.4869, longitude: -90.9562 },
  Lafayette: { latitude: 30.2241, longitude: -92.0198 }, Broussard: { latitude: 30.1471, longitude: -91.9612 }, Carencro: { latitude: 30.3171, longitude: -92.049 },
};
const serviceAreaZipPrefixes: Array<{ pattern: RegExp; area: string }> = [
  { pattern: /\b701(1[2-9]|2[0-6]|30|31|39|63)\b/, area: 'New Orleans' }, { pattern: /\b7012[7-9]\b/, area: 'New Orleans East' },
  { pattern: /\b70043\b/, area: 'Chalmette' }, { pattern: /\b7006[12]\b/, area: 'Laplace' }, { pattern: /\b7000[1-6]\b/, area: 'Metairie' },
  { pattern: /\b7006[25]\b/, area: 'Kenner' }, { pattern: /\b70123\b/, area: 'Harahan' }, { pattern: /\b7005[36]\b/, area: 'Gretna' },
  { pattern: /\b7043[35]\b/, area: 'Covington' }, { pattern: /\b704(48|71)\b/, area: 'Mandeville' }, { pattern: /\b704(58|60|61)\b/, area: 'Slidell' }, { pattern: /\b7040[13]\b/, area: 'Hammond' },
  { pattern: /\b708\d{2}\b/, area: 'Baton Rouge' }, { pattern: /\b70769\b/, area: 'Prairieville' }, { pattern: /\b70737\b/, area: 'Gonzales' }, { pattern: /\b70726\b/, area: 'Denham Springs' },
  { pattern: /\b70518\b/, area: 'Broussard' }, { pattern: /\b70520\b/, area: 'Carencro' }, { pattern: /\b705\d{2}\b/, area: 'Lafayette' },
];
const buildPrototypeAddressPin = (area: string, address: string) => {
  const center = serviceAreaCoordinates[area] || serviceAreaCoordinates['New Orleans'];
  const seed = [...address].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  const latitude = center.latitude + (((seed % 17) - 8) / 1000);
  const longitude = center.longitude + ((((Math.floor(seed / 17)) % 17) - 8) / 1000);
  const bbox = `${longitude - .018},${latitude - .012},${longitude + .018},${latitude + .012}`;
  return {
    latitude: Math.round(latitude * 100000) / 100000,
    longitude: Math.round(longitude * 100000) / 100000,
    mapSrc: `https://www.openstreetmap.org/export/embed.html?bbox=${bbox.replaceAll(',', '%2C')}&layer=mapnik&marker=${latitude}%2C${longitude}`,
  };
};
const serviceAreaCatalog = newAppointmentAreaOptions.reduce<Array<{ territory: ScheduleTerritory; territoryCode: string; code: string; label: string; localities: string[] }>>((areas, locality) => {
  const territory = appointmentTerritoryForArea(locality);
  const designator = areaDesignatorForArea(locality);
  const existing = areas.find((area) => area.territory === territory && area.code === designator.code);
  if (existing) existing.localities.push(locality);
  else areas.push({ territory, territoryCode: territoryDesignators[territory], code: designator.code, label: designator.label, localities: [locality] });
  return areas;
}, []);

const emptyNewAppointment: NewAppointmentForm = {
  kind: 'Job', window: '1:00–2:00', truck: 'Unassigned', area: 'New Orleans',
  customer: '', phone: '', address: '', scope: '', value: '', notes: '', loadPickups: 1, loadStream: 'mixed',
};

const scheduleMapBboxes: Record<string, string> = {
  ALL: '-91.45,29.72,-89.55,30.88',
  'T:NO': '-90.28,29.76,-89.72,30.18', 'T:JP': '-90.42,29.72,-89.96,30.18',
  'T:NS': '-90.48,30.18,-89.48,30.78', 'T:BR': '-91.42,30.12,-90.74,30.78',
  'A:NO:NO': '-90.16,29.88,-89.98,30.04', 'A:NO:EM': '-90.04,29.76,-89.76,30.12', 'A:NO:RP': '-90.62,29.96,-90.34,30.24',
  'A:JP:MET': '-90.24,29.92,-90.10,30.04', 'A:JP:KEN': '-90.32,29.92,-90.20,30.04',
  'A:JP:HAR': '-90.24,29.88,-90.14,29.98', 'A:JP:WB': '-90.16,29.82,-89.98,29.96',
  'A:NS:COV': '-90.22,30.38,-90.02,30.58', 'A:NS:MAN': '-90.18,30.30,-89.98,30.46',
  'A:NS:SLI': '-89.90,30.20,-89.66,30.42', 'A:NS:HAM': '-90.62,30.42,-90.34,30.62',
  'A:BR:BR': '-91.28,30.34,-91.02,30.58', 'A:BR:ASC': '-91.12,30.08,-90.82,30.36', 'A:BR:LIV': '-91.08,30.34,-90.78,30.62',
};

const scheduleCalendarCounts: Record<number, number> = { 1: 5, 3: 12, 4: 14, 5: 11, 6: 13, 7: 9, 8: 4, 10: 15, 11: 13, 12: 16, 13: 12, 14: 10, 15: 6, 17: 14, 18: 11, 19: 13, 20: 15, 21: 9, 22: 5, 24: 13, 25: 14, 26: 12, 27: 16, 28: 11, 29: 7, 31: 16 };
const calendarTerritoryCodes = ['NO', 'BR', 'NS', 'JP', 'LF'] as const;
const calendarTerritoryBreakdown = (day: number, count: number) => calendarTerritoryCodes.map((code, index) => {
  if (!count) return { code, count: 0 };
  const base = Math.floor(count / calendarTerritoryCodes.length);
  const rotatedIndex = (index + day) % calendarTerritoryCodes.length;
  return { code, count: base + (rotatedIndex < count % calendarTerritoryCodes.length ? 1 : 0) };
});
const scheduleFollowups = [
  { kind: 'unclosed', priority: 'critical', label: 'Unclosed job', jk: 'JK4001266', customer: 'Sample Home', phone: '(504) 555-0166', area: 'Metairie · JP', owner: 'Finance', age: '2h 16m', detail: 'Truck visit confirmed · Closeout still open', next: 'Verify total, payment, and crew closeout.' },
  { kind: 'estimates', priority: 'warning', label: 'Open estimate', jk: 'JK4001182', customer: 'Sample Customer', phone: '(985) 555-0182', area: 'Covington · NS', owner: 'Sales', age: '1d 4h', detail: '$825 quoted · 6 photos · Last contact Aug 29', next: 'Contact customer and review pricing.' },
  { kind: 'photos', priority: 'warning', label: 'Missing photos', jk: 'JK4001274', customer: 'Example Customer', phone: '(225) 555-0174', area: 'Baton Rouge · BR', owner: 'Dispatch', age: '54m', detail: 'Completed job · No JunkWare photos found', next: 'Confirm the full photo batch is recorded.' },
  { kind: 'estimates', priority: 'watch', label: 'Open estimate', jk: 'JK4001305', customer: 'Sample Resident', phone: '(504) 555-0105', area: 'New Orleans · NO', owner: 'Sales', age: '38m', detail: '$560 quoted · Follow-up due today', next: 'Contact customer before end of day.' },
  { kind: 'closed', priority: 'watch', label: 'Closed estimate', jk: 'JK4001198', customer: 'Example Resident', phone: '(985) 555-0198', area: 'Mandeville · NS', owner: 'Sales', age: '22m', detail: '$1,240 quoted · Pricing and photos ready', next: 'Review the estimate and booked-job status.' },
];
const scheduleHistory: ScheduleHistoryRow[] = [
  { type: 'Status', time: '10:18 AM', jk: 'JK4001241', change: 'Arrival confirmed · Truck 2 is on site', by: 'LinxUp', source: 'LinxUp GPS', day: 'today' },
  { type: 'Verified', time: '10:11 AM', jk: 'JK4001204', change: 'Closeout complete · Payment and 8 photos verified', by: 'OpsBot', source: 'JunkWare', day: 'today' },
  { type: 'Rescheduled', time: '10:04 AM', jk: 'JK4001280', change: '11:00 AM–1:00 PM → 12:00–2:00 PM', by: 'Dispatch', source: 'OpsCenter', day: 'today' },
  { type: 'Cancelled', time: '9:42 AM', jk: 'JK4001288', change: '2:00–3:00 PM · Customer changed plans', by: 'Call center', source: 'JunkWare', day: 'today' },
  { type: 'Reassigned', time: '8:58 AM', jk: 'JK4001241', change: 'Unassigned → Truck 2 · Crew A', by: 'Dispatch', source: 'OpsCenter', day: 'today' },
  { type: 'Created', time: '4:32 PM', jk: 'JK4001412', change: '2:00–3:00 · Truck 7 · Lafayette', by: 'Call center', source: 'JunkWare', day: 'tomorrow' },
  { type: 'Reassigned', time: '4:18 PM', jk: 'JK4001410', change: 'Unassigned → Truck 9 · Crew D', by: 'Dispatch', source: 'OpsCenter', day: 'tomorrow' },
];

const auditWorkspaces: Array<'All' | AuditWorkspace> = ['All', 'Command', 'Schedule', 'Krewe', 'Fleet', 'Marketing', 'Finance'];
const initialAuditEvents: AuditEvent[] = [
  { id: 'AE-1007', workspace: 'Schedule', action: 'Arrival confirmed', record: 'JK4001241', summary: 'Truck 2 reached the Northshore appointment.', previous: 'En route', next: 'On site · 10:18 AM', actor: 'LinxUp', source: 'LinxUp GPS', time: '10:18 AM', result: 'Completed', refId: 'JK4001241' },
  { id: 'AE-1006', workspace: 'Schedule', action: 'Closeout verified', record: 'JK4001204', summary: 'Payment and eight required photos were verified.', previous: 'Closeout pending', next: 'Closeout complete', actor: 'OpsBot', source: 'JunkWare', time: '10:11 AM', result: 'Completed', refId: 'JK4001204' },
  { id: 'AE-1005', workspace: 'Finance', action: 'Payment flagged', record: 'JK4001204', summary: 'Card payment differs from the recorded job total.', previous: '$1,248 job total', next: '$33 review required', actor: 'OpsBot', source: 'JunkWare + QBO', time: '10:05 AM', result: 'Needs review', refId: 'JK4001204' },
  { id: 'AE-1004', workspace: 'Fleet', action: 'Telemetry status changed', record: 'Truck 4', summary: 'The individual truck position stopped reporting as fresh.', previous: 'Fresh position', next: 'Stale · 18 min', actor: 'LinxUp', source: 'LinxUp GPS', time: '10:02 AM', result: 'Needs review', refId: 'FT-4' },
  { id: 'AE-1003', workspace: 'Krewe', action: 'Truck assignment updated', record: 'Carlos Diaz', summary: 'Today’s crew coverage was reconciled with the route plan.', previous: 'Unassigned', next: 'Truck 4 · Jefferson Parish', actor: 'Mission Control', source: 'OpsCenter', time: '9:56 AM', result: 'Completed', refId: 'KM-103' },
  { id: 'AE-1002', workspace: 'Marketing', action: 'Review match proposed', record: 'RV-301', summary: 'A Podium review has a likely JunkWare appointment match.', previous: 'Unattributed review', next: 'Confirm JK4001204', actor: 'OpsBot', source: 'Podium + JunkWare', time: '9:48 AM', result: 'Needs review', refId: 'RV-301' },
  { id: 'AE-1001', workspace: 'Finance', action: 'Resale item received', record: 'RR-204', summary: 'Recovered inventory was added with source-job custody.', previous: 'Not in inventory', next: 'Held for disposition', actor: 'Mission Control', source: 'Truck record', time: '9:31 AM', result: 'Completed', refId: 'RR-204' },
];

export default function Home({ live }: { live?: DesktopLiveProps } = {}) {
  const workItems: WorkItem[] = live?.snapshot.alerts ?? referenceWorkItems;
  const liveAlert = (item: WorkItem) => live?.snapshot.alerts.find(alert => alert.id === item.id);
  const [workspaceMutationBusy, setWorkspaceMutationBusy] = useState(false);
  const alertMutationBusyRef = useRef(false);
  alertMutationBusyRef.current = Boolean(live?.pendingAlertId);
  const mutationBusy = workspaceMutationBusy || alertMutationBusyRef.current;
  const mutationBusyRef = useRef(false);
  mutationBusyRef.current = mutationBusy;
  const onBusyChange = useCallback((busy: boolean) => { mutationBusyRef.current = busy || alertMutationBusyRef.current; setWorkspaceMutationBusy(busy); live?.onBusyChange?.(busy); }, [live?.onBusyChange]);
  const canFinance = Boolean(live && ['Administrator', 'Manager'].includes(live.snapshot.actor.role));
  const [activeNav, setActiveNavValue] = useState(() => {
    if (!live) return 'Command';
    const workspace = new URLSearchParams(window.location.search).get('workspace') || 'Command';
    return ['Command', 'Schedule', 'Krewe', 'Fleet', 'Marketing', ...(canFinance ? ['Finance'] : [])].includes(workspace) ? workspace : 'Command';
  });
  const setActiveNav = (value: string) => {
    if (mutationBusyRef.current) { setActionFeedback('Wait for the current action result before changing workspaces.'); return; }
    if (live && value === 'Finance' && !canFinance) return;
    setActiveNavValue(value);
  };
  const [view, setViewValue] = useState<'now' | 'today' | 'monitor'>(() => {
    if (!live) return 'now';
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('commandView');
    return requested === 'monitor' ? 'monitor' : requested === 'control' || requested === 'today' || params.has('action') ? 'today' : 'now';
  });
  const setView = (value: 'now' | 'today' | 'monitor') => {
    if (mutationBusyRef.current) return;
    setViewValue(value);
  };
  const connectedSources = live ? (live.snapshot.sourceHealth || []).map(source => {
    const age = source.observedAt ? (Date.now()-Date.parse(source.observedAt))/1000 : NaN;
    const stale = !Number.isFinite(age) || age < -60 || age > source.maxAgeSeconds;
    return {...source, state:source.tone==='healthy'&&stale?'Stale / unavailable':source.state, tone:source.tone==='healthy'&&stale?'warning':source.tone,
      freshness:source.observedAt ? `${new Date(source.observedAt).toLocaleString('en-US',{timeZone:'America/Chicago'})} · ${Math.max(0,Math.floor(age/60))} min ago` : 'No verified observation'};
  }) : referenceConnectedSources;

  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpenValue] = useState(false);
  const setSearchOpen = (value: boolean) => {
    if (live && value) { setActionFeedback('Cross-workspace search is still being connected.'); return; }
    setSearchOpenValue(value);
  };
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [operatingDayOpen, setOperatingDayOpenValue] = useState(false);
  const setOperatingDayOpen = (value: boolean | ((open: boolean) => boolean)) => {
    if (live) { setActionFeedback('The operating-day planner is still being connected.'); return; }
    setOperatingDayOpenValue(value);
  };
  const [sourceHealthOpen, setSourceHealthOpen] = useState(false);
  const [operatingDate, setOperatingDate] = useState(live?.snapshot.date || '2026-08-31');
  const [calendarDateDraft, setCalendarDateDraft] = useState(live?.snapshot.date || '2026-08-31');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [completed, setCompleted] = useState<Array<number | string>>([]);
  const [alertOutcomes, setAlertOutcomes] = useState<Record<number | string, AlertOutcome>>({});
  const [alertViewFilter, setAlertViewFilter] = useState<AlertViewFilter>('open');
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>(live ? [] : initialAuditEvents);
  const [auditFilter, setAuditFilter] = useState<'All' | AuditWorkspace>('All');
  const [actionQueue, setActionQueue] = useState<ActionQueueItem[]>(live ? [] : initialActionQueue);
  const [actionQueueFilter, setActionQueueFilter] = useState<'all' | 'urgent' | 'approval' | 'verification' | 'mine'>('all');
  const [closeoutQueueFilter, setCloseoutQueueFilter] = useState<CloseoutQueueFilter>('all');
  const [operatingDayStarted, setOperatingDayStarted] = useState(false);
  const [operatingDayStartedAt, setOperatingDayStartedAt] = useState('');
  const [dayCloseCarryovers, setDayCloseCarryovers] = useState<Partial<Record<DayCloseGateId, DayCloseCarryover>>>({});
  const [activeDayCloseGateId, setActiveDayCloseGateId] = useState<DayCloseGateId | null>(null);
  const [dayCloseCarryoverDraft, setDayCloseCarryoverDraft] = useState({ owner: '', due: '', note: '' });
  const [dayCloseError, setDayCloseError] = useState('');
  const [operatingDayClosed, setOperatingDayClosed] = useState(false);
  const [actionQueueDraft, setActionQueueDraft] = useState({ owner: '', due: '', status: 'Open' as ActionQueueStatus, note: '', resolution: '', verificationEvidence: '' });
  const [customerNotes, setCustomerNotes] = useState<Record<string, string>>({});
  const [customerNoteDraft, setCustomerNoteDraft] = useState('');
  const [drawer, setDrawer] = useState<DrawerRecord | null>(null);
  const [copiedJk, setCopiedJk] = useState<string | null>(null);
  const [scheduleDay, setScheduleDay] = useState<ScheduleDay>(() => live ? navigationValue(window.location.search, 'scheduleDay', ['today', 'tomorrow'], 'today') : 'today');
  const [liveScheduleCounts, setLiveScheduleCounts] = useState({ today: 0, tomorrow: 0 });
  const operatingDateHeading = live ? new Date((activeNav === 'Schedule' ? dateForDay(live.snapshot.date, scheduleDay) : live.snapshot.date) + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'America/Chicago', weekday: 'long', month: 'long', day: 'numeric' }) : 'Sunday, August 31';
  const [scheduleView, setScheduleViewValue] = useState<'board' | 'calendar' | 'followup' | 'history'>(() => live ? navigationValue(window.location.search, 'scheduleView', ['board', 'calendar', 'followup', 'history'], 'board') : 'board');
  const setScheduleView = (value: 'board' | 'calendar' | 'followup' | 'history') => {
    if (mutationBusyRef.current) return;
    setScheduleViewValue(value);
  };
  const [followupFilter, setFollowupFilter] = useState<'all' | 'estimates' | 'closed' | 'unclosed' | 'photos'>('all');
  const [historyFilter, setHistoryFilter] = useState<ScheduleHistoryFilter>('all');
  const [newAppointmentOpen, setNewAppointmentOpenValue] = useState(false);
  const setNewAppointmentOpen = (value: boolean) => {
    if (live && value) { setActionFeedback('Appointment creation is still being connected to JunkWare. No appointment was created.'); return; }
    setNewAppointmentOpenValue(value);
  };
  const [newAppointment, setNewAppointment] = useState<NewAppointmentForm>(emptyNewAppointment);
  const [newAppointmentError, setNewAppointmentError] = useState('');
  const [newAppointmentCustomerQuery, setNewAppointmentCustomerQuery] = useState('');
  const [newAppointmentCustomerId, setNewAppointmentCustomerId] = useState<string | null>(null);
  const [newAppointmentAddressVerification, setNewAppointmentAddressVerification] = useState<NewAppointmentAddressVerification | null>(null);
  const [reviewedBookingFingerprint, setReviewedBookingFingerprint] = useState<string | null>(null);
  const [duplicateOverrideReason, setDuplicateOverrideReason] = useState('');
  const [junkWareCreationState, setJunkWareCreationState] = useState<JunkWareCreationState>('idle');
  const [junkWareCreationJk, setJunkWareCreationJk] = useState('');
  const junkWareCreationRunRef = useRef(0);
  const [appointmentCreationReceipt, setAppointmentCreationReceipt] = useState<AppointmentCreationReceipt | null>(null);
  const appointmentDeliveryRunRef = useRef({ customer: 0, crew: 0 });
  const junkWareCreationBusy = junkWareCreationState === 'creating' || junkWareCreationState === 'verifying' || junkWareCreationState === 'searching' || junkWareCreationState === 'created';
  const [kreweMembers, setKreweMembers] = useState<KreweMember[]>(live ? [] : kreweRoster);
  const [kreweFilter, setKreweFilter] = useState<KreweFilter>('all');
  const [kreweView, setKreweViewValue] = useState<KreweView>(() => live ? navigationValue(window.location.search, 'kreweView', ['today', 'callin', 'payperiod', 'monthly'], 'today') : 'today');
  const setKreweView = (value: KreweView) => { if (!mutationBusyRef.current) setKreweViewValue(value); };
  const [callInCandidates, setCallInCandidates] = useState<CallInCandidate[]>(live ? [] : initialCallInCandidates);
  const [kreweMonth, setKreweMonth] = useState<'august' | 'july'>('august');
  const [timeCorrection, setTimeCorrection] = useState({ clockIn: '', clockOut: '', reason: '' });
  const [bonusEntry, setBonusEntry] = useState({ amount: '', reason: '' });
  const [fleetView, setFleetViewValue] = useState<FleetView>(() => live ? navigationValue(window.location.search, 'fleetView', ['overview', 'maintenance', 'service', 'reports'], 'overview') : 'overview');
  const setFleetView = (value: FleetView) => { if (!mutationBusyRef.current) setFleetViewValue(value); };
  const [fleetTruckRows, setFleetTruckRows] = useState<FleetTruck[]>(live ? [] : fleetTrucks);
  const [fleetIssues, setFleetIssues] = useState<FleetIssue[]>(live ? [] : initialFleetIssues);
  const [fleetIssueFilter, setFleetIssueFilter] = useState<FleetIssueFilter>('active');
  const [fleetSummaryFilter, setFleetSummaryFilter] = useState<FleetSummaryFilter>('all');
  const [selectedServiceTruck, setSelectedServiceTruck] = useState('FT-2');
  const [scheduledServices, setScheduledServices] = useState<string[]>([]);
  const [fleetReportMonth, setFleetReportMonth] = useState<'august' | 'july'>('august');
  const [fleetLoadDraft, setFleetLoadDraft] = useState({ percent: '', note: '', metal: '' });
  const [fleetIssueDraft, setFleetIssueDraft] = useState({ status: 'Open' as FleetIssueStatus, owner: '', due: '', resolution: '', cost: '', downtime: '' });
  const [marketingView, setMarketingViewValue] = useState<MarketingView>(() => live ? navigationValue(window.location.search, 'marketingView', ['overview', 'leads', 'reviews', 'performance'], 'overview') : 'overview');
  const setMarketingView = (value: MarketingView) => { if (!mutationBusyRef.current) setMarketingViewValue(value); };
  const [marketingLeads, setMarketingLeads] = useState<MarketingLead[]>(live ? [] : initialMarketingLeads);
  const [marketingReviews, setMarketingReviews] = useState<MarketingReview[]>(live ? [] : initialMarketingReviews);
  const [marketingLeadFilter, setMarketingLeadFilter] = useState<'recover' | 'lost' | 'followup' | 'all'>('recover');
  const [financeView, setFinanceViewValue] = useState<FinanceView>(() => live ? navigationValue(window.location.search, 'financeView', ['overview', 'payments', 'resale', 'recycling', 'trends'], 'overview') : 'overview');
  const setFinanceView = (value: FinanceView) => { if (!mutationBusyRef.current) setFinanceViewValue(value); };
  useEffect(() => {
    if (!live) return;
    const url = workspaceUrl(window.location.href, { workspace: activeNav, commandView: view, scheduleView, scheduleDay, kreweView, fleetView, marketingView, financeView });
    window.history.replaceState(window.history.state, '', url);
  }, [Boolean(live), activeNav, view, scheduleView, scheduleDay, kreweView, fleetView, marketingView, financeView]);
  const [financePayments, setFinancePayments] = useState<FinancePayment[]>(live ? [] : initialFinancePayments);
  const [financeRecoveryItems, setFinanceRecoveryItems] = useState<FinanceRecoveryItem[]>(live ? [] : initialFinanceRecoveryItems);
  const [financeCloseSteps, setFinanceCloseSteps] = useState<string[]>(['costs']);
  const [handledFollowups, setHandledFollowups] = useState<string[]>([]);
  const [selectedCalendarDay, setSelectedCalendarDay] = useState(31);
  const [showScheduleMap, setShowScheduleMap] = useState(true);
  const [scheduleNow, setScheduleNow] = useState<Date | null>(null);
  const [scheduleScope, setScheduleScope] = useState('ALL');
  const [scheduleStatusFilter, setScheduleStatusFilter] = useState<ScheduleStatusFilter>('all');
  const [territoryPriority, setTerritoryPriority] = useState<string | null>(null);
  const [routeFocusAppointmentId, setRouteFocusAppointmentId] = useState<string | null>(null);
  const [draggedAppointmentId, setDraggedAppointmentId] = useState<string | null>(null);
  const [dragPreview, setDragPreview] = useState<PendingScheduleMove | null>(null);
  const [pendingScheduleMove, setPendingScheduleMove] = useState<PendingScheduleMove | null>(null);
  const [scheduleChangeReceipt, setScheduleChangeReceipt] = useState<ScheduleChangeReceipt | null>(null);
  const scheduleChangeSyncRunRef = useRef(0);
  const schedulePointerDragRef = useRef<SchedulePointerDrag | null>(null);
  const schedulePointerCleanupRef = useRef<(() => void) | null>(null);
  const [scheduleRowsByDay, setScheduleRowsByDay] = useState<Record<ScheduleDay, ScheduleRow[]>>({ today: live ? [] : scheduleBoard, tomorrow: live ? [] : tomorrowScheduleBoard });
  const [scheduleHistoryRows, setScheduleHistoryRows] = useState<ScheduleHistoryRow[]>(live ? [] : scheduleHistory);
  const [appointmentChangeDraft, setAppointmentChangeDraft] = useState<AppointmentChangeDraft>({ truck: '', time: '', callAhead: false, addressVerified: false, cancel: false, cancellationReason: '' });
  const [appointmentCloseoutOpen, setAppointmentCloseoutOpen] = useState(false);
  const [appointmentCloseoutDraft, setAppointmentCloseoutDraft] = useState<AppointmentCloseoutDraft>({ category: 'Job', amount: '', paymentMethod: '', estimateOutcome: 'Follow-Up Required', followUpDate: '', notes: '' });
  const [appointmentCloseoutError, setAppointmentCloseoutError] = useState('');
  const [appointmentCloseoutReceipts, setAppointmentCloseoutReceipts] = useState<Record<string, AppointmentCloseoutReceipt>>({});
  const [actionFeedback, setActionFeedback] = useState('');
  useEffect(() => { if (live?.error) setActionFeedback(live.error); }, [live?.error]);
  const [recordNavigation, setRecordNavigation] = useState<RecordNavigationEntry[]>([]);
  const recordRestoreScrollRef = useRef<{ pageScrollTop: number; drawerScrollTop: number } | null>(null);

  const drawerIdentity = (record: DrawerRecord | null) => record
    ? record.customerId || record.actionQueueId || record.appointmentId || record.jobReferenceId
      || record.fleetIssueId || record.fleetTruckId || (record.areaId ? `${record.territoryId}:${record.areaId}` : record.territoryId)
      || record.followupId || record.kreweId || `${record.kicker}:${record.title}`
    : 'page';
  const currentPageLabel = activeNav === 'Command'
    ? `Command · ${view === 'now' ? 'Alerts' : view === 'today' ? 'Control' : 'Monitor'}`
    : activeNav === 'Schedule'
      ? `Schedule · ${scheduleView === 'board' ? 'Board' : scheduleView === 'calendar' ? 'Calendar' : scheduleView === 'followup' ? 'Follow-Up' : 'History'}`
      : activeNav === 'Krewe'
        ? `Krewe · ${kreweView === 'today' ? 'Today' : kreweView === 'callin' ? 'Call-In Plan' : kreweView === 'payperiod' ? 'Pay Period' : 'Monthly'}`
        : activeNav === 'Fleet'
          ? `Fleet · ${fleetView === 'overview' ? 'Overview' : fleetView === 'maintenance' ? 'Maintenance' : fleetView === 'service' ? 'Service' : 'Reports'}`
          : activeNav === 'Marketing'
            ? `Marketing · ${marketingView === 'overview' ? 'Overview' : marketingView === 'leads' ? 'Leads' : marketingView === 'reviews' ? 'Reviews' : 'Performance'}`
            : `Finance · ${financeView === 'overview' ? 'Overview' : financeView === 'payments' ? 'Payments' : financeView === 'resale' ? 'Resale' : financeView === 'recycling' ? 'Recycling' : 'Trends'}`;
  const currentRecordLabel = drawer
    ? drawer.customerId ? `Customer · ${drawer.title}`
      : drawer.fleetIssueId ? `Maintenance · ${drawer.title}`
        : drawer.fleetTruckId ? drawer.title
          : drawer.actionQueueId ? 'Operating Decision'
            : drawer.appointmentId || drawer.jobReferenceId ? drawer.title
              : drawer.areaId ? `Area · ${drawer.title}`
                : drawer.territoryId ? `Territory · ${drawer.title}`
                  : drawer.followupId ? `Follow-Up · ${drawer.title}`
                    : `${drawer.kicker.split(' · ')[0]} · ${drawer.title}`
    : currentPageLabel;
  const openRecordDrawer = (nextDrawer: DrawerRecord) => {
    if (drawerIdentity(drawer) === drawerIdentity(nextDrawer)) {
      setDrawer(nextDrawer);
      return;
    }
    const drawerBody = document.querySelector<HTMLElement>('.record-drawer-body');
    setRecordNavigation((history) => [...history.slice(-7), {
      drawer,
      label: currentRecordLabel,
      pageScrollTop: document.scrollingElement?.scrollTop || window.scrollY,
      drawerScrollTop: drawerBody?.scrollTop || 0,
      context: {
        activeNav, view, query, alertViewFilter, auditFilter, actionQueueFilter,
        operatingDate, calendarDateDraft, scheduleDay, scheduleView, scheduleScope, scheduleStatusFilter,
        followupFilter, historyFilter, territoryPriority, selectedCalendarDay, showScheduleMap, kreweView, kreweFilter, kreweMonth,
        fleetView, fleetIssueFilter, fleetSummaryFilter, selectedServiceTruck, fleetReportMonth, marketingView, marketingLeadFilter, financeView,
      },
    }]);
    setDrawer(nextDrawer);
  };
  const returnToPreviousRecord = () => {
    const previous = recordNavigation.at(-1);
    if (!previous) return;
    const context = previous.context;
    setActiveNav(context.activeNav);
    setView(context.view);
    setQuery(context.query);
    setAlertViewFilter(context.alertViewFilter);
    setAuditFilter(context.auditFilter);
    setActionQueueFilter(context.actionQueueFilter);
    setOperatingDate(context.operatingDate);
    setCalendarDateDraft(context.calendarDateDraft);
    setScheduleDay(context.scheduleDay);
    setScheduleView(context.scheduleView);
    setScheduleScope(context.scheduleScope);
    setScheduleStatusFilter(context.scheduleStatusFilter);
    setFollowupFilter(context.followupFilter);
    setHistoryFilter(context.historyFilter);
    setTerritoryPriority(context.territoryPriority);
    setSelectedCalendarDay(context.selectedCalendarDay);
    setShowScheduleMap(context.showScheduleMap);
    setKreweView(context.kreweView);
    setKreweFilter(context.kreweFilter);
    setKreweMonth(context.kreweMonth);
    setFleetView(context.fleetView);
    setFleetIssueFilter(context.fleetIssueFilter);
    setFleetSummaryFilter(context.fleetSummaryFilter);
    setSelectedServiceTruck(context.selectedServiceTruck);
    setFleetReportMonth(context.fleetReportMonth);
    setMarketingView(context.marketingView);
    setMarketingLeadFilter(context.marketingLeadFilter);
    setFinanceView(context.financeView);
    recordRestoreScrollRef.current = { pageScrollTop: previous.pageScrollTop, drawerScrollTop: previous.drawerScrollTop };
    setRecordNavigation((history) => history.slice(0, -1));
    setDrawer(previous.drawer);
    setActionFeedback('');
  };
  const closeRecordDrawer = () => {
    setDrawer(null);
    setRecordNavigation([]);
    setActionFeedback('');
  };

  useEffect(() => {
    const restore = recordRestoreScrollRef.current;
    if (!restore) return;
    const frame = window.requestAnimationFrame(() => {
      if (drawer) {
        const drawerBody = document.querySelector<HTMLElement>('.record-drawer-body');
        if (drawerBody) drawerBody.scrollTop = restore.drawerScrollTop;
      } else {
        window.scrollTo({ top: restore.pageScrollTop, behavior: 'auto' });
      }
      recordRestoreScrollRef.current = null;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [drawer]);

  useEffect(() => {
    if (!drawer && recordNavigation.length) setRecordNavigation([]);
  }, [drawer, recordNavigation.length]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (newAppointmentOpen && junkWareCreationBusy) return;
      setDrawer(null);
      setNewAppointmentOpen(false);
      junkWareCreationRunRef.current += 1;
      setJunkWareCreationState('idle');
      setJunkWareCreationJk('');
      setScheduleScope('ALL');
      setScheduleStatusFilter('all');
      setTerritoryPriority(null);
      setRouteFocusAppointmentId(null);
      setDraggedAppointmentId(null);
      setDragPreview(null);
      setPendingScheduleMove(null);
      schedulePointerCleanupRef.current?.();
      schedulePointerCleanupRef.current = null;
      schedulePointerDragRef.current = null;
      setSearchOpen(false);
      setNotificationOpen(false);
      setOperatingDayOpen(false);
      setSourceHealthOpen(false);
      setQuery('');
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [junkWareCreationBusy, newAppointmentOpen]);

  useEffect(() => {
    const focusGlobalSearch = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (event.key !== '/' || target?.matches('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      setSearchOpen(true);
      setNotificationOpen(false);
      setOperatingDayOpen(false);
      searchInputRef.current?.focus();
    };
    window.addEventListener('keydown', focusGlobalSearch);
    return () => window.removeEventListener('keydown', focusGlobalSearch);
  }, []);

  useEffect(() => {
    if (activeNav === 'Schedule' && scheduleView === 'board') setShowScheduleMap(true);
  }, [activeNav, scheduleView]);

  useEffect(() => {
    setRouteFocusAppointmentId(null);
    setDraggedAppointmentId(null);
    setDragPreview(null);
    setPendingScheduleMove(null);
    setScheduleChangeReceipt((receipt) => {
      if (!receipt) return null;
      const customerComplete = !receipt.requiresCustomerConfirmation || receipt.customerConfirmed;
      const crewComplete = !receipt.requiresCrewNotification || receipt.crewNotified;
      return receipt.undone || (receipt.syncState === 'verified' && customerComplete && crewComplete) ? null : receipt;
    });
    schedulePointerCleanupRef.current?.();
    schedulePointerCleanupRef.current = null;
    schedulePointerDragRef.current = null;
  }, [scheduleDay]);

  useEffect(() => {
    setActionFeedback('');
  }, [drawer?.appointmentId, drawer?.followupId, drawer?.kreweId, drawer?.fleetTruckId, drawer?.fleetIssueId, drawer?.actionQueueId, drawer?.customerId, drawer?.territoryId, drawer?.areaId]);

  useEffect(() => {
    const updateScheduleNow = () => setScheduleNow(new Date());
    updateScheduleNow();
    const timer = window.setInterval(updateScheduleNow, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const scheduleNowMinutes = scheduleNow ? (scheduleNow.getHours() * 60) + scheduleNow.getMinutes() : null;
  const scheduleNowProgress = scheduleNowMinutes === null ? null : (scheduleNowMinutes - 480) / 540;
  const showScheduleNow = scheduleDay === 'today' && scheduleNowProgress !== null && scheduleNowProgress >= 0 && scheduleNowProgress <= 1;
  const scheduleNowLabel = scheduleNow?.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const scheduleNowLeft = scheduleNowProgress === null
    ? undefined
    : `calc(${scheduleNowProgress * 100}% + ${(1 - scheduleNowProgress) * 88}px)`;
  const scheduleRows = scheduleRowsByDay[scheduleDay];
  const setScheduleRows = (update: (rows: ScheduleRow[]) => ScheduleRow[]) => {
    setScheduleRowsByDay((plans) => ({ ...plans, [scheduleDay]: update(plans[scheduleDay]) }));
  };
  const scheduleDayCounts = {
    today: buildScheduledAppointments(scheduleRowsByDay.today).length,
    tomorrow: buildScheduledAppointments(scheduleRowsByDay.tomorrow).length,
  };
  const scheduledAppointments = useMemo(() => buildScheduledAppointments(scheduleRows), [scheduleRows]);
  const scheduleCompletedJobCount = scheduledAppointments.filter((appointment) => appointment.kind === 'Job' && appointment.state === 'Completed').length;
  const scheduleClosedEstimateCount = scheduledAppointments.filter((appointment) => appointment.kind === 'Estimate' && appointment.state === 'Estimate Closed').length;
  const scheduleOpenAppointmentCount = scheduledAppointments.filter((appointment) => !isFinalAppointmentState(appointment.state)).length;
  const closeoutReceiptRows = Object.values(appointmentCloseoutReceipts);
  const addedCompletedJobs = closeoutReceiptRows.filter((receipt) => receipt.day === 'today' && receipt.finalCategory === 'Job' && receipt.previousState !== 'Completed').length;
  const addedClosedEstimates = closeoutReceiptRows.filter((receipt) => receipt.day === 'today' && receipt.finalCategory === 'Estimate' && receipt.previousState !== 'Estimate Closed').length;
  const commandCompletedJobs = 2 + addedCompletedJobs;
  const commandClosedEstimates = addedClosedEstimates;
  const commandUnclosedAppointments = Math.max(0, 14 - addedCompletedJobs - addedClosedEstimates);
  const commandKpiRows = live?.snapshot.kpis ?? commandKpis.map((kpi) => {
    if (kpi.label === 'Completed jobs') return { ...kpi, value: String(commandCompletedJobs) };
    if (kpi.label !== 'Today’s jobs') return kpi;
    return {
      ...kpi,
      detail: `${commandCompletedJobs} completed jobs · ${commandClosedEstimates} closed estimates · ${commandUnclosedAppointments} open`,
      segments: [
        { label: 'Completed Jobs', value: (commandCompletedJobs / 16) * 100, tone: 'healthy' },
        { label: 'Closed Estimates', value: (commandClosedEstimates / 16) * 100, tone: 'warning' },
        { label: 'Unclosed', value: (commandUnclosedAppointments / 16) * 100, tone: 'critical' },
      ],
    };
  });
  const routeFocusAppointment = scheduledAppointments.find((appointment) => appointment.jk === routeFocusAppointmentId);
  const pendingMoveAppointment = pendingScheduleMove
    ? scheduledAppointments.find((appointment) => appointment.jk === pendingScheduleMove.appointmentId)
    : undefined;
  const routeCandidates = useMemo<TruckCandidate[]>(() => {
    if (!routeFocusAppointment) return [];
    const targetStart = 480 + (routeFocusAppointment.start * 60);
    const targetEnd = targetStart + (routeFocusAppointment.duration * 60);
    return fleetTruckRows
      .filter((truck) => truck.readiness !== 'Out of service')
      .map((truck) => {
        const row = scheduleRows.find((candidateRow) => candidateRow.truck === truck.label);
        const routeJobs = (row?.jobs || []).filter((job) => job.jk !== 'Open capacity' && job.jk !== routeFocusAppointment.jk);
        const preceding = routeJobs
          .filter((job) => 480 + ((job.start + job.duration) * 60) <= targetStart)
          .sort((a, b) => b.start - a.start)[0];
        const conflict = routeJobs.find((job) => {
          const jobStart = 480 + (job.start * 60);
          const jobEnd = jobStart + (job.duration * 60);
          return jobStart < targetEnd && jobEnd > targetStart;
        });
        const origin = preceding?.area || truck.location;
        const availableMinutes = preceding ? 480 + ((preceding.start + preceding.duration) * 60) : 480;
        const estimate = routeEstimate(origin, routeFocusAppointment.area);
        const arrivalMinutes = availableMinutes + estimate.minutes;
        const buffer = conflict ? null : targetStart - arrivalMinutes;
        const tone: RouteLegTone = conflict ? 'unavailable' : routeToneForBuffer(buffer ?? 0);
        const reason = conflict
          ? `Conflict · ${conflict.jk} ${conflict.time}`
          : preceding
            ? `After ${preceding.jk} in ${preceding.area}`
            : scheduleDay === 'today'
              ? `${truck.gpsFresh ? 'Fresh' : 'Stale'} LinxUp · ${truck.gpsAge}`
              : `Planned start · ${truck.location}`;
        return {
          truckId: truck.id, truck: truck.label, origin, available: routeClockLabel(availableMinutes),
          minutes: estimate.minutes, miles: estimate.miles, arrival: routeClockLabel(arrivalMinutes),
          buffer, tone, reason, gpsFresh: truck.gpsFresh,
        };
      })
      .sort((a, b) => {
        const rank = (candidate: TruckCandidate) => candidate.tone === 'unavailable' ? 2 : candidate.tone === 'late' ? 1 : 0;
        return rank(a) - rank(b) || a.minutes - b.minutes || (b.buffer ?? -999) - (a.buffer ?? -999);
      })
      .slice(0, 3);
  }, [fleetTruckRows, routeFocusAppointment, scheduleDay, scheduleRows]);
  const bestRouteCandidate = routeCandidates[0];
  const routeCandidateTruckLabels = new Set(routeCandidates.map((candidate) => candidate.truck));
  const newAppointmentPlacements = useMemo<NewAppointmentPlacement[]>(() => {
    if (!newAppointmentOpen || newAppointmentAddressVerification?.status !== 'verified' || newAppointmentAddressVerification.input !== newAppointment.address.trim()) return [];
    const selectedWindow = scheduleWindowOptions.find((option) => option.value === newAppointment.window) || scheduleWindowOptions[0];
    const candidates = fleetTruckRows
      .filter((truck) => truck.readiness !== 'Out of service')
      .flatMap((truck) => {
        const row = scheduleRows.find((scheduleRow) => scheduleRow.truck === truck.label);
        if (!row) return [];
        const routeJobs = row.jobs.filter((job) => job.jk !== 'Open capacity' && job.state !== 'Canceled');
        return scheduleWindowOptions
          .filter((option) => option.duration === selectedWindow.duration)
          .flatMap<NewAppointmentPlacement>((option) => {
            const targetEnd = option.start + option.duration;
            const conflict = routeJobs.some((job) => job.start < targetEnd && job.start + job.duration > option.start);
            if (conflict) return [];
            const previous = routeJobs
              .filter((job) => job.start + job.duration <= option.start)
              .sort((a, b) => b.start - a.start)[0];
            const next = routeJobs
              .filter((job) => job.start >= targetEnd)
              .sort((a, b) => a.start - b.start)[0];
            const origin = previous?.area || truck.location;
            const inbound = routeEstimate(origin, newAppointment.area);
            const availableAt = previous ? 480 + ((previous.start + previous.duration) * 60) : 480;
            const appointmentStart = 480 + (option.start * 60);
            const appointmentEnd = 480 + (targetEnd * 60);
            const beforeBuffer = appointmentStart - (availableAt + inbound.minutes);
            const outbound = next ? routeEstimate(newAppointment.area, next.area) : null;
            const afterBuffer = next && outbound ? (480 + (next.start * 60)) - (appointmentEnd + outbound.minutes) : beforeBuffer;
            const buffer = Math.min(beforeBuffer, afterBuffer);
            const tone = routeToneForBuffer(buffer);
            const sameTerritory = truck.territory === appointmentTerritoryForArea(newAppointment.area);
            const tonePenalty = tone === 'late' ? 800 : tone === 'tight' ? 120 : 0;
            const freshnessPenalty = scheduleDay === 'today' && !truck.gpsFresh ? 30 : 0;
            const jobLoad = Math.round((newAppointment.loadPickups / 6) * 100);
            const projectedLoad = truck.loadPercent + jobLoad;
            const capacityStatus: NewAppointmentPlacement['capacityStatus'] = projectedLoad > 100 ? 'insufficient' : projectedLoad > 85 ? 'dump' : 'fit';
            const capacityPenalty = capacityStatus === 'insufficient' ? 1200 : capacityStatus === 'dump' ? 180 : 0;
            const metalCompatible = newAppointment.loadStream === 'metal' && /metal|scrap/i.test(truck.metalNote) && !/no metal|not recorded/i.test(truck.metalNote);
            const unloadAction = newAppointment.loadStream === 'metal' ? 'Metal-yard' : newAppointment.loadStream === 'donation' ? 'Unload' : 'Dump';
            const capacityMessage = capacityStatus === 'insufficient' ? `${unloadAction} before job` : capacityStatus === 'dump' ? `${unloadAction} after job` : metalCompatible ? 'Metal stream compatible' : newAppointment.loadStream === 'metal' ? 'Metal separation needed' : 'Capacity available';
            const streamFitAdjustment = metalCompatible ? -18 : newAppointment.loadStream === 'metal' ? 12 : 0;
            const score = tonePenalty + capacityPenalty + streamFitAdjustment + inbound.minutes + (outbound?.minutes || 0) * .4 + freshnessPenalty - (sameTerritory ? 42 : 0) + option.start;
            return [{
              truck: truck.label,
              crew: row.crew,
              window: option.value,
              windowLabel: option.label,
              origin,
              minutes: inbound.minutes,
              miles: inbound.miles,
              buffer,
              tone,
              reason: previous ? `After ${previous.jk} in ${previous.area}` : `${scheduleDay === 'today' ? 'Current' : 'Planned'} start in ${truck.location}`,
              sameTerritory,
              gpsFresh: truck.gpsFresh,
              currentLoad: truck.loadPercent,
              jobLoad,
              projectedLoad,
              capacityStatus,
              capacityMessage,
              score,
            }];
          });
      })
      .sort((a, b) => a.score - b.score || b.buffer - a.buffer || a.minutes - b.minutes);
    const uniqueTrucks: NewAppointmentPlacement[] = [];
    candidates.forEach((candidate) => {
      if (!uniqueTrucks.some((placement) => placement.truck === candidate.truck)) uniqueTrucks.push(candidate);
    });
    return uniqueTrucks.slice(0, 3);
  }, [fleetTruckRows, newAppointment.address, newAppointment.area, newAppointment.loadPickups, newAppointment.loadStream, newAppointment.window, newAppointmentAddressVerification, newAppointmentOpen, scheduleDay, scheduleRows]);
  const selectedNewAppointmentPlacement = newAppointmentPlacements.find((placement) => (
    placement.truck === newAppointment.truck && placement.window === newAppointment.window
  ));
  const newAppointmentEstimatedLoadPercent = Math.round((newAppointment.loadPickups / 6) * 100);
  const newAppointmentAssignedTruck = fleetTruckRows.find((truck) => truck.label === newAppointment.truck);
  const newAppointmentAssignedRow = scheduleRows.find((row) => row.truck === newAppointment.truck);
  const newAppointmentProjectedLoad = newAppointmentAssignedTruck
    ? newAppointmentAssignedTruck.loadPercent + newAppointmentEstimatedLoadPercent
    : null;
  const newAppointmentDirectEstimate = newAppointmentAssignedTruck
    ? routeEstimate(newAppointmentAssignedTruck.location, newAppointment.area)
    : null;
  const newAppointmentLoadAction = newAppointmentProjectedLoad === null
    ? 'Assignment pending'
    : newAppointmentProjectedLoad > 100
      ? 'Unload required before job'
      : newAppointmentProjectedLoad > 85
        ? newAppointment.loadStream === 'metal'
          ? 'Metal-yard stop after job'
          : newAppointment.loadStream === 'donation'
            ? 'Unload after job'
            : 'Dump after job'
        : 'Capacity available';
  const newAppointmentReviewWarnings = [
    ...(newAppointmentAddressVerification?.manual ? ['Service area was confirmed manually; source read-back is still required.'] : []),
    ...(!newAppointmentCustomerId ? ['This creates a new customer identity in the local prototype.'] : []),
    ...(newAppointment.truck === 'Unassigned' ? ['No truck or crew is assigned.'] : []),
    ...(newAppointmentProjectedLoad !== null && newAppointmentProjectedLoad > 85 ? [newAppointmentLoadAction] : []),
    ...(newAppointmentAssignedTruck && !selectedNewAppointmentPlacement ? ['Truck and time were selected manually rather than from a recommended placement.'] : []),
    ...(selectedNewAppointmentPlacement && selectedNewAppointmentPlacement.buffer < 20 ? [`Route buffer is ${selectedNewAppointmentPlacement.buffer} minutes.`] : []),
  ];
  const currentBookingFingerprint = JSON.stringify({
    day: scheduleDay,
    form: newAppointment,
    duplicateOverrideReason,
    existingSchedule: Object.values(scheduleRowsByDay).flatMap((rows) => rows.flatMap((row) => row.jobs.map((job) => [job.jk, job.time, job.details?.phone || '', job.details?.address || '']))),
    address: newAppointmentAddressVerification?.status === 'verified'
      ? [newAppointmentAddressVerification.input, newAppointmentAddressVerification.matchedArea, Boolean(newAppointmentAddressVerification.manual)]
      : null,
  });
  const newAppointmentReviewReady = reviewedBookingFingerprint === currentBookingFingerprint;
  const junkWareCreationNeedsAttention = junkWareCreationState === 'uncertain' || junkWareCreationState === 'searching' || junkWareCreationState === 'safe-retry';
  const junkWareCreateStepComplete = junkWareCreationState !== 'idle' && junkWareCreationState !== 'creating';
  const nextPrototypeJunkWareId = (() => {
    const usedNumbers = Object.values(scheduleRowsByDay)
      .flatMap((rows) => buildScheduledAppointments(rows))
      .map((appointment) => appointment.jk.match(/^JK(\d{7})$/)?.[1])
      .filter((value): value is string => Boolean(value))
      .map(Number);
    return `JK${Math.max(4_000_000, ...usedNumbers) + 1}`;
  })();
  useEffect(() => {
    if (reviewedBookingFingerprint && reviewedBookingFingerprint !== currentBookingFingerprint) {
      junkWareCreationRunRef.current += 1;
      setReviewedBookingFingerprint(null);
      setJunkWareCreationState('idle');
      setJunkWareCreationJk('');
    }
  }, [currentBookingFingerprint, reviewedBookingFingerprint]);
  const allScheduledAppointments = useMemo(() => (['today', 'tomorrow'] as ScheduleDay[]).flatMap((day) => buildScheduledAppointments(scheduleRowsByDay[day]).map((appointment) => ({ ...appointment, day }))), [scheduleRowsByDay]);
  const duplicateCheckReady = newAppointment.phone.replace(/\D/g, '').length >= 7 && newAppointment.address.trim().length >= 10;
  const newAppointmentDuplicateMatches = useMemo(() => {
    if (!duplicateCheckReady) return [];
    const phone = newAppointment.phone.replace(/\D/g, '').slice(-10);
    const address = newAppointment.address.toLowerCase().replace(/[^a-z0-9]/g, '');
    const customer = newAppointment.customer.trim().toLowerCase();
    const selectedWindow = scheduleWindowOptions.find((option) => option.value === newAppointment.window);
    if (!selectedWindow) return [];
    return allScheduledAppointments
      .filter((appointment) => appointment.day === scheduleDay && appointment.state !== 'Canceled')
      .map((appointment) => {
        const appointmentPhone = appointment.details.phone.replace(/\D/g, '').slice(-10);
        const appointmentAddress = appointment.details.address.toLowerCase().replace(/[^a-z0-9]/g, '');
        const phoneMatch = phone.length >= 7 && appointmentPhone === phone;
        const addressMatch = address.length >= 10 && appointmentAddress === address;
        const windowMatch = appointment.start < selectedWindow.start + selectedWindow.duration && appointment.start + appointment.duration > selectedWindow.start;
        const customerMatch = customer.length >= 3 && appointment.customer.trim().toLowerCase() === customer;
        const signals = [phoneMatch ? 'Phone' : '', addressMatch ? 'Service address' : '', windowMatch ? 'Overlapping time' : '', customerMatch ? 'Customer' : ''].filter(Boolean);
        const level = phoneMatch && addressMatch && windowMatch
          ? 'exact'
          : Number(phoneMatch) + Number(addressMatch) + Number(windowMatch) >= 2 || customerMatch && (phoneMatch || addressMatch)
            ? 'possible'
            : null;
        return level ? { appointment, level: level as 'exact' | 'possible', signals } : null;
      })
      .filter((match): match is NonNullable<typeof match> => Boolean(match))
      .sort((a, b) => (a.level === b.level ? b.signals.length - a.signals.length : a.level === 'exact' ? -1 : 1))
      .slice(0, 3);
  }, [allScheduledAppointments, duplicateCheckReady, newAppointment.address, newAppointment.customer, newAppointment.phone, newAppointment.window, scheduleDay]);
  const exactDuplicateBookings = newAppointmentDuplicateMatches.filter((match) => match.level === 'exact');
  const possibleDuplicateBookings = newAppointmentDuplicateMatches.filter((match) => match.level === 'possible');
  const duplicateOverrideSatisfied = possibleDuplicateBookings.length === 0 || duplicateOverrideReason.trim().length >= 12;
  useEffect(() => {
    setDuplicateOverrideReason('');
  }, [newAppointment.address, newAppointment.phone, newAppointment.window, scheduleDay]);
  const customerRecords = useMemo(() => {
    const records = new Map<string, { id: string; name: string; phone: string; appointments: typeof allScheduledAppointments }>();
    allScheduledAppointments.forEach((appointment) => {
      const phoneDigits = appointment.details.phone.replace(/\D/g, '');
      const id = phoneDigits.length >= 10 ? phoneDigits.slice(-10) : `${appointment.customer.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${appointment.jk}`;
      const existing = records.get(id);
      if (existing) existing.appointments.push(appointment);
      else records.set(id, { id, name: appointment.customer, phone: appointment.details.phone, appointments: [appointment] });
    });
    return Array.from(records.values());
  }, [allScheduledAppointments]);
  const newAppointmentCustomerMatches = useMemo(() => {
    const normalizedQuery = newAppointmentCustomerQuery.trim().toLowerCase();
    const queryDigits = normalizedQuery.replace(/\D/g, '');
    if (normalizedQuery.length < 2 && queryDigits.length < 3) return [];
    return customerRecords
      .filter((customer) => {
        const customerDigits = customer.phone.replace(/\D/g, '');
        const addresses = customer.appointments.map((appointment) => appointment.details.address).join(' ').toLowerCase();
        return customer.name.toLowerCase().includes(normalizedQuery)
          || addresses.includes(normalizedQuery)
          || (queryDigits.length >= 3 && customerDigits.includes(queryDigits));
      })
      .sort((a, b) => b.appointments.length - a.appointments.length || a.name.localeCompare(b.name))
      .slice(0, 4);
  }, [customerRecords, newAppointmentCustomerQuery]);
  const selectedNewAppointmentCustomer = newAppointmentCustomerId
    ? customerRecords.find((customer) => customer.id === newAppointmentCustomerId)
    : undefined;
  const selectedNewAppointmentCustomerLatest = selectedNewAppointmentCustomer
    ? selectedNewAppointmentCustomer.appointments[selectedNewAppointmentCustomer.appointments.length - 1]
    : undefined;
  const selectedNewAppointmentCustomerAddressCount = selectedNewAppointmentCustomer
    ? new Set(selectedNewAppointmentCustomer.appointments.map((appointment) => appointment.details.address)).size
    : 0;
  const appointmentsByTerritory = useMemo(() => groupAppointmentsByTerritory(scheduledAppointments), [scheduledAppointments]);
  const activeAppointment = drawer?.appointmentId
    ? scheduledAppointments.find((appointment) => appointment.jk === drawer.appointmentId)
    : undefined;
  const activeJobReference = drawer?.jobReferenceId;
  const activeCloseoutReceipt = activeAppointment ? appointmentCloseoutReceipts[activeAppointment.jk] : undefined;
  useEffect(() => {
    if (!activeAppointment) return;
    setAppointmentChangeDraft({
      truck: activeAppointment.truck,
      time: activeAppointment.time,
      callAhead: activeAppointment.state === 'Call ahead',
      addressVerified: Boolean(activeAppointment.addressVerified),
      cancel: activeAppointment.state === 'Canceled',
      cancellationReason: activeAppointment.cancellationReason || '',
    });
    setAppointmentCloseoutOpen(false);
    setAppointmentCloseoutError('');
    setAppointmentCloseoutDraft({
      category: activeAppointment.kind === 'Estimate' ? 'Estimate' : 'Job',
      amount: activeAppointment.details.value,
      paymentMethod: '',
      estimateOutcome: 'Follow-Up Required',
      followUpDate: '',
      notes: '',
    });
  }, [activeAppointment?.addressVerified, activeAppointment?.cancellationReason, activeAppointment?.details.value, activeAppointment?.jk, activeAppointment?.kind, activeAppointment?.state, activeAppointment?.time, activeAppointment?.truck]);
  const appointmentChangeWindow = scheduleWindowOptions.find((option) => option.value === appointmentChangeDraft.time);
  const appointmentChangeTargetRow = scheduleRows.find((row) => row.truck === appointmentChangeDraft.truck);
  const appointmentChangeDraftChanges = activeAppointment ? (() => {
    if (appointmentChangeDraft.cancel && activeAppointment.state !== 'Canceled') {
      return [`Status · Canceled${appointmentChangeDraft.cancellationReason.trim() ? ` · ${appointmentChangeDraft.cancellationReason.trim()}` : ''}`];
    }
    const changes: string[] = [];
    if (appointmentChangeDraft.truck !== activeAppointment.truck) changes.push(`Truck · ${activeAppointment.truck} → ${appointmentChangeDraft.truck}`);
    if (appointmentChangeDraft.time !== activeAppointment.time) changes.push(`Window · ${activeAppointment.time} → ${appointmentChangeDraft.time}`);
    if (appointmentChangeDraft.callAhead !== (activeAppointment.state === 'Call ahead')) changes.push(`Call Ahead · ${appointmentChangeDraft.callAhead ? 'Added' : 'Cleared'}`);
    if (appointmentChangeDraft.addressVerified !== Boolean(activeAppointment.addressVerified)) changes.push(`Address · ${appointmentChangeDraft.addressVerified ? 'Verified' : 'Needs verification'}`);
    return changes;
  })() : [];
  const appointmentChangeConflicts = activeAppointment
    && !appointmentChangeDraft.cancel
    && (appointmentChangeDraft.truck !== activeAppointment.truck || appointmentChangeDraft.time !== activeAppointment.time)
    && appointmentChangeWindow
    && appointmentChangeTargetRow
    ? appointmentChangeTargetRow.jobs.filter((job) => (
      job.jk !== activeAppointment.jk
      && job.jk !== 'Open capacity'
      && job.state !== 'Canceled'
      && job.start < appointmentChangeWindow.start + appointmentChangeWindow.duration
      && job.start + job.duration > appointmentChangeWindow.start
    ))
    : [];
  const activeCreationReceipt = appointmentCreationReceipt?.appointmentId === activeAppointment?.jk
    ? appointmentCreationReceipt
    : null;
  const scheduleChangeCustomerComplete = !scheduleChangeReceipt?.requiresCustomerConfirmation || scheduleChangeReceipt.customerConfirmed;
  const scheduleChangeCrewComplete = !scheduleChangeReceipt?.requiresCrewNotification || scheduleChangeReceipt.crewNotified;
  const scheduleChangeResolved = Boolean(scheduleChangeReceipt?.undone || (
    scheduleChangeReceipt?.syncState === 'verified'
    && scheduleChangeCustomerComplete
    && scheduleChangeCrewComplete
  ));
  const scheduleChangeBlocking = Boolean(scheduleChangeReceipt && !scheduleChangeResolved);
  const appointmentChangeLocked = Boolean(
    scheduleChangeBlocking
    || (activeAppointment && isFinalAppointmentState(activeAppointment.state))
  );
  const activeFollowup = drawer?.followupId ? scheduleFollowups.find((item) => item.jk === drawer.followupId) : undefined;
  const activeKrewe = drawer?.kreweId ? kreweMembers.find((member) => member.id === drawer.kreweId) : undefined;
  const activeFleetTruck = drawer?.fleetTruckId ? fleetTruckRows.find((truck) => truck.id === drawer.fleetTruckId) : undefined;
  const activeFleetIssue = drawer?.fleetIssueId ? fleetIssues.find((issue) => issue.id === drawer.fleetIssueId) : undefined;
  const activeActionQueueItem = drawer?.actionQueueId ? actionQueue.find((item) => item.id === drawer.actionQueueId) : undefined;
  const activeCustomer = drawer?.customerId ? customerRecords.find((customer) => customer.id === drawer.customerId) : undefined;
  const activeCustomerAppointmentIds = activeCustomer?.appointments.map((appointment) => appointment.jk) || [];
  const activeCustomerAddresses = activeCustomer ? Array.from(new Set(activeCustomer.appointments.map((appointment) => appointment.details.address))) : [];
  const activeCustomerPayments = activeCustomer ? financePayments.filter((payment) => activeCustomerAppointmentIds.includes(payment.id)) : [];
  const activeCustomerLeads = activeCustomer ? marketingLeads.filter((lead) => lead.phone.replace(/\D/g, '').slice(-10) === activeCustomer.id || lead.customer.toLowerCase() === activeCustomer.name.toLowerCase()) : [];
  const activeCustomerReviews = activeCustomer ? marketingReviews.filter((review) => activeCustomerAppointmentIds.includes(review.selectedAppointment) || review.customer.toLowerCase() === activeCustomer.name.toLowerCase()) : [];
  const activeCustomerAlerts = activeCustomer ? workItems.filter((item) => activeCustomerAppointmentIds.some((appointmentId) => `${item.title} ${item.detail}`.includes(appointmentId))) : [];
  const activeCustomerActions = activeCustomer ? actionQueue.filter((item) => activeCustomerAppointmentIds.includes(item.refId || '') || activeCustomerAppointmentIds.includes(item.record)) : [];
  const activeCustomerRevenue = activeCustomerPayments.reduce((sum, payment) => sum + payment.jobTotal, 0);
  const activeTerritory = drawer?.territoryId;
  const activeTerritoryCode = activeTerritory ? territoryDesignators[activeTerritory] : undefined;
  const activeTerritoryAppointments = activeTerritory ? allScheduledAppointments.filter((appointment) => appointment.territory === activeTerritory) : [];
  const activeTerritoryAppointmentIds = activeTerritoryAppointments.map((appointment) => appointment.jk);
  const activeTerritoryTodayAppointments = activeTerritoryAppointments.filter((appointment) => appointment.day === 'today');
  const activeTerritoryTomorrowAppointments = activeTerritoryAppointments.filter((appointment) => appointment.day === 'tomorrow');
  const activeTerritoryAreas = activeTerritory ? Array.from(new Set(activeTerritoryAppointments.map((appointment) => appointment.areaDesignator.code))).map((code) => {
    const areaAppointments = activeTerritoryAppointments.filter((appointment) => appointment.areaDesignator.code === code);
    return { code, label: areaAppointments[0]?.areaDesignator.label || code, appointments: areaAppointments };
  }) : [];
  const activeTerritoryTrucks = activeTerritory ? fleetTruckRows.filter((truck) => truck.territory === activeTerritory) : [];
  const activeTerritoryKrewe = activeTerritory ? kreweMembers.filter((member) => member.territory === activeTerritory && member.status !== 'Off today') : [];
  const activeTerritoryPayments = financePayments.filter((payment) => activeTerritoryAppointmentIds.includes(payment.id));
  const activeTerritoryRecordedRevenue = activeTerritoryPayments.reduce((sum, payment) => sum + payment.jobTotal, 0);
  const activeTerritoryOpenCapacity = activeTerritory ? scheduleRowsByDay.today.flatMap((row) => row.jobs).filter((job) => job.jk === 'Open capacity' && appointmentTerritoryForArea(job.area) === activeTerritory).length : 0;
  const activeTerritoryAlerts = activeTerritory ? workItems.filter((item) => `${item.title} ${item.detail} ${item.facts.map((fact) => fact.value).join(' ')}`.includes(activeTerritory) || activeTerritoryAppointmentIds.some((appointmentId) => `${item.title} ${item.detail}`.includes(appointmentId))) : [];
  const activeTerritoryActions = activeTerritory ? actionQueue.filter((item) => item.record === activeTerritory || activeTerritoryAppointmentIds.includes(item.refId || '') || activeTerritoryAppointmentIds.includes(item.record)) : [];
  const activeTerritoryScheduleHistory = activeTerritory ? scheduleHistoryRows.filter((item) => activeTerritoryAppointmentIds.includes(item.jk)) : [];
  const activeTerritoryAuditHistory = activeTerritory ? auditEvents.filter((item) => item.record === activeTerritory || activeTerritoryAppointmentIds.includes(item.refId || '')) : [];
  const activeTerritoryMapSrc = activeTerritoryCode ? `https://www.openstreetmap.org/export/embed.html?bbox=${(scheduleMapBboxes[`T:${activeTerritoryCode}`] || scheduleMapBboxes.ALL).replaceAll(',', '%2C')}&layer=mapnik` : '';
  const activeArea = drawer?.areaId && activeTerritory ? serviceAreaCatalog.find((area) => area.territory === activeTerritory && area.code === drawer.areaId) : undefined;
  const activeAreaAppointments = activeArea ? allScheduledAppointments.filter((appointment) => appointment.territory === activeArea.territory && appointment.areaDesignator.code === activeArea.code) : [];
  const activeAreaAppointmentIds = activeAreaAppointments.map((appointment) => appointment.jk);
  const activeAreaTodayAppointments = activeAreaAppointments.filter((appointment) => appointment.day === 'today');
  const activeAreaTomorrowAppointments = activeAreaAppointments.filter((appointment) => appointment.day === 'tomorrow');
  const activeAreaTruckLabels = new Set(activeAreaAppointments.map((appointment) => appointment.truck).filter((truck) => truck !== 'Unassigned'));
  const activeAreaTrucks = activeArea ? fleetTruckRows.filter((truck) => activeAreaTruckLabels.has(truck.label) || activeArea.localities.includes(truck.location)) : [];
  const activeAreaKrewe = activeArea ? kreweMembers.filter((member) => activeAreaTrucks.some((truck) => truck.label === member.truck) && member.status !== 'Off today') : [];
  const activeAreaPayments = financePayments.filter((payment) => activeAreaAppointmentIds.includes(payment.id));
  const activeAreaRecordedRevenue = activeAreaPayments.reduce((sum, payment) => sum + payment.jobTotal, 0);
  const activeAreaOpenCapacity = activeArea ? scheduleRowsByDay.today.flatMap((row) => row.jobs).filter((job) => job.jk === 'Open capacity' && appointmentTerritoryForArea(job.area) === activeArea.territory && areaDesignatorForArea(job.area).code === activeArea.code).length : 0;
  const activeAreaNeedsAssignment = activeAreaTodayAppointments.filter((appointment) => appointment.truck === 'Unassigned' || appointment.state === 'Assign truck').length;
  const activeAreaNeedsVerification = activeAreaTodayAppointments.filter((appointment) => !appointment.addressVerified).length;
  const activeAreaAlerts = activeArea ? workItems.filter((item) => activeAreaAppointmentIds.some((appointmentId) => `${item.title} ${item.detail}`.includes(appointmentId)) || [activeArea.label, ...activeArea.localities].some((place) => `${item.title} ${item.detail} ${item.context}`.includes(place))) : [];
  const activeAreaActions = activeArea ? actionQueue.filter((item) => activeAreaAppointmentIds.includes(item.refId || '') || activeAreaAppointmentIds.includes(item.record) || item.record === `${activeArea.territory} · ${activeArea.code}`) : [];
  const activeAreaScheduleHistory = activeArea ? scheduleHistoryRows.filter((item) => activeAreaAppointmentIds.includes(item.jk)) : [];
  const activeAreaAuditHistory = activeArea ? auditEvents.filter((item) => activeAreaAppointmentIds.includes(item.refId || '') || item.record === `${activeArea.territory} · ${activeArea.code}`) : [];
  const activeAreaMapSrc = activeArea ? `https://www.openstreetmap.org/export/embed.html?bbox=${(scheduleMapBboxes[`A:${activeArea.territoryCode}:${activeArea.code}`] || scheduleMapBboxes[`T:${activeArea.territoryCode}`] || scheduleMapBboxes.ALL).replaceAll(',', '%2C')}&layer=mapnik` : '';
  const activeJobPayment = activeAppointment ? financePayments.find((payment) => payment.id === activeAppointment.jk) : undefined;
  const activeJobTruck = activeAppointment ? fleetTruckRows.find((truck) => truck.label === activeAppointment.truck) : undefined;
  const activeJobKrewe = activeAppointment ? kreweMembers.filter((member) => member.truck === activeAppointment.truck && member.status !== 'Off today') : [];
  const activeJobRecoveryItems = activeAppointment ? financeRecoveryItems.filter((item) => item.sourceJob === activeAppointment.jk) : [];
  const activeJobAlerts = activeAppointment ? workItems.filter((item) => `${item.title} ${item.detail}`.includes(activeAppointment.jk)) : [];
  const activeJobActions = activeAppointment ? actionQueue.filter((item) => item.refId === activeAppointment.jk || item.record === activeAppointment.jk) : [];
  const activeJobScheduleHistory = activeAppointment ? scheduleHistoryRows.filter((item) => item.jk === activeAppointment.jk) : [];
  const activeJobAuditHistory = activeAppointment ? auditEvents.filter((item) => item.refId === activeAppointment.jk || item.record.includes(activeAppointment.jk)) : [];
  const activeJobPhotoAlert = activeJobAlerts.find((item) => item.label === 'Photos uploaded');
  const activeJobCloseoutAlert = activeJobAlerts.find((item) => item.label === 'Job closed');
  const activeJobCustomer = activeAppointment ? customerRecords.find((customer) => customer.appointments.some((appointment) => appointment.jk === activeAppointment.jk)) : undefined;
  const activeTruckAppointments = activeFleetTruck ? allScheduledAppointments.filter((appointment) => appointment.truck === activeFleetTruck.label) : [];
  const activeTruckAppointmentIds = activeTruckAppointments.map((appointment) => appointment.jk);
  const activeTruckKrewe = activeFleetTruck ? kreweMembers.filter((member) => member.truck === activeFleetTruck.label && member.status !== 'Off today') : [];
  const activeTruckIssues = activeFleetTruck ? fleetIssues.filter((issue) => issue.truckId === activeFleetTruck.id) : [];
  const activeTruckAlerts = activeFleetTruck ? workItems.filter((item) => `${item.title} ${item.detail} ${item.facts.map((fact) => fact.value).join(' ')}`.includes(activeFleetTruck.label) || activeTruckAppointmentIds.some((appointmentId) => `${item.title} ${item.detail}`.includes(appointmentId))) : [];
  const activeTruckActions = activeFleetTruck ? actionQueue.filter((item) => item.refId === activeFleetTruck.id || item.record === activeFleetTruck.label || activeTruckAppointmentIds.includes(item.refId || '') || activeTruckAppointmentIds.includes(item.record)) : [];
  const activeTruckScheduleHistory = activeFleetTruck ? scheduleHistoryRows.filter((item) => activeTruckAppointmentIds.includes(item.jk)) : [];
  const activeTruckAuditHistory = activeFleetTruck ? auditEvents.filter((item) => item.refId === activeFleetTruck.id || item.record === activeFleetTruck.label || activeTruckAppointmentIds.includes(item.refId || '')) : [];
  const activeFleetIssues = fleetIssues.filter((issue) => issue.status !== 'Resolved');
  const fleetCounts = {
    ready: fleetTruckRows.filter((truck) => truck.readiness === 'Ready').length,
    active: fleetTruckRows.filter((truck) => ['On site', 'En route', 'On route'].includes(truck.operatingStatus)).length,
    attention: fleetTruckRows.filter((truck) => truck.readiness === 'Attention').length,
    out: fleetTruckRows.filter((truck) => truck.readiness === 'Out of service').length,
    service: fleetTruckRows.filter((truck) => truck.serviceTone !== 'current').length,
    stale: fleetTruckRows.filter((truck) => !truck.gpsFresh).length,
  };
  const fleetSummaryFilterLabels: Record<FleetSummaryFilter, string> = {
    all: 'Live operating view',
    ready: 'Ready',
    working: 'Working now',
    attention: 'Needs attention',
    out: 'Out of service',
    service: 'Service due or soon',
    stale: 'Telemetry stale',
  };
  const truckMatchesFleetSummary = (truck: FleetTruck) => fleetSummaryFilter === 'all'
    || (fleetSummaryFilter === 'ready' && truck.readiness === 'Ready')
    || (fleetSummaryFilter === 'working' && ['On site', 'En route', 'On route'].includes(truck.operatingStatus))
    || (fleetSummaryFilter === 'attention' && truck.readiness === 'Attention')
    || (fleetSummaryFilter === 'out' && truck.readiness === 'Out of service')
    || (fleetSummaryFilter === 'service' && truck.serviceTone !== 'current')
    || (fleetSummaryFilter === 'stale' && !truck.gpsFresh);
  const normalizedFleetQuery = query.trim().toLowerCase();
  const visibleFleetTrucks = fleetTruckRows.filter((truck) => truckMatchesFleetSummary(truck) && (!normalizedFleetQuery || `${truck.label} ${truck.vehicle} ${truck.readiness} ${truck.operatingStatus} ${truck.driver} ${truck.navigator} ${truck.territory} ${truck.assignment} ${truck.location}`.toLowerCase().includes(normalizedFleetQuery)));
  const visibleFleetIssues = fleetIssues.filter((issue) => (fleetIssueFilter === 'all' || issue.status !== 'Resolved') && (!normalizedFleetQuery || `${issue.title} ${issue.status} ${issue.severity} ${issue.owner} ${fleetTruckRows.find((truck) => truck.id === issue.truckId)?.label || ''}`.toLowerCase().includes(normalizedFleetQuery)));
  const fleetTotals = fleetTruckRows.reduce((totals, truck) => ({ jobs: totals.jobs + truck.jobs, revenue: totals.revenue + truck.revenue, miles: totals.miles + truck.miles, idle: totals.idle + truck.idleMinutes }), { jobs: 0, revenue: 0, miles: 0, idle: 0 });
  const fleetReportFactor = fleetReportMonth === 'august' ? 1 : .92;
  const selectedFleetServiceTruck = fleetTruckRows.find((truck) => truck.id === selectedServiceTruck) || fleetTruckRows[0];
  const marketingRecoveryLeads = marketingLeads.filter((lead) => ['Lost', 'Needs follow-up'].includes(lead.status));
  const marketingLostCount = marketingLeads.filter((lead) => lead.status === 'Lost').length;
  const marketingReviewCount = marketingReviews.filter((review) => review.status === 'Needs attribution').length;
  const todaysMarketingReviews = marketingReviews.filter((review) => review.age !== 'Yesterday');
  const todaysReviewAverage = todaysMarketingReviews.length
    ? todaysMarketingReviews.reduce((sum, review) => sum + review.stars, 0) / todaysMarketingReviews.length
    : null;
  const normalizedMarketingQuery = query.trim().toLowerCase();
  const visibleMarketingLeads = marketingLeads.filter((lead) => {
    const matchesFilter = marketingLeadFilter === 'all'
      || (marketingLeadFilter === 'recover' && ['Lost', 'Needs follow-up'].includes(lead.status))
      || (marketingLeadFilter === 'lost' && lead.status === 'Lost')
      || (marketingLeadFilter === 'followup' && lead.status === 'Needs follow-up');
    return matchesFilter && (!normalizedMarketingQuery || `${lead.customer} ${lead.phone} ${lead.territory} ${lead.intent} ${lead.status} ${lead.source}`.toLowerCase().includes(normalizedMarketingQuery));
  }).sort((a, b) => a.status === 'Lost' && b.status !== 'Lost' ? -1 : a.status !== 'Lost' && b.status === 'Lost' ? 1 : 0);
  const marketingTotals = marketingSources.reduce((totals, source) => ({ calls: totals.calls + source.calls, qualified: totals.qualified + source.qualified, bookings: totals.bookings + source.bookings, completed: totals.completed + source.completed, revenue: totals.revenue + source.revenue, cost: totals.cost + source.cost }), { calls: 0, qualified: 0, bookings: 0, completed: 0, revenue: 0, cost: 0 });
  const financeJobTotal = financePayments.reduce((sum, payment) => sum + payment.jobTotal, 0);
  const financePaymentTotal = financePayments.reduce((sum, payment) => sum + payment.paymentAmount + payment.adjustment, 0);
  const financeDifference = financePayments.reduce((sum, payment) => sum + Math.abs(payment.jobTotal - payment.paymentAmount - payment.adjustment), 0);
  const financeMatchedCount = financePayments.filter((payment) => payment.status === 'Matched').length;
  const financeMonth = financeMonthlyTrend[financeMonthlyTrend.length - 1];
  const financePriorMonth = financeMonthlyTrend[financeMonthlyTrend.length - 2];
  const financeCostTotal = financeCosts.reduce((sum, cost) => sum + cost.amount, 0);
  const financePriorCostTotal = financeCosts.reduce((sum, cost) => sum + cost.prior, 0);
  const financeResaleItems = financeRecoveryItems.filter((item) => item.kind === 'Resale');
  const financeRecyclingItems = financeRecoveryItems.filter((item) => item.kind === 'Recycling');
  const financeResaleRevenue = financeResaleItems.reduce((sum, item) => sum + (item.realizedValue || 0), 0);
  const financeRecyclingRevenue = financeRecyclingItems.reduce((sum, item) => sum + (item.realizedValue || 0), 0);
  const financeResaleOnHandValue = financeResaleItems.filter((item) => item.status !== 'Sold').reduce((sum, item) => sum + item.expectedValue, 0);
  const financeResaleAttention = financeResaleItems.filter((item) => ['Awaiting disposition', 'Held'].includes(item.status)).length;
  const financeRecyclingAttention = financeRecyclingItems.filter((item) => ['Ticket missing', 'Awaiting yard'].includes(item.status)).length;
  const workingKrewe = kreweMembers.filter((member) => member.status !== 'Off today');
  const rankedKrewe = [...workingKrewe]
    .filter((member) => member.revenue != null || member.jobs != null)
    .sort((a, b) => (b.revenue || 0) - (a.revenue || 0) || (b.jobs || 0) - (a.jobs || 0) || (b.rph || 0) - (a.rph || 0));
  const dailyKreweRevenue = workingKrewe.reduce((sum, member) => sum + (member.revenue || 0), 0);
  const dailyRphRows = workingKrewe.filter((member) => member.rph != null);
  const dailyAverageRph = dailyRphRows.length ? dailyRphRows.reduce((sum, member) => sum + (member.rph || 0), 0) / dailyRphRows.length : null;
  const dailyTotalEarnings = workingKrewe.reduce((sum, member) => sum + (member.totalPay || 0), 0);
  const periodTotals = kreweMembers.reduce((totals, member) => ({
    regularHours: totals.regularHours + member.period.regularHours,
    overtimeHours: totals.overtimeHours + member.period.overtimeHours,
    jobs: totals.jobs + member.period.jobs,
    revenue: totals.revenue + member.period.revenue,
    labor: totals.labor + member.period.labor,
    tips: totals.tips + member.period.tips,
    bonuses: totals.bonuses + member.period.bonuses,
    automatedBonuses: totals.automatedBonuses + member.period.automatedBonuses,
    manualBonuses: totals.manualBonuses + member.period.manualBonuses,
    supplemental: totals.supplemental + member.period.supplemental,
    totalPay: totals.totalPay + member.period.totalPay,
  }), period(0, 0, 0, 0, 0, 0, 0, 0, 0));
  const monthFactor = kreweMonth === 'august' ? 1 : .91;
  const monthlyTotals = kreweMembers.reduce((totals, member) => ({
    regularHours: totals.regularHours + member.month.regularHours * monthFactor,
    overtimeHours: totals.overtimeHours + member.month.overtimeHours * monthFactor,
    jobs: totals.jobs + Math.round(member.month.jobs * monthFactor),
    revenue: totals.revenue + member.month.revenue * monthFactor,
    labor: totals.labor + member.month.labor * monthFactor,
    tips: totals.tips + member.month.tips * monthFactor,
    bonuses: totals.bonuses + member.month.bonuses * monthFactor,
    automatedBonuses: totals.automatedBonuses + member.month.automatedBonuses * monthFactor,
    manualBonuses: totals.manualBonuses + member.month.manualBonuses * monthFactor,
    supplemental: totals.supplemental + member.month.supplemental * monthFactor,
    totalPay: totals.totalPay + member.month.totalPay * monthFactor,
  }), period(0, 0, 0, 0, 0, 0, 0, 0, 0));
  const kreweCounts = {
    all: kreweMembers.length,
    working: kreweMembers.filter((member) => member.status !== 'Off today').length,
    unassigned: kreweMembers.filter((member) => member.truck === 'Unassigned').length,
    attention: kreweMembers.filter((member) => Boolean(member.issue)).length,
    off: kreweMembers.filter((member) => member.status === 'Off today').length,
  };
  const visibleKrewe = kreweMembers.filter((member) => {
    const matchesFilter = kreweFilter === 'all'
      || (kreweFilter === 'working' && member.status !== 'Off today')
      || (kreweFilter === 'unassigned' && member.truck === 'Unassigned')
      || (kreweFilter === 'attention' && Boolean(member.issue))
      || (kreweFilter === 'off' && member.status === 'Off today');
    const normalized = query.trim().toLowerCase();
    return matchesFilter && (!normalized || `${member.name} ${member.role} ${member.status} ${member.truck} ${member.territory}`.toLowerCase().includes(normalized));
  });
  const activeFollowups = scheduleFollowups.filter((item) => !handledFollowups.includes(item.jk));
  const visibleFollowups = activeFollowups.filter((item) => followupFilter === 'all' || item.kind === followupFilter);
  const followupCounts = {
    all: activeFollowups.length,
    estimates: activeFollowups.filter((item) => item.kind === 'estimates').length,
    closed: activeFollowups.filter((item) => item.kind === 'closed').length,
    unclosed: activeFollowups.filter((item) => item.kind === 'unclosed').length,
    photos: activeFollowups.filter((item) => item.kind === 'photos').length,
  };
  const scheduleDayHistory = scheduleHistoryRows.filter((item) => item.day === scheduleDay);
  const historyCounts = {
    all: scheduleDayHistory.length,
    plan: scheduleDayHistory.filter((item) => ['Created', 'Rescheduled', 'Reassigned'].includes(item.type)).length,
    cancelled: scheduleDayHistory.filter((item) => item.type === 'Cancelled').length,
    confirmation: scheduleDayHistory.filter((item) => ['Verified', 'Status'].includes(item.type)).length,
  };
  const visibleHistoryRows = scheduleDayHistory.filter((item) => {
    if (historyFilter === 'all') return true;
    if (historyFilter === 'plan') return ['Created', 'Rescheduled', 'Reassigned'].includes(item.type);
    if (historyFilter === 'cancelled') return item.type === 'Cancelled';
    return ['Verified', 'Status'].includes(item.type);
  });
  const historySourceCounts = Array.from(new Set(scheduleDayHistory.map((item) => item.source))).map((source) => ({
    source,
    count: scheduleDayHistory.filter((item) => item.source === source).length,
  }));
  const scheduleDensity = scheduleRows.length >= 10 ? 'ultra' : scheduleRows.length >= 7 ? 'compact' : 'comfortable';
  const appointmentMatchesScheduleScope = (area: string) => {
    if (scheduleScope === 'ALL') return true;
    const territory = appointmentTerritoryForArea(area);
    const territoryCode = territoryDesignators[territory];
    const areaCode = areaDesignatorForArea(area).code;
    return scheduleScope === `T:${territoryCode}` || scheduleScope === `A:${territoryCode}:${areaCode}`;
  };
  const appointmentMatchesScheduleStatus = (appointment: ReturnType<typeof buildScheduledAppointments>[number]) => {
    if (scheduleStatusFilter === 'all') return true;
    if (scheduleStatusFilter === 'completed') return appointment.kind === 'Job' && appointment.state === 'Completed';
    if (scheduleStatusFilter === 'closed-estimates') return appointment.kind === 'Estimate' && appointment.state === 'Estimate Closed';
    if (scheduleStatusFilter === 'open') return !isFinalAppointmentState(appointment.state);
    if (scheduleStatusFilter === 'unassigned') return appointment.truck === 'Unassigned' || appointment.state === 'Assign truck';
    return !appointment.addressVerified;
  };
  const visibleAppointmentGroups = appointmentsByTerritory.map((group) => {
    const areas = group.areas.map((area) => ({
      ...area,
      appointments: area.appointments.filter((appointment) => appointmentMatchesScheduleScope(appointment.area) && appointmentMatchesScheduleStatus(appointment)),
    })).filter((area) => area.appointments.length > 0);
    return { ...group, areas, appointments: areas.flatMap((area) => area.appointments) };
  }).filter((group) => group.appointments.length > 0);
  const visibleAppointments = visibleAppointmentGroups.flatMap((group) => group.appointments);
  const visibleAppointmentCount = visibleAppointmentGroups.reduce((sum, group) => sum + group.appointments.length, 0);
  const orderedVisibleAppointmentGroups = territoryPriority
    ? [...visibleAppointmentGroups].sort((a, b) => a.designator === territoryPriority ? -1 : b.designator === territoryPriority ? 1 : 0)
    : visibleAppointmentGroups;
  const selectedTerritory = appointmentsByTerritory.find((group) => scheduleScope === `T:${group.designator}`);
  const selectedArea = appointmentsByTerritory.flatMap((group) => group.areas.map((area) => ({ ...area, territory: group })))
    .find((area) => scheduleScope === `A:${area.territory.designator}:${area.code}`);
  const scheduleScopeLabel = scheduleScope === 'ALL' ? 'All territories' : selectedTerritory?.territory || selectedArea?.label || 'Selected area';
  const scheduleStatusLabel: Record<ScheduleStatusFilter, string> = { all: 'All Appointments', completed: 'Completed Jobs', 'closed-estimates': 'Closed Estimates', open: 'Open', unassigned: 'Unassigned', verify: 'Verify Address' };
  const scheduleFiltersActive = scheduleScope !== 'ALL' || scheduleStatusFilter !== 'all';
  const scheduleFilterSummary = scheduleStatusFilter === 'all' ? scheduleScopeLabel : `${scheduleScopeLabel} · ${scheduleStatusLabel[scheduleStatusFilter]}`;
  const scheduleCalendarEntries = Object.entries(scheduleCalendarCounts).map(([day, count]) => ({ day: Number(day), count }));
  const scheduleCalendarTotal = scheduleCalendarEntries.reduce((sum, entry) => sum + entry.count, 0);
  const scheduleCalendarPeak = Math.max(...scheduleCalendarEntries.map((entry) => entry.count));
  const scheduleCalendarPeakDays = scheduleCalendarEntries.filter((entry) => entry.count === scheduleCalendarPeak).map((entry) => entry.day);
  const selectedCalendarCount = scheduleCalendarCounts[selectedCalendarDay] || 0;
  const selectedCalendarTerritories = calendarTerritoryBreakdown(selectedCalendarDay, selectedCalendarCount);
  const selectedCalendarDate = new Date(2026, 7, selectedCalendarDay);
  const selectedCalendarLabel = selectedCalendarDate.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
  const scheduleMapBbox = scheduleMapBboxes[scheduleScope] || scheduleMapBboxes.ALL;
  const scheduleMapSrc = `https://www.openstreetmap.org/export/embed.html?bbox=${scheduleMapBbox.replaceAll(',', '%2C')}&layer=mapnik`;
  const appointmentIdMatchesScheduleFilters = (appointmentId: string) => {
    const appointment = scheduledAppointments.find((item) => item.jk === appointmentId);
    return appointment ? appointmentMatchesScheduleScope(appointment.area) && appointmentMatchesScheduleStatus(appointment) : false;
  };
  const scheduleJobMatchesFilters = (job: ScheduleJob, truck: string) => {
    if (!appointmentMatchesScheduleScope(job.area)) return false;
    if (job.jk === 'Open capacity') return scheduleStatusFilter === 'all' || scheduleStatusFilter === 'open';
    const appointment = scheduledAppointments.find((item) => item.jk === job.jk);
    if (!appointment) return scheduleStatusFilter === 'all';
    return appointmentMatchesScheduleStatus({ ...appointment, truck });
  };
  const mapMarkerMatchesScheduleScope = (territoryCode: string, areaCode: string) => scheduleScope === 'ALL'
    || scheduleScope === `T:${territoryCode}` || scheduleScope === `A:${territoryCode}:${areaCode}`;
  const routeTruckMarkerClass = (truck: string) => !routeFocusAppointment
    ? ''
    : bestRouteCandidate?.truck === truck
      ? ' route-best'
      : routeCandidateTruckLabels.has(truck) ? ' route-candidate' : ' route-muted';
  const openRouteFocusAppointment = () => {
    if (!routeFocusAppointment) return;
    openUnifiedJobRecord(routeFocusAppointment.jk, 'JunkWare schedule', scheduleDay === 'today' ? 'Live' : 'Planning');
  };
  const resetScheduleSelection = () => {
    setScheduleScope('ALL');
    setScheduleStatusFilter('all');
    setTerritoryPriority(null);
    setRouteFocusAppointmentId(null);
    setDraggedAppointmentId(null);
    setDragPreview(null);
    setPendingScheduleMove(null);
    schedulePointerCleanupRef.current?.();
    schedulePointerCleanupRef.current = null;
    schedulePointerDragRef.current = null;
  };
  const reviewUnverifiedAddresses = () => {
    setScheduleScope('ALL');
    setScheduleStatusFilter('verify');
    setTerritoryPriority(null);
    setRouteFocusAppointmentId(null);
  };
  const exportScheduleDay = () => {
    const rows = [
      ['Date', 'Time', 'JK Number', 'Type', 'Customer', 'Phone', 'Service Location', 'Territory', 'Area', 'Truck', 'Krewe', 'Work', 'Value', 'Status', 'Address Verified', 'Notes'],
      ...scheduledAppointments.map((appointment) => [
        scheduleDay === 'today' ? '2026-08-31' : '2026-09-01', appointment.time, appointment.jk, appointment.kind,
        appointment.customer, appointment.details.phone, appointment.details.address, appointment.territory, appointment.area,
        appointment.truck, appointment.crew, appointment.details.scope, appointment.details.value, appointment.state,
        appointment.addressVerified ? 'Yes' : 'No', appointment.cancellationReason || appointment.details.notes,
      ]),
    ];
    const csv = rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `opscenter-schedule-${scheduleDay === 'today' ? '2026-08-31' : '2026-09-01'}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  };
  const openScheduleMonthSummary = () => openRecordDrawer({
    kicker: 'Schedule · Monthly Summary',
    title: 'August 2026',
    summary: `${scheduleCalendarTotal} scheduled appointments across ${scheduleCalendarEntries.length} operating days`,
    action: 'Close Summary',
    source: 'JunkWare schedule archive',
    updated: 'Through Aug 31',
    facts: [
      { label: 'Scheduled appointments', value: String(scheduleCalendarTotal) },
      { label: 'Operating days', value: String(scheduleCalendarEntries.length) },
      { label: 'Average per operating day', value: (scheduleCalendarTotal / scheduleCalendarEntries.length).toFixed(1) },
      { label: 'Busiest days', value: `Aug ${scheduleCalendarPeakDays.join(', ')} · ${scheduleCalendarPeak} appointments` },
      { label: 'Current day', value: `${scheduleCalendarCounts[31] || 0} appointments` },
    ],
  });
  const changeScheduleDay = (day: ScheduleDay) => {
    if (day !== scheduleDay && scheduleChangeBlocking) {
      setActionFeedback(`Resolve the ${scheduleChangeReceipt?.appointmentId} schedule change before switching operating days.`);
      return;
    }
    setScheduleDay(day);
    setOperatingDate(day === 'today' ? '2026-08-31' : '2026-09-01');
    setCalendarDateDraft(day === 'today' ? '2026-08-31' : '2026-09-01');
    setDrawer(null);
    setHistoryFilter('all');
    resetScheduleSelection();
  };
  const logAudit = (event: Omit<AuditEvent, 'id' | 'time' | 'actor'> & { actor?: string }) => {
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setAuditEvents((events) => [{
      ...event,
      id: `AE-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      time,
      actor: event.actor || 'Mission Control',
    }, ...events]);
  };
  const appendScheduleHistory = (item: Omit<ScheduleHistoryRow, 'time' | 'by' | 'source' | 'day'>, day: ScheduleDay = scheduleDay) => {
    const time = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setScheduleHistoryRows((history) => [{ ...item, time, by: 'Mission Control', source: 'OpsCenter', day }, ...history]);
    const [previous, next] = item.change.includes(' → ') ? item.change.split(' → ', 2) : ['Schedule record', item.change];
    logAudit({
      workspace: 'Schedule', action: item.type, record: item.jk, summary: item.change,
      previous, next, source: 'OpsCenter', result: 'Completed', refId: item.jk,
    });
  };
  const closeNewAppointment = () => {
    junkWareCreationRunRef.current += 1;
    setJunkWareCreationState('idle');
    setJunkWareCreationJk('');
    setNewAppointmentOpen(false);
  };
  const editReviewedBooking = () => {
    junkWareCreationRunRef.current += 1;
    setJunkWareCreationState('idle');
    setJunkWareCreationJk('');
    setReviewedBookingFingerprint(null);
  };
  const openNewAppointment = () => {
    if (scheduleChangeBlocking) {
      setActiveNav('Schedule');
      setScheduleView('board');
      setDrawer(null);
      setActionFeedback(`Resolve the ${scheduleChangeReceipt?.appointmentId} schedule change before creating another appointment.`);
      return;
    }
    const scopedArea = selectedArea?.appointments[0]?.area || selectedTerritory?.appointments[0]?.area || 'New Orleans';
    setDrawer(null);
    setNewAppointment({ ...emptyNewAppointment, area: scopedArea });
    setNewAppointmentError('');
    setNewAppointmentCustomerQuery('');
    setNewAppointmentCustomerId(null);
    setNewAppointmentAddressVerification(null);
    setReviewedBookingFingerprint(null);
    setDuplicateOverrideReason('');
    setJunkWareCreationState('idle');
    setJunkWareCreationJk('');
    setNewAppointmentOpen(true);
  };
  const selectExistingCustomerForAppointment = (customer: (typeof customerRecords)[number]) => {
    const latestAppointment = customer.appointments[customer.appointments.length - 1];
    setNewAppointment((form) => ({
      ...form,
      customer: customer.name,
      phone: customer.phone,
      address: latestAppointment?.details.address || form.address,
      area: latestAppointment?.area || form.area,
      notes: latestAppointment?.details.notes || form.notes,
    }));
    setNewAppointmentCustomerQuery(`${customer.name} · ${customer.phone}`);
    setNewAppointmentCustomerId(customer.id);
    setNewAppointmentAddressVerification(null);
    setNewAppointmentError('');
  };
  const clearExistingCustomerForAppointment = () => {
    setNewAppointmentCustomerQuery('');
    setNewAppointmentCustomerId(null);
    setNewAppointmentAddressVerification(null);
    setNewAppointment((form) => ({ ...form, customer: '', phone: '', address: '', notes: '' }));
  };
  const updateExistingCustomerQuery = (value: string) => {
    if (newAppointmentCustomerId) setNewAppointment((form) => ({ ...form, customer: '', phone: '', address: '', notes: '' }));
    setNewAppointmentCustomerQuery(value);
    setNewAppointmentCustomerId(null);
    setNewAppointmentAddressVerification(null);
  };
  const updateNewAppointmentAddress = (value: string) => {
    setNewAppointment((form) => ({ ...form, address: value }));
    setNewAppointmentAddressVerification(null);
    setNewAppointmentError('');
  };
  const updateNewAppointmentArea = (area: string) => {
    setNewAppointment((form) => ({ ...form, area }));
    setNewAppointmentAddressVerification((verification) => verification?.status === 'review' ? verification : null);
    setNewAppointmentError('');
  };
  const verifyNewAppointmentAddress = () => {
    const input = newAppointment.address.trim().replace(/\s+/g, ' ');
    const normalizedAddress = input.toLowerCase().replace(/[^a-z0-9]/g, '');
    const linkedAppointments = allScheduledAppointments
      .filter((appointment) => appointment.details.address.toLowerCase().replace(/[^a-z0-9]/g, '') === normalizedAddress)
      .map((appointment) => appointment.jk);
    if (input.length < 10 || !/^\d+[a-z]?\s+/i.test(input)) {
      setNewAppointmentAddressVerification({ status: 'incomplete', input, normalizedAddress, linkedAppointments, message: 'Add a street number, street name, city, state, and ZIP before verification.' });
      return;
    }
    const lowerAddress = input.toLowerCase();
    const outsideCity = ['shreveport', 'monroe', 'lake charles', 'alexandria', 'mobile', 'houston', 'jackson'].find((city) => lowerAddress.includes(city));
    if (outsideCity) {
      setNewAppointmentAddressVerification({ status: 'outside', input, normalizedAddress, linkedAppointments, message: `${outsideCity.replace(/\b\w/g, (letter) => letter.toUpperCase())} is outside the configured Louisiana service territories.` });
      return;
    }
    const directArea = [...newAppointmentAreaOptions]
      .sort((a, b) => b.length - a.length)
      .find((area) => lowerAddress.includes(area.toLowerCase()));
    const zipArea = serviceAreaZipPrefixes.find((item) => item.pattern.test(input))?.area;
    const matchedArea = directArea || zipArea;
    if (!matchedArea) {
      setNewAppointmentAddressVerification({ status: 'review', input, normalizedAddress, linkedAppointments, message: `The city or ZIP did not match a configured service area. Review the selected area before continuing.` });
      return;
    }
    const territory = appointmentTerritoryForArea(matchedArea);
    const areaCode = areaDesignatorForArea(matchedArea).code;
    const pin = buildPrototypeAddressPin(matchedArea, input);
    setNewAppointment((form) => ({ ...form, address: input, area: matchedArea }));
    setNewAppointmentAddressVerification({ status: 'verified', input, normalizedAddress, linkedAppointments, matchedArea, territory, areaCode, ...pin, message: `${territory} · ${areaCode} service coverage confirmed.` });
    setNewAppointmentError('');
  };
  const confirmNewAppointmentSelectedArea = () => {
    const input = newAppointment.address.trim().replace(/\s+/g, ' ');
    if (!newAppointmentAddressVerification || newAppointmentAddressVerification.status !== 'review' || !input) return;
    const matchedArea = newAppointment.area;
    const territory = appointmentTerritoryForArea(matchedArea);
    const areaCode = areaDesignatorForArea(matchedArea).code;
    const pin = buildPrototypeAddressPin(matchedArea, input);
    setNewAppointmentAddressVerification({
      ...newAppointmentAddressVerification,
      status: 'verified', input, matchedArea, territory, areaCode, ...pin, manual: true,
      message: `${territory} · ${areaCode} selected manually. Confirm the source address before production write-back.`,
    });
    setNewAppointmentError('');
  };
  const applyNewAppointmentPlacement = (placement: NewAppointmentPlacement) => {
    if (placement.capacityStatus === 'insufficient') {
      setNewAppointmentError(`${placement.truck} needs a dump before this estimated load can be assigned.`);
      return;
    }
    setNewAppointment((form) => ({ ...form, truck: placement.truck, window: placement.window }));
    setNewAppointmentError('');
  };
  const validateNewAppointmentDraft = () => {
    if (![newAppointment.customer, newAppointment.phone, newAppointment.address, newAppointment.scope, newAppointment.value].every((value) => value.trim())) return 'Customer, phone, service address, work, and value are required.';
    if (newAppointmentAddressVerification?.status !== 'verified' || newAppointmentAddressVerification.input !== newAppointment.address.trim()) return 'Verify the current service address before reviewing the appointment.';
    if (exactDuplicateBookings.length > 0) return `Creation blocked: ${exactDuplicateBookings[0].appointment.jk} matches this operating date, phone, service address, and appointment window.`;
    if (possibleDuplicateBookings.length > 0 && !duplicateOverrideSatisfied) return 'Enter a specific reason for creating another appointment despite the possible duplicate match.';
    const appointmentWindow = scheduleWindowOptions.find((option) => option.value === newAppointment.window);
    const targetRow = scheduleRows.find((row) => row.truck === newAppointment.truck);
    if (!appointmentWindow || !targetRow) return 'Choose a valid appointment window and truck assignment.';
    const assignedFleetTruck = fleetTruckRows.find((truck) => truck.label === targetRow.truck);
    if (assignedFleetTruck?.readiness === 'Out of service') return `${assignedFleetTruck.label} is out of service and cannot receive this appointment.`;
    if (assignedFleetTruck && assignedFleetTruck.loadPercent + newAppointmentEstimatedLoadPercent > 100) {
      const unloadAction = newAppointment.loadStream === 'metal' ? 'metal-yard stop' : newAppointment.loadStream === 'donation' ? 'unload' : 'dump';
      return `${assignedFleetTruck.label} is ${assignedFleetTruck.loadPercent}% loaded and cannot fit the estimated ${newAppointment.loadPickups}-pickup load without a ${unloadAction}.`;
    }
    return '';
  };
  const reviewNewAppointment = () => {
    const error = validateNewAppointmentDraft();
    if (error) {
      setNewAppointmentError(error);
      return;
    }
    setNewAppointmentError('');
    setReviewedBookingFingerprint(currentBookingFingerprint);
  };
  const commitCreatedAppointment = (id: string) => {
    if (![newAppointment.customer, newAppointment.phone, newAppointment.address, newAppointment.scope, newAppointment.value].every((value) => value.trim())) {
      setNewAppointmentError('Customer, phone, service address, work, and value are required.');
      return;
    }
    if (newAppointmentAddressVerification?.status !== 'verified' || newAppointmentAddressVerification.input !== newAppointment.address.trim()) {
      setNewAppointmentError('Verify the current service address before creating the appointment.');
      return;
    }
    const appointmentWindow = scheduleWindowOptions.find((option) => option.value === newAppointment.window);
    const targetRow = scheduleRows.find((row) => row.truck === newAppointment.truck);
    if (!appointmentWindow || !targetRow) {
      setNewAppointmentError('Choose a valid appointment window and truck assignment.');
      return;
    }
    const assignedFleetTruck = fleetTruckRows.find((truck) => truck.label === targetRow.truck);
    const estimatedLoadPercent = Math.round((newAppointment.loadPickups / 6) * 100);
    if (assignedFleetTruck?.readiness === 'Out of service') {
      setNewAppointmentError(`${assignedFleetTruck.label} is out of service and cannot receive this appointment.`);
      return;
    }
    if (assignedFleetTruck && assignedFleetTruck.loadPercent + estimatedLoadPercent > 100) {
      const unloadAction = newAppointment.loadStream === 'metal' ? 'metal-yard stop' : newAppointment.loadStream === 'donation' ? 'unload' : 'dump';
      setNewAppointmentError(`${assignedFleetTruck.label} is ${assignedFleetTruck.loadPercent}% loaded and cannot fit the estimated ${newAppointment.loadPickups}-pickup load without a ${unloadAction}.`);
      return;
    }
    const createdJob: ScheduleJob = {
      start: appointmentWindow.start,
      duration: appointmentWindow.duration,
      time: appointmentWindow.value,
      jk: id,
      customer: newAppointment.customer.trim(),
      area: newAppointment.area,
      kind: newAppointment.kind,
      state: targetRow.truck === 'Unassigned' ? 'Assign truck' : 'Confirmed',
      addressVerified: true,
      estimatedPickups: newAppointment.loadPickups,
      estimatedLoadStream: newAppointment.loadStream,
      details: {
        phone: newAppointment.phone.trim(),
        address: newAppointment.address.trim(),
        scope: newAppointment.scope.trim(),
        value: newAppointment.value.trim(),
        notes: newAppointment.notes.trim() || 'No appointment notes',
      },
    };
    setScheduleRows((rows) => rows.map((row) => row.truck === targetRow.truck
      ? { ...row, jobs: [...row.jobs, createdJob].sort((a, b) => a.start - b.start) }
      : row));
    appendScheduleHistory({ type: 'Created', jk: id, change: `Prototype JunkWare response assigned ${id} · ${appointmentWindow.value} · ${targetRow.truck} · ${newAppointment.area}` });
    appendScheduleHistory({ type: 'Verified', jk: id, change: `Prototype read-back verified JK number, booking window, customer, and service address` });
    if (possibleDuplicateBookings.length > 0 && duplicateOverrideReason.trim()) appendScheduleHistory({ type: 'Verified', jk: id, change: `Possible duplicate reviewed · Override reason: ${duplicateOverrideReason.trim()}` });
    setAppointmentCreationReceipt({
      appointmentId: id,
      day: scheduleDay,
      customerDelivery: 'not-sent',
      crewDelivery: 'not-sent',
      callAheadRequired: /call[ -]?ahead/i.test(newAppointment.notes),
    });
    setScheduleView('board');
    resetScheduleSelection();
    setNewAppointmentOpen(false);
    openRecordDrawer({
      appointmentId: id,
      kicker: 'Appointment · Created and Confirmed',
      title: id,
      summary: `${newAppointment.customer.trim()} · ${newAppointment.area}`,
      action: 'Open appointment',
      source: 'Simulated JunkWare read-back',
      updated: 'Just now',
      facts: [{ label: 'Status', value: createdJob.state }, { label: 'Window', value: createdJob.time }, { label: 'Estimated Volume', value: `${newAppointment.loadPickups} pickup equivalent${newAppointment.loadPickups === 1 ? '' : 's'} · ${estimatedLoadPercent}% truck` }, { label: 'Load Type', value: newAppointment.loadStream === 'metal' ? 'Metal-heavy' : newAppointment.loadStream === 'donation' ? 'Donation / resale' : 'Mixed material' }],
    });
  };
  const waitForPrototypeJunkWare = (milliseconds: number) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
  const sendCreatedAppointmentMessage = async (recipient: 'customer' | 'crew') => {
    if (!activeAppointment || !activeCreationReceipt) return;
    if (recipient === 'crew' && activeAppointment.truck === 'Unassigned') {
      setActionFeedback('Assign a truck and Krewe before sending the crew notification.');
      return;
    }
    const field = recipient === 'customer' ? 'customerDelivery' : 'crewDelivery';
    if (activeCreationReceipt[field] !== 'not-sent') return;
    const runId = appointmentDeliveryRunRef.current[recipient] + 1;
    appointmentDeliveryRunRef.current[recipient] = runId;
    setActionFeedback('');
    setAppointmentCreationReceipt((receipt) => receipt && receipt.appointmentId === activeAppointment.jk
      ? { ...receipt, [field]: 'sending' }
      : receipt);
    await waitForPrototypeJunkWare(750);
    if (appointmentDeliveryRunRef.current[recipient] !== runId) return;
    setAppointmentCreationReceipt((receipt) => receipt && receipt.appointmentId === activeAppointment.jk
      ? { ...receipt, [field]: 'delivered' }
      : receipt);
    appendScheduleHistory({
      type: 'Verified',
      jk: activeAppointment.jk,
      change: recipient === 'customer'
        ? `Prototype customer confirmation delivered · ${activeAppointment.details.phone}`
        : `Prototype crew notification delivered · ${activeAppointment.truck} · ${activeAppointment.crew}`,
    });
    setActionFeedback(recipient === 'customer'
      ? `Customer confirmation for ${activeAppointment.jk} is marked delivered in this prototype.`
      : `Crew notification for ${activeAppointment.jk} is marked delivered in this prototype.`);
  };
  const showCreatedAppointmentOnSchedule = () => {
    if (!activeAppointment || !activeCreationReceipt) return;
    setDrawer(null);
    setActiveNav('Schedule');
    setScheduleDay(activeCreationReceipt.day);
    setOperatingDate(activeCreationReceipt.day === 'today' ? '2026-08-31' : '2026-09-01');
    setCalendarDateDraft(activeCreationReceipt.day === 'today' ? '2026-08-31' : '2026-09-01');
    setScheduleView('board');
    resetScheduleSelection();
    setRouteFocusAppointmentId(activeAppointment.jk);
  };
  const beginJunkWareCreation = async (simulateUncertain = false) => {
    if (!newAppointmentReviewReady) {
      setNewAppointmentError('Review the current appointment details before creating it.');
      return;
    }
    const error = validateNewAppointmentDraft();
    if (error) {
      setNewAppointmentError(error);
      return;
    }
    const runId = junkWareCreationRunRef.current + 1;
    junkWareCreationRunRef.current = runId;
    setNewAppointmentError('');
    setJunkWareCreationJk('');
    setJunkWareCreationState('creating');
    await waitForPrototypeJunkWare(650);
    if (junkWareCreationRunRef.current !== runId) return;
    setJunkWareCreationState('verifying');
    await waitForPrototypeJunkWare(800);
    if (junkWareCreationRunRef.current !== runId) return;
    if (simulateUncertain) {
      setJunkWareCreationState('uncertain');
      return;
    }
    const returnedJk = nextPrototypeJunkWareId;
    setJunkWareCreationJk(returnedJk);
    setJunkWareCreationState('created');
    await waitForPrototypeJunkWare(700);
    if (junkWareCreationRunRef.current !== runId) return;
    commitCreatedAppointment(returnedJk);
  };
  const searchJunkWareBeforeRetry = async () => {
    if (junkWareCreationState !== 'uncertain') return;
    const runId = junkWareCreationRunRef.current + 1;
    junkWareCreationRunRef.current = runId;
    setJunkWareCreationState('searching');
    await waitForPrototypeJunkWare(950);
    if (junkWareCreationRunRef.current !== runId) return;
    setJunkWareCreationState('safe-retry');
  };
  const buildScheduleMoveProposal = (appointmentId: string, targetTruck: string, requestedStart: number): PendingScheduleMove | null => {
    const sourceRow = scheduleRows.find((row) => row.jobs.some((job) => job.jk === appointmentId));
    const targetRow = scheduleRows.find((row) => row.truck === targetTruck);
    const movingJob = sourceRow?.jobs.find((job) => job.jk === appointmentId);
    if (!sourceRow || !targetRow || !movingJob || movingJob.jk === 'Open capacity' || isFinalAppointmentState(movingJob.state)) return null;
    const targetStart = Math.min(requestedStart, 9 - movingJob.duration);
    const targetWindow = scheduleWindowOptions.find((option) => option.start === targetStart && option.duration === movingJob.duration);
    if (!targetWindow || (sourceRow.truck === targetTruck && movingJob.start === targetStart)) return null;
    const targetEnd = targetStart + movingJob.duration;
    const targetJobs = targetRow.jobs.filter((job) => job.jk !== movingJob.jk && job.jk !== 'Open capacity');
    const conflicts = targetJobs.filter((job) => job.start < targetEnd && job.start + job.duration > targetStart);
    const simulatedJob = { ...movingJob, start: targetStart, time: targetWindow.value };
    const simulatedRoute = [...targetJobs, simulatedJob].sort((a, b) => a.start - b.start);
    const movedIndex = simulatedRoute.findIndex((job) => job.jk === movingJob.jk);
    const previous = movedIndex > 0 ? simulatedRoute[movedIndex - 1] : undefined;
    const next = movedIndex < simulatedRoute.length - 1 ? simulatedRoute[movedIndex + 1] : undefined;
    const routeSegments: ScheduleMoveSegment[] = [];
    if (targetTruck !== 'Unassigned' && previous) {
      const estimate = routeEstimate(previous.area, simulatedJob.area);
      const buffer = ((simulatedJob.start - (previous.start + previous.duration)) * 60) - estimate.minutes;
      routeSegments.push({ label: `${previous.jk} → ${simulatedJob.jk}`, ...estimate, buffer, tone: routeToneForBuffer(buffer) });
    }
    if (targetTruck !== 'Unassigned' && next) {
      const estimate = routeEstimate(simulatedJob.area, next.area);
      const buffer = ((next.start - (simulatedJob.start + simulatedJob.duration)) * 60) - estimate.minutes;
      routeSegments.push({ label: `${simulatedJob.jk} → ${next.jk}`, ...estimate, buffer, tone: routeToneForBuffer(buffer) });
    }
    return {
      appointmentId, sourceTruck: sourceRow.truck, targetTruck, sourceTime: movingJob.time,
      targetTime: targetWindow.value, targetStart, duration: movingJob.duration,
      conflictIds: conflicts.map((job) => job.jk), routeSegments,
    };
  };
  const scheduleDropTargetFromPoint = (clientX: number, clientY: number) => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.schedule-truck-row[data-schedule-truck]'));
    const row = rows.find((candidate) => {
      const bounds = candidate.getBoundingClientRect();
      return clientY >= bounds.top && clientY <= bounds.bottom;
    });
    if (!row) return null;
    const bounds = row.getBoundingClientRect();
    const routeColumnWidth = Math.min(88, bounds.width * .32);
    const timelineLeft = bounds.left + routeColumnWidth;
    if (clientX < timelineLeft || clientX > bounds.right) return null;
    const slotWidth = (bounds.width - routeColumnWidth) / 9;
    const slot = Math.max(0, Math.min(8, Math.floor((clientX - timelineLeft) / slotWidth)));
    return { truck: row.dataset.scheduleTruck || '', slot };
  };
  const beginSchedulePointerDrag = (event: ReactPointerEvent<HTMLElement>, appointmentId: string) => {
    if (event.button !== 0) return;
    if (scheduleChangeBlocking) {
      setActionFeedback(`Resolve the ${scheduleChangeReceipt?.appointmentId} schedule change before moving another appointment.`);
      return;
    }
    const movingJob = scheduleRows.flatMap((row) => row.jobs).find((job) => job.jk === appointmentId);
    if (!movingJob || movingJob.jk === 'Open capacity' || isFinalAppointmentState(movingJob.state)) return;
    event.preventDefault();
    schedulePointerCleanupRef.current?.();
    const drag: SchedulePointerDrag = { appointmentId, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, active: false };
    schedulePointerDragRef.current = drag;
    setRouteFocusAppointmentId(appointmentId);
    setPendingScheduleMove(null);
    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleCancel);
      schedulePointerCleanupRef.current = null;
    };
    const handleMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== drag.pointerId) return;
      if (!drag.active && Math.hypot(moveEvent.clientX - drag.startX, moveEvent.clientY - drag.startY) >= 5) {
        drag.active = true;
        setDraggedAppointmentId(drag.appointmentId);
      }
      if (!drag.active) return;
      moveEvent.preventDefault();
      const target = scheduleDropTargetFromPoint(moveEvent.clientX, moveEvent.clientY);
      const proposal = target ? buildScheduleMoveProposal(drag.appointmentId, target.truck, target.slot) : null;
      setDragPreview((current) => current?.appointmentId === proposal?.appointmentId
        && current?.targetTruck === proposal?.targetTruck && current?.targetStart === proposal?.targetStart
        ? current : proposal);
    };
    const handleUp = (upEvent: PointerEvent) => {
      if (upEvent.pointerId !== drag.pointerId) return;
      const target = drag.active ? scheduleDropTargetFromPoint(upEvent.clientX, upEvent.clientY) : null;
      const proposal = target ? buildScheduleMoveProposal(drag.appointmentId, target.truck, target.slot) : null;
      cleanup();
      schedulePointerDragRef.current = null;
      setDraggedAppointmentId(null);
      setDragPreview(null);
      if (!drag.active) return;
      upEvent.preventDefault();
      if (!proposal) {
        setActionFeedback(target ? 'That appointment is already in this truck and time slot.' : 'Drop the appointment inside a truck’s timeline.');
        return;
      }
      setPendingScheduleMove(proposal);
    };
    const handleCancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId !== drag.pointerId) return;
      cleanup();
      schedulePointerDragRef.current = null;
      setDraggedAppointmentId(null);
      setDragPreview(null);
    };
    schedulePointerCleanupRef.current = cleanup;
    window.addEventListener('pointermove', handleMove, { passive: false });
    window.addEventListener('pointerup', handleUp, { passive: false });
    window.addEventListener('pointercancel', handleCancel);
  };
  const syncScheduleMoveToJunkWare = async (receipt: ScheduleChangeReceipt, simulateUncertain = false) => {
    const runId = scheduleChangeSyncRunRef.current + 1;
    scheduleChangeSyncRunRef.current = runId;
    setScheduleChangeReceipt((current) => current?.id === receipt.id ? { ...current, syncState: 'writing', sourceVerifiedAt: undefined } : current);
    setActionFeedback(`${receipt.appointmentId} is being written to the prototype JunkWare schedule.`);
    await waitForPrototypeJunkWare(550);
    if (scheduleChangeSyncRunRef.current !== runId) return;
    setScheduleChangeReceipt((current) => current?.id === receipt.id ? { ...current, syncState: 'verifying' } : current);
    setActionFeedback(`Reading ${receipt.appointmentId} back from the prototype JunkWare schedule.`);
    await waitForPrototypeJunkWare(700);
    if (scheduleChangeSyncRunRef.current !== runId) return;
    if (simulateUncertain) {
      setScheduleChangeReceipt((current) => current?.id === receipt.id ? { ...current, syncState: 'uncertain' } : current);
      setActionFeedback(`${receipt.appointmentId} write outcome is uncertain. Search JunkWare before retrying or restore the previous plan.`);
      return;
    }
    const sourceVerifiedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setScheduleChangeReceipt((current) => current?.id === receipt.id ? { ...current, syncState: 'verified', sourceVerifiedAt } : current);
    if (receipt.kind === 'cancel') {
      appendScheduleHistory({ type: 'Cancelled', jk: receipt.appointmentId, change: `${receipt.targetTime} · ${receipt.nextJob.cancellationReason}` }, receipt.day);
    } else {
      if (receipt.sourceTruck !== receipt.targetTruck) appendScheduleHistory({ type: 'Reassigned', jk: receipt.appointmentId, change: `${receipt.sourceTruck} → ${receipt.targetTruck}` }, receipt.day);
      if (receipt.sourceTime !== receipt.targetTime) appendScheduleHistory({ type: 'Rescheduled', jk: receipt.appointmentId, change: `${receipt.sourceTime} → ${receipt.targetTime}` }, receipt.day);
      const operatingChanges = receipt.changes.filter((change) => !change.startsWith('Truck ·') && !change.startsWith('Window ·'));
      if (operatingChanges.length) appendScheduleHistory({ type: 'Status', jk: receipt.appointmentId, change: operatingChanges.join(' · ') }, receipt.day);
    }
    appendScheduleHistory({
      type: 'Verified',
      jk: receipt.appointmentId,
      change: `Prototype JunkWare read-back verified ${receipt.targetTruck} · ${receipt.targetTime} · ${receipt.changes.join(' · ')}`,
    }, receipt.day);
    const followup = [receipt.requiresCustomerConfirmation ? 'customer confirmation' : '', receipt.requiresCrewNotification ? 'crew notification' : ''].filter(Boolean).join(' and ');
    setActionFeedback(`${receipt.appointmentId} is verified in the prototype JunkWare schedule.${followup ? ` Complete ${followup}.` : ' No communication follow-up is required.'}`);
  };
  const commitScheduleMove = (simulateUncertain = false) => {
    if (!pendingScheduleMove || scheduleChangeBlocking) return;
    const movingJob = scheduleRows.flatMap((row) => row.jobs).find((job) => job.jk === pendingScheduleMove.appointmentId);
    const targetRow = scheduleRows.find((row) => row.truck === pendingScheduleMove.targetTruck);
    if (!movingJob || !targetRow) return;
    const targetEnd = pendingScheduleMove.targetStart + pendingScheduleMove.duration;
    const removedOpenCapacity = targetRow.jobs.filter((job) => (
      job.jk === 'Open capacity'
      && job.start < targetEnd
      && job.start + job.duration > pendingScheduleMove.targetStart
    ));
    const nextState = pendingScheduleMove.targetTruck === 'Unassigned'
      ? 'Assign truck' : movingJob.state === 'Assign truck' ? 'Confirmed' : movingJob.state;
    const movedJob = {
      ...movingJob, start: pendingScheduleMove.targetStart, duration: pendingScheduleMove.duration,
      time: pendingScheduleMove.targetTime, state: nextState,
    };
    setScheduleRows((rows) => rows.map((row) => ({
      ...row,
      jobs: row.truck === pendingScheduleMove.targetTruck
        ? [...row.jobs.filter((job) => job.jk !== movingJob.jk && !(job.jk === 'Open capacity' && job.start < targetEnd && job.start + job.duration > pendingScheduleMove.targetStart)), movedJob].sort((a, b) => a.start - b.start)
        : row.jobs.filter((job) => job.jk !== movingJob.jk),
    })));
    const changes = [
      pendingScheduleMove.sourceTruck !== pendingScheduleMove.targetTruck ? `Truck · ${pendingScheduleMove.sourceTruck} → ${pendingScheduleMove.targetTruck}` : '',
      pendingScheduleMove.sourceTime !== pendingScheduleMove.targetTime ? `Window · ${pendingScheduleMove.sourceTime} → ${pendingScheduleMove.targetTime}` : '',
    ].filter(Boolean);
    appendScheduleHistory({ type: 'Status', jk: movingJob.jk, change: `Change submitted for source verification · ${changes.join(' · ')}` });
    const nextReceipt: ScheduleChangeReceipt = {
      id: `SCR-${Date.now()}`,
      day: scheduleDay,
      appointmentId: movingJob.jk,
      customer: movingJob.customer,
      sourceTruck: pendingScheduleMove.sourceTruck,
      targetTruck: pendingScheduleMove.targetTruck,
      sourceTime: pendingScheduleMove.sourceTime,
      targetTime: pendingScheduleMove.targetTime,
      previousJob: { ...movingJob },
      nextJob: { ...movedJob },
      removedOpenCapacity,
      kind: 'move',
      changes,
      requiresCustomerConfirmation: pendingScheduleMove.sourceTime !== pendingScheduleMove.targetTime,
      requiresCrewNotification: pendingScheduleMove.sourceTruck !== pendingScheduleMove.targetTruck || pendingScheduleMove.sourceTime !== pendingScheduleMove.targetTime,
      customerConfirmed: false,
      crewNotified: false,
      undone: false,
      syncState: 'writing',
    };
    setScheduleChangeReceipt(nextReceipt);
    setRouteFocusAppointmentId(movingJob.jk);
    setPendingScheduleMove(null);
    void syncScheduleMoveToJunkWare(nextReceipt, simulateUncertain);
  };
  const searchScheduleMoveInJunkWare = async () => {
    const receipt = scheduleChangeReceipt;
    if (!receipt || receipt.undone || receipt.syncState !== 'uncertain') return;
    const runId = scheduleChangeSyncRunRef.current + 1;
    scheduleChangeSyncRunRef.current = runId;
    setScheduleChangeReceipt({ ...receipt, syncState: 'searching' });
    setActionFeedback(`Searching JunkWare for ${receipt.appointmentId} and the complete proposed appointment state.`);
    await waitForPrototypeJunkWare(850);
    if (scheduleChangeSyncRunRef.current !== runId) return;
    setScheduleChangeReceipt((current) => current?.id === receipt.id ? { ...current, syncState: 'safe-retry' } : current);
    setActionFeedback(`No matching JunkWare appointment update was found for ${receipt.appointmentId}. One controlled retry is now available.`);
  };
  const retryScheduleMoveSync = () => {
    const receipt = scheduleChangeReceipt;
    if (!receipt || receipt.undone || receipt.syncState !== 'safe-retry') return;
    void syncScheduleMoveToJunkWare(receipt);
  };
  const applyAppointmentChangeDraft = (simulateUncertain = false) => {
    if (!activeAppointment) return;
    if (scheduleChangeBlocking) {
      setActionFeedback(`Resolve the ${scheduleChangeReceipt?.appointmentId} schedule change before applying another edit.`);
      return;
    }
    if (isFinalAppointmentState(activeAppointment.state)) {
      setActionFeedback(`${activeAppointment.jk} is in a final state and cannot be changed from this schedule control.`);
      return;
    }
    if (!appointmentChangeDraftChanges.length) {
      setActionFeedback('No appointment changes are ready to apply.');
      return;
    }
    const cancellationReason = appointmentChangeDraft.cancellationReason.trim();
    if (appointmentChangeDraft.cancel && cancellationReason.length < 8) {
      setActionFeedback('Enter a specific cancellation reason of at least 8 characters.');
      return;
    }
    const sourceRow = scheduleRows.find((row) => row.truck === activeAppointment.truck);
    const movingJob = sourceRow?.jobs.find((job) => job.jk === activeAppointment.jk);
    const targetTruck = appointmentChangeDraft.cancel ? activeAppointment.truck : appointmentChangeDraft.truck;
    const targetTime = appointmentChangeDraft.cancel ? activeAppointment.time : appointmentChangeDraft.time;
    const targetRow = scheduleRows.find((row) => row.truck === targetTruck);
    const targetWindow = scheduleWindowOptions.find((option) => option.value === targetTime);
    if (!movingJob || !sourceRow || !targetRow || !targetWindow) {
      setActionFeedback('Choose a valid truck and appointment window before applying the change.');
      return;
    }
    const targetFleetTruck = fleetTruckRows.find((truck) => truck.label === targetTruck);
    if (!appointmentChangeDraft.cancel && targetFleetTruck?.readiness === 'Out of service') {
      setActionFeedback(`${targetFleetTruck.label} is out of service and cannot receive this appointment.`);
      return;
    }
    const targetEnd = targetWindow.start + targetWindow.duration;
    const removedOpenCapacity = appointmentChangeDraft.cancel ? [] : targetRow.jobs.filter((job) => (
      job.jk === 'Open capacity'
      && job.start < targetEnd
      && job.start + job.duration > targetWindow.start
    ));
    let nextState = movingJob.state;
    if (appointmentChangeDraft.cancel) nextState = 'Canceled';
    else if (targetTruck === 'Unassigned') nextState = 'Assign truck';
    else if (appointmentChangeDraft.callAhead) nextState = 'Call ahead';
    else if (movingJob.state === 'Call ahead' || movingJob.state === 'Assign truck') nextState = 'Confirmed';
    const nextJob: ScheduleJob = {
      ...movingJob,
      start: targetWindow.start,
      duration: targetWindow.duration,
      time: targetWindow.value,
      state: nextState,
      addressVerified: appointmentChangeDraft.addressVerified,
      cancellationReason: appointmentChangeDraft.cancel ? cancellationReason : undefined,
    };
    setScheduleRows((rows) => rows.map((row) => ({
      ...row,
      jobs: row.truck === targetTruck
        ? [...row.jobs.filter((job) => job.jk !== movingJob.jk && !(job.jk === 'Open capacity' && !appointmentChangeDraft.cancel && job.start < targetEnd && job.start + job.duration > targetWindow.start)), nextJob].sort((a, b) => a.start - b.start)
        : row.jobs.filter((job) => job.jk !== movingJob.jk),
    })));
    const truckChanged = activeAppointment.truck !== targetTruck;
    const timeChanged = activeAppointment.time !== targetTime;
    const callAheadChanged = appointmentChangeDraft.callAhead !== (activeAppointment.state === 'Call ahead');
    const nextReceipt: ScheduleChangeReceipt = {
      id: `SCR-${Date.now()}`,
      day: scheduleDay,
      appointmentId: activeAppointment.jk,
      customer: activeAppointment.customer,
      sourceTruck: activeAppointment.truck,
      targetTruck,
      sourceTime: activeAppointment.time,
      targetTime,
      previousJob: { ...movingJob },
      nextJob,
      removedOpenCapacity,
      kind: appointmentChangeDraft.cancel ? 'cancel' : truckChanged || timeChanged ? 'move' : 'edit',
      changes: [...appointmentChangeDraftChanges],
      requiresCustomerConfirmation: appointmentChangeDraft.cancel || timeChanged || callAheadChanged,
      requiresCrewNotification: appointmentChangeDraft.cancel || truckChanged || timeChanged || callAheadChanged,
      customerConfirmed: false,
      crewNotified: false,
      undone: false,
      syncState: 'writing',
    };
    appendScheduleHistory({ type: 'Status', jk: activeAppointment.jk, change: `Change submitted for source verification · ${appointmentChangeDraftChanges.join(' · ')}` });
    setScheduleChangeReceipt(nextReceipt);
    setRouteFocusAppointmentId(activeAppointment.jk);
    setScheduleView('board');
    setDrawer(null);
    void syncScheduleMoveToJunkWare(nextReceipt, simulateUncertain);
  };
  const completeAppointmentCloseout = () => {
    if (!activeAppointment || isFinalAppointmentState(activeAppointment.state)) return;
    const originalCategory: AppointmentCategory = activeAppointment.kind === 'Estimate' ? 'Estimate' : 'Job';
    const finalCategory: AppointmentCategory = originalCategory === 'Job' ? 'Job' : appointmentCloseoutDraft.category;
    const amount = parseMoneyValue(appointmentCloseoutDraft.amount);
    const notes = appointmentCloseoutDraft.notes.trim();
    if (!Number.isFinite(amount) || amount <= 0) {
      setAppointmentCloseoutError(`Enter the ${finalCategory === 'Job' ? 'final job total' : 'quoted amount'} before closing this appointment.`);
      return;
    }
    if (finalCategory === 'Job' && !appointmentCloseoutDraft.paymentMethod) {
      setAppointmentCloseoutError('Select how payment was recorded before completing this Job.');
      return;
    }
    if (finalCategory === 'Estimate' && appointmentCloseoutDraft.estimateOutcome === 'Follow-Up Required' && !appointmentCloseoutDraft.followUpDate) {
      setAppointmentCloseoutError('Choose a follow-up date before closing this Estimate.');
      return;
    }
    if (notes.length < 8) {
      setAppointmentCloseoutError('Add a specific closeout note of at least 8 characters.');
      return;
    }
    const finalState: AppointmentCloseoutReceipt['finalState'] = finalCategory === 'Job' ? 'Completed' : 'Estimate Closed';
    const recordedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const receipt: AppointmentCloseoutReceipt = {
      appointmentId: activeAppointment.jk,
      day: scheduleDay,
      originalCategory,
      finalCategory,
      previousState: activeAppointment.state,
      finalState,
      amount,
      paymentMethod: finalCategory === 'Job' ? appointmentCloseoutDraft.paymentMethod : undefined,
      estimateOutcome: finalCategory === 'Estimate' ? appointmentCloseoutDraft.estimateOutcome : undefined,
      followUpDate: finalCategory === 'Estimate' && appointmentCloseoutDraft.followUpDate ? appointmentCloseoutDraft.followUpDate : undefined,
      notes,
      recordedAt,
    };
    setScheduleRowsByDay((plans) => ({
      ...plans,
      [scheduleDay]: plans[scheduleDay].map((row) => ({
        ...row,
        jobs: row.jobs.map((job) => job.jk === activeAppointment.jk ? {
          ...job,
          kind: finalCategory,
          state: finalState,
          details: {
            ...activeAppointment.details,
            value: moneyValue(amount),
            notes,
          },
        } : job),
      })),
    }));
    setAppointmentCloseoutReceipts((receipts) => ({ ...receipts, [activeAppointment.jk]: receipt }));
    if (finalCategory === 'Estimate' && appointmentCloseoutDraft.estimateOutcome === 'Follow-Up Required') {
      const actionId = `AQ-EST-${Date.now()}`;
      setActionQueue((items) => [{
        id: actionId,
        workspace: 'Schedule',
        priority: 'warning',
        title: `Follow Up on ${activeAppointment.jk}`,
        detail: `${activeAppointment.customer} · Estimate closed with follow-up required.`,
        record: activeAppointment.jk,
        owner: 'Dispatch',
        due: appointmentCloseoutDraft.followUpDate,
        source: 'OpsCenter prototype closeout',
        action: 'Open estimate',
        status: 'Open',
        note: notes,
        escalated: false,
        recommendation: 'Contact the customer and record whether a separate Job appointment should be created.',
        approval: 'Not required',
        verification: `Customer disposition is recorded against ${activeAppointment.jk}.`,
        refId: activeAppointment.jk,
      }, ...items]);
    }
    appendScheduleHistory({
      type: 'Status',
      jk: activeAppointment.jk,
      change: originalCategory === finalCategory
        ? `${finalCategory} closeout recorded in prototype · ${finalState}`
        : `Appointment category explicitly changed · ${originalCategory} → ${finalCategory} · ${finalState}`,
    });
    setAppointmentCloseoutError('');
    setAppointmentCloseoutOpen(false);
    setActionFeedback(`${activeAppointment.jk} was closed in this prototype as ${finalCategory}. JunkWare and downstream accounting sources were not changed.`);
  };
  const recordScheduleChangeFollowup = (kind: 'customer' | 'crew') => {
    if (!scheduleChangeReceipt || scheduleChangeReceipt.undone || scheduleChangeReceipt.syncState !== 'verified') return;
    if (kind === 'customer' && scheduleChangeReceipt.requiresCustomerConfirmation && !scheduleChangeReceipt.customerConfirmed) {
      setScheduleChangeReceipt((receipt) => receipt ? { ...receipt, customerConfirmed: true } : receipt);
      appendScheduleHistory({
        type: 'Status',
        jk: scheduleChangeReceipt.appointmentId,
        change: 'Customer confirmation recorded for verified appointment change',
      }, scheduleChangeReceipt.day);
      setActionFeedback(`${scheduleChangeReceipt.appointmentId} customer confirmation recorded.`);
    }
    if (kind === 'crew' && scheduleChangeReceipt.requiresCrewNotification && !scheduleChangeReceipt.crewNotified) {
      setScheduleChangeReceipt((receipt) => receipt ? { ...receipt, crewNotified: true } : receipt);
      appendScheduleHistory({
        type: 'Status',
        jk: scheduleChangeReceipt.appointmentId,
        change: `Crew notification recorded · ${scheduleChangeReceipt.targetTruck}`,
      }, scheduleChangeReceipt.day);
      setActionFeedback(`${scheduleChangeReceipt.appointmentId} crew notification recorded.`);
    }
  };
  const undoScheduleMove = () => {
    const receipt = scheduleChangeReceipt;
    if (!receipt || receipt.undone || receipt.day !== scheduleDay || !['uncertain', 'safe-retry'].includes(receipt.syncState)) return;
    scheduleChangeSyncRunRef.current += 1;
    setScheduleRowsByDay((plans) => ({ ...plans, [receipt.day]: plans[receipt.day].map((row) => {
      let jobs = row.jobs.filter((job) => job.jk !== receipt.appointmentId);
      if (row.truck === receipt.sourceTruck) jobs = [...jobs, { ...receipt.previousJob }];
      if (row.truck === receipt.targetTruck) {
        receipt.removedOpenCapacity.forEach((capacity) => {
          const exists = jobs.some((job) => (
            job.jk === 'Open capacity'
            && job.start === capacity.start
            && job.duration === capacity.duration
          ));
          if (!exists) jobs.push({ ...capacity });
        });
      }
      return { ...row, jobs: jobs.sort((a, b) => a.start - b.start) };
    }) }));
    appendScheduleHistory({
      type: 'Status',
      jk: receipt.appointmentId,
      change: `Unverified appointment change restored · ${receipt.changes.join(' · ')}`,
    }, receipt.day);
    setRouteFocusAppointmentId(receipt.appointmentId);
    setScheduleChangeReceipt({ ...receipt, undone: true });
    setActionFeedback(`${receipt.appointmentId} restored to ${receipt.sourceTruck} at ${receipt.sourceTime}.`);
  };
  const markFollowupHandled = (followupId: string) => {
    setHandledFollowups((handled) => handled.includes(followupId) ? handled : [...handled, followupId]);
    const followup = scheduleFollowups.find((item) => item.jk === followupId);
    logAudit({ workspace: 'Schedule', action: 'Follow-up completed', record: followupId, summary: followup?.next || 'Schedule follow-up completed.', previous: 'Open', next: 'Handled', source: 'OpsCenter', result: 'Completed', refId: followupId });
    setDrawer(null);
  };
  const assignKreweMember = (memberId: string, truck: string) => {
    const member = kreweMembers.find((item) => item.id === memberId);
    setKreweMembers((members) => members.map((member) => {
      if (member.id !== memberId) return member;
      const issue = truck === 'Unassigned'
        ? 'Clocked in but not assigned to a truck.'
        : member.status === 'Missing clock-in' ? member.issue : undefined;
      return { ...member, truck, territory: truckTerritory[truck] || '—', issue };
    }));
    if (member) logAudit({ workspace: 'Krewe', action: 'Truck assignment updated', record: member.name, summary: 'Today’s crew coverage changed.', previous: `${member.truck} · ${member.territory}`, next: `${truck} · ${truckTerritory[truck] || 'No territory'}`, source: 'OpsCenter', result: truck === 'Unassigned' ? 'Needs review' : 'Completed', refId: member.id });
    setActionFeedback(`${truck === 'Unassigned' ? 'Assignment cleared' : `Assigned to ${truck}`}. Krewe coverage is updated.`);
  };
  const openKreweMember = (member: KreweMember) => {
    setTimeCorrection({ clockIn: timeLabelToInput(member.clockIn), clockOut: timeLabelToInput(member.clockOut), reason: member.issue ? 'Correct missing time record' : '' });
    setBonusEntry({ amount: '', reason: '' });
    openRecordDrawer({
      kreweId: member.id,
      kicker: `Krewe · ${member.status}`,
      title: member.name,
      summary: `${member.role} · ${member.truck}`,
      action: 'Save correction',
      source: 'JunkWare attendance + OpsCenter',
      updated: 'Live',
      facts: [
        { label: 'Role', value: member.role }, { label: 'Status', value: member.status },
        { label: 'Truck', value: member.truck }, { label: 'Territory', value: member.territory },
        { label: 'Jobs', value: member.jobs == null ? '—' : String(member.jobs) }, { label: 'Credited revenue', value: moneyValue(member.revenue) },
      ],
    });
  };
  const saveKreweCorrection = () => {
    if (!activeKrewe) return;
    if (!timeCorrection.clockIn || !timeCorrection.reason.trim()) {
      setActionFeedback('Clock-in time and a correction reason are required.');
      return;
    }
    setKreweMembers((members) => members.map((member) => {
      if (member.id !== activeKrewe.id) return member;
      const hours = workedHoursFromCorrection(timeCorrection.clockIn, timeCorrection.clockOut);
      const regularPay = hours != null && member.hourlyRate != null ? Math.round(hours * member.hourlyRate * 100) / 100 : member.regularPay;
      const totalPay = regularPay == null ? member.totalPay : regularPay + (member.overtimeAdditional || 0) + (member.tips || 0) + (member.revenueBonus || 0) + (member.manualBonus || 0) + (member.supplementalPay || 0);
      return {
        ...member,
        clockIn: timeInputToLabel(timeCorrection.clockIn),
        clockOut: timeInputToLabel(timeCorrection.clockOut),
        status: 'Clocked in',
        hours,
        regularPay,
        totalPay,
        issue: member.truck === 'Unassigned' ? 'Clocked in but not assigned to a truck.' : undefined,
      };
    }));
    logAudit({ workspace: 'Krewe', action: 'Time correction saved', record: activeKrewe.name, summary: timeCorrection.reason.trim(), previous: `${activeKrewe.clockIn}–${activeKrewe.clockOut}`, next: `${timeInputToLabel(timeCorrection.clockIn)}–${timeInputToLabel(timeCorrection.clockOut)}`, source: 'JunkWare attendance + OpsCenter', result: 'Completed', refId: activeKrewe.id });
    setActionQueue((items) => items.filter((item) => item.refId !== activeKrewe.id));
    setActionFeedback(`Time correction saved for ${activeKrewe.name}. The manager reason remains in the audit trail.`);
  };
  const addKreweBonus = () => {
    if (!activeKrewe) return;
    const amount = Number(bonusEntry.amount);
    if (!Number.isFinite(amount) || amount <= 0 || !bonusEntry.reason.trim()) {
      setActionFeedback('Enter a bonus amount and a manager reason.');
      return;
    }
    setKreweMembers((members) => members.map((member) => member.id === activeKrewe.id ? {
      ...member,
      manualBonus: (member.manualBonus || 0) + amount,
      totalPay: member.totalPay == null ? null : member.totalPay + amount,
      period: { ...member.period, bonuses: member.period.bonuses + amount, manualBonuses: member.period.manualBonuses + amount, totalPay: member.period.totalPay + amount },
      month: { ...member.month, bonuses: member.month.bonuses + amount, manualBonuses: member.month.manualBonuses + amount, totalPay: member.month.totalPay + amount },
    } : member));
    logAudit({ workspace: 'Krewe', action: 'Manual bonus added', record: activeKrewe.name, summary: bonusEntry.reason.trim(), previous: moneyValue(activeKrewe.manualBonus || 0), next: moneyValue((activeKrewe.manualBonus || 0) + amount), source: 'OpsCenter manager entry', result: 'Completed', refId: activeKrewe.id });
    setBonusEntry({ amount: '', reason: '' });
    setActionFeedback(`${moneyValue(amount)} bonus added for ${activeKrewe.name}. The reason remains in the audit trail.`);
  };
  const updateCallInStatus = (memberId: string, status: CallInStatus) => {
    const candidate = callInCandidates.find((item) => item.memberId === memberId);
    const member = kreweMembers.find((item) => item.id === memberId);
    setCallInCandidates((candidates) => candidates.map((candidate) => candidate.memberId === memberId ? { ...candidate, status } : candidate));
    if (candidate && member) logAudit({ workspace: 'Krewe', action: 'Call-in plan updated', record: member.name, summary: candidate.reason, previous: candidate.status, next: status, source: 'OpsCenter staffing plan', result: status === 'Recommended' ? 'Needs review' : 'Completed', refId: memberId });
  };
  const openFleetTruck = (truck: FleetTruck) => {
    setFleetLoadDraft({ percent: String(truck.loadPercent), note: truck.loadNote, metal: truck.metalNote });
    openRecordDrawer({
      fleetTruckId: truck.id,
      kicker: `Truck Record · ${truck.readiness}`,
      title: truck.label,
      summary: `${truck.vehicle} · ${truck.operatingStatus}`,
      action: 'Save truck status',
      source: 'LinxUp + JunkWare Schedule + Fleet ledger',
      updated: truck.gpsFresh ? `${truck.gpsAge} ago` : `Position stale · ${truck.gpsAge}`,
      facts: [],
    });
  };
  const openFleetTruckByLabel = (truckLabel: string) => {
    const truck = fleetTruckRows.find((item) => item.label === truckLabel);
    if (!truck) return false;
    openFleetTruck(truck);
    return true;
  };
  const openTruckSchedule = () => {
    if (!activeFleetTruck) return;
    setActiveNav('Schedule');
    setScheduleDay('today');
    setOperatingDate('2026-08-31');
    setCalendarDateDraft('2026-08-31');
    setScheduleView('board');
    setScheduleStatusFilter('all');
    setScheduleScope('ALL');
    setDrawer(null);
  };
  const openTruckMaintenance = () => {
    setActiveNav('Fleet');
    setFleetView('maintenance');
    setFleetIssueFilter('active');
    setDrawer(null);
  };
  const openFleetIssue = (issue: FleetIssue) => {
    const truck = fleetTruckRows.find((item) => item.id === issue.truckId);
    setFleetIssueDraft({ status: issue.status, owner: issue.owner, due: issue.due, resolution: issue.resolution, cost: issue.cost == null ? '' : String(issue.cost), downtime: String(issue.downtime) });
    openRecordDrawer({
      fleetTruckId: issue.truckId,
      fleetIssueId: issue.id,
      kicker: `Repair · ${issue.severity}`,
      title: issue.title,
      summary: `${truck?.label || 'Fleet'} · ${issue.status}`,
      action: 'Save work order',
      source: 'Fleet repair queue',
      updated: issue.due ? `Due ${issue.due}` : 'No due date',
      facts: [],
    });
  };
  const saveFleetLoad = () => {
    if (!activeFleetTruck) return;
    const percent = Number(fleetLoadDraft.percent);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100 || !fleetLoadDraft.note.trim()) {
      setActionFeedback('Enter a load from 0–100% and a status note.');
      return;
    }
    setFleetTruckRows((trucks) => trucks.map((truck) => truck.id === activeFleetTruck.id ? { ...truck, loadPercent: percent, loadNote: fleetLoadDraft.note.trim(), metalNote: fleetLoadDraft.metal.trim() || 'Metal status not recorded' } : truck));
    logAudit({ workspace: 'Fleet', action: 'Truck load updated', record: activeFleetTruck.label, summary: fleetLoadDraft.note.trim(), previous: `${activeFleetTruck.loadPercent}% full`, next: `${percent}% full`, source: 'Fleet ledger', result: 'Completed', refId: activeFleetTruck.id });
    setActionFeedback(`${activeFleetTruck.label} load status updated. The operating ledger retains the dispatcher action.`);
  };
  const resetFleetLoad = () => {
    if (!activeFleetTruck) return;
    if (!fleetLoadDraft.note.trim()) {
      setActionFeedback('Add the verified dump or metal-yard source before recording a reset.');
      return;
    }
    setFleetTruckRows((trucks) => trucks.map((truck) => truck.id === activeFleetTruck.id ? { ...truck, loadPercent: 0, loadNote: `Reset · ${fleetLoadDraft.note.trim()}`, metalNote: fleetLoadDraft.metal.trim() || 'No metal remaining' } : truck));
    logAudit({ workspace: 'Fleet', action: 'Truck load reset', record: activeFleetTruck.label, summary: fleetLoadDraft.note.trim(), previous: `${activeFleetTruck.loadPercent}% full`, next: '0% · Empty', source: 'Verified dump or yard action', result: 'Completed', refId: activeFleetTruck.id });
    setFleetLoadDraft((draft) => ({ ...draft, percent: '0' }));
    setActionFeedback(`${activeFleetTruck.label} reset to empty from an explicit dispatcher action.`);
  };
  const completeFleetChecklist = (truckId: string) => {
    const truck = fleetTruckRows.find((item) => item.id === truckId);
    const hasActiveIssue = fleetIssues.some((issue) => issue.truckId === truckId && issue.status !== 'Resolved');
    setFleetTruckRows((trucks) => trucks.map((truck) => truck.id === truckId ? { ...truck, checklist: 'Complete', readiness: hasActiveIssue ? truck.readiness : 'Ready' } : truck));
    if (truck) logAudit({ workspace: 'Fleet', action: 'Checklist completed', record: truck.label, summary: 'Pre-route readiness checklist recorded.', previous: truck.checklist, next: 'Complete', source: 'Fleet checklist', result: hasActiveIssue ? 'Needs review' : 'Completed', refId: truck.id });
  };
  const saveFleetIssue = () => {
    if (!activeFleetIssue) return;
    if (fleetIssueDraft.status === 'Resolved' && !fleetIssueDraft.resolution.trim()) {
      setActionFeedback('Add a resolution note before closing the repair.');
      return;
    }
    const nextIssue: FleetIssue = {
      ...activeFleetIssue,
      status: fleetIssueDraft.status,
      owner: fleetIssueDraft.owner.trim(),
      due: fleetIssueDraft.due.trim(),
      resolution: fleetIssueDraft.resolution.trim(),
      cost: fleetIssueDraft.cost ? Number(fleetIssueDraft.cost) : null,
      downtime: fleetIssueDraft.downtime ? Number(fleetIssueDraft.downtime) : 0,
    };
    setFleetIssues((issues) => issues.map((issue) => issue.id === activeFleetIssue.id ? nextIssue : issue));
    const otherActive = fleetIssues.some((issue) => issue.truckId === activeFleetIssue.truckId && issue.id !== activeFleetIssue.id && issue.status !== 'Resolved');
    setFleetTruckRows((trucks) => trucks.map((truck) => {
      if (truck.id !== activeFleetIssue.truckId) return truck;
      if (nextIssue.status === 'Resolved' && !otherActive) return { ...truck, readiness: truck.checklist === 'Complete' ? 'Ready' : 'Attention', operatingStatus: truck.operatingStatus === 'Shop hold' ? 'Available' : truck.operatingStatus };
      if (nextIssue.status !== 'Resolved') return { ...truck, readiness: nextIssue.severity === 'Out of service' ? 'Out of service' : 'Attention' };
      return truck;
    }));
    logAudit({ workspace: 'Fleet', action: 'Work order updated', record: activeFleetIssue.title, summary: nextIssue.resolution || `Owner ${nextIssue.owner || 'unassigned'} · Due ${nextIssue.due || 'not set'}`, previous: `${activeFleetIssue.status} · ${activeFleetIssue.owner || 'No owner'} · ${moneyValue(activeFleetIssue.cost)}`, next: `${nextIssue.status} · ${nextIssue.owner || 'No owner'} · ${moneyValue(nextIssue.cost)}`, source: 'Fleet repair queue', result: nextIssue.status === 'Resolved' ? 'Completed' : 'Needs review', refId: activeFleetIssue.truckId });
    setActionFeedback(`${activeFleetIssue.title} updated. Status, owner, cost, downtime, and resolution remain together.`);
  };
  const scheduleFleetService = (truckId: string, serviceKey: string) => {
    const key = `${truckId}:${serviceKey}`;
    setScheduledServices((services) => services.includes(key) ? services : [...services, key]);
    const truck = fleetTruckRows.find((item) => item.id === truckId);
    if (truck) logAudit({ workspace: 'Fleet', action: 'Service scheduled', record: truck.label, summary: serviceKey, previous: 'Service due', next: 'Scheduled', source: 'Fleet service plan', result: 'Completed', refId: truckId });
  };
  const updateMarketingLeadStatus = (leadId: string, status: MarketingLeadStatus) => {
    const lead = marketingLeads.find((item) => item.id === leadId);
    if (!lead) return;
    setMarketingLeads((leads) => leads.map((item) => item.id === leadId ? {
      ...item,
      status,
      lastContact: status === 'Booked' ? 'Booked from OpsCenter' : status === 'Contacted' ? 'Outbound contact recorded just now' : item.lastContact,
    } : item));
    logAudit({ workspace: 'Marketing', action: 'Lead status updated', record: `${lead.customer} · ${lead.id}`, summary: lead.intent, previous: lead.status, next: status, source: lead.source, result: ['Lost', 'Needs follow-up'].includes(status) ? 'Needs review' : 'Completed', refId: lead.id });
    setActionFeedback(`${lead.customer} updated to ${status}. The recovery queue and marketing totals are reconciled.`);
  };
  const selectMarketingReviewAppointment = (reviewId: string, appointmentId: string) => {
    setMarketingReviews((reviews) => reviews.map((review) => review.id === reviewId ? { ...review, selectedAppointment: appointmentId } : review));
  };
  const confirmMarketingReview = (reviewId: string) => {
    const review = marketingReviews.find((item) => item.id === reviewId);
    if (!review) return;
    setMarketingReviews((reviews) => reviews.map((item) => item.id === reviewId ? { ...item, status: 'Attributed' } : item));
    logAudit({ workspace: 'Marketing', action: 'Review attribution confirmed', record: `${review.customer} · ${review.id}`, summary: 'Manager confirmed the Podium review match.', previous: 'Needs attribution', next: `Attributed · ${review.selectedAppointment}`, source: 'Podium + JunkWare', result: 'Completed', refId: review.id });
    setActionQueue((items) => items.filter((item) => item.refId !== review.id));
    setActionFeedback(`${review.customer} review attributed to ${review.selectedAppointment}. The explicit confirmation remains auditable.`);
  };
  const confirmFinanceAdjustment = (paymentId: string) => {
    const payment = financePayments.find((item) => item.id === paymentId);
    if (!payment) return;
    const adjustment = payment.jobTotal - payment.paymentAmount;
    setFinancePayments((payments) => payments.map((item) => item.id === paymentId ? {
      ...item,
      adjustment,
      status: 'Matched',
      note: adjustment ? `${moneyValue(adjustment)} closeout adjustment verified and reconciled.` : 'Exact payment match verified.',
    } : item));
    logAudit({ workspace: 'Finance', action: 'Payment adjustment confirmed', record: payment.id, summary: `${payment.customer} · ${payment.method}`, previous: `${moneyValue(payment.paymentAmount)} received · ${payment.status}`, next: `${moneyValue(payment.paymentAmount + adjustment)} reconciled · Matched`, source: 'JunkWare + QBO', result: 'Completed', refId: payment.id });
    setActionQueue((items) => items.filter((item) => item.refId !== payment.id));
    setActionFeedback(`${payment.id} reconciled. Payment, adjustment, and job total now balance.`);
  };
  const completeFinanceCloseStep = (stepId: string) => {
    const wasComplete = financeCloseSteps.includes(stepId);
    setFinanceCloseSteps((steps) => steps.includes(stepId) ? steps.filter((step) => step !== stepId) : [...steps, stepId]);
    logAudit({ workspace: 'Finance', action: 'Daily close checklist updated', record: stepId, summary: 'The close step was updated from its visible source records.', previous: wasComplete ? 'Completed' : 'Open', next: wasComplete ? 'Open' : 'Completed', source: 'OpsCenter daily close', result: wasComplete ? 'Needs review' : 'Completed', refId: stepId });
    setActionFeedback('Daily close checklist updated. Source records remain visible for audit.');
  };
  const progressFinanceRecoveryItem = (itemId: string) => {
    const recoveryItem = financeRecoveryItems.find((item) => item.id === itemId);
    if (!recoveryItem) return;
    const nextStatus: FinanceRecoveryStatus = recoveryItem.kind === 'Resale'
      ? ['Awaiting disposition', 'Held'].includes(recoveryItem.status) ? 'Listed' : recoveryItem.status === 'Listed' ? 'Sold' : recoveryItem.status
      : ['Awaiting yard', 'Ticket missing'].includes(recoveryItem.status) ? 'Submitted' : recoveryItem.status === 'Submitted' ? 'Paid' : recoveryItem.status;
    setFinanceRecoveryItems((items) => items.map((item) => {
      if (item.id !== itemId) return item;
      if (item.kind === 'Resale') {
        if (item.status === 'Awaiting disposition' || item.status === 'Held') return { ...item, status: 'Listed' };
        if (item.status === 'Listed') return { ...item, status: 'Sold', realizedValue: item.expectedValue };
        return item;
      }
      if (item.status === 'Awaiting yard' || item.status === 'Ticket missing') return { ...item, status: 'Submitted' };
      if (item.status === 'Submitted') return { ...item, status: 'Paid', realizedValue: item.expectedValue };
      return item;
    }));
    logAudit({ workspace: 'Finance', action: `${recoveryItem.kind} workflow advanced`, record: recoveryItem.id, summary: `${recoveryItem.item} · Source job ${recoveryItem.sourceJob}`, previous: recoveryItem.status, next: nextStatus, source: 'Truck record + Finance ledger', result: nextStatus === recoveryItem.status ? 'Needs review' : 'Completed', refId: recoveryItem.id });
    setActionFeedback(`${recoveryItem.item} advanced in the ${recoveryItem.kind === 'Resale' ? 'resale' : 'recycling'} workflow. Source job and custody remain attached.`);
  };
  const drawerFacts = activeAppointment ? [
    { label: 'Territory', value: `${territoryDesignators[activeAppointment.territory]} · ${activeAppointment.territory}` },
    { label: 'Area', value: `${activeAppointment.areaDesignator.code} · ${activeAppointment.areaDesignator.label}` },
    { label: 'Time', value: activeAppointment.time }, { label: 'Truck', value: activeAppointment.truck },
    { label: 'Crew', value: activeAppointment.crew }, { label: 'Customer', value: activeAppointment.customer },
    { label: 'Phone', value: activeAppointment.details.phone, href: `tel:${activeAppointment.details.phone.replace(/\D/g, '')}` },
    { label: 'Address', value: activeAppointment.details.address },
    { label: 'Work', value: activeAppointment.details.scope }, { label: 'Value', value: activeAppointment.details.value },
    { label: 'Status', value: activeAppointment.state },
    { label: 'Notes', value: activeAppointment.cancellationReason ? `Canceled · ${activeAppointment.cancellationReason}` : activeAppointment.details.notes },
  ] : activeKrewe ? [
    { label: 'Role', value: activeKrewe.role }, { label: 'Status', value: activeKrewe.status },
    { label: 'Truck', value: activeKrewe.truck }, { label: 'Territory', value: activeKrewe.territory },
    { label: 'Clock-in', value: activeKrewe.clockIn }, { label: 'Clock-out', value: activeKrewe.clockOut },
    { label: 'Jobs', value: activeKrewe.jobs == null ? '—' : String(activeKrewe.jobs) }, { label: 'Credited revenue', value: moneyValue(activeKrewe.revenue) },
  ] : drawer?.facts || [];

  const visibleWork = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return workItems.filter((item) => {
      if (!normalized) return true;
      const facts = item.facts.map((fact) => `${fact.label} ${fact.value}`).join(' ');
      return `${item.domain} ${item.source} ${item.title} ${item.detail} ${facts}`.toLowerCase().includes(normalized);
    });
  }, [query, workItems]);
  const activeAlerts = workItems.filter((item) => live ? !['resolved', 'acknowledged'].includes(liveAlert(item)?.workflowState || '') : !completed.includes(item.id) && !alertOutcomes[item.id]);
  const sourceAttentionCount = connectedSources.filter((source) => source.tone !== 'healthy').length;
  const openSourceHealth = () => {
    setSourceHealthOpen(true);
    setSearchOpen(false);
    setNotificationOpen(false);
    setOperatingDayOpen(false);
    setQuery('');
    setDrawer(null);
    setNewAppointmentOpen(false);
  };
  const openSourceWorkspace = (sourceName: string) => {
    setSourceHealthOpen(false);
    if (sourceName === 'Crew Portal') { setActiveNav('Krewe'); return; }
    if (sourceName === 'Control' || sourceName === 'WhatsApp photos') { setActiveNav('Command'); setView('today'); return; }
    if (sourceName === 'LinxUp') { setActiveNav('Fleet'); setFleetView('overview'); return; }
    if (sourceName === 'QuickBooks') { setActiveNav('Finance'); setFinanceView('overview'); return; }
    if (sourceName === 'SearchKings') { setActiveNav('Marketing'); setMarketingView('leads'); return; }
    if (sourceName === 'Podium') { setActiveNav('Marketing'); setMarketingView('reviews'); return; }
    if (sourceName === 'Slack') { setActiveNav('Command'); setView('now'); return; }
    setActiveNav('Schedule'); setScheduleView('board');
  };
  const openTerritoryRecord = (territory: ScheduleTerritory) => {
    const code = territoryDesignators[territory];
    const linkedAppointments = allScheduledAppointments.filter((appointment) => appointment.territory === territory);
    openRecordDrawer({ territoryId: territory, kicker: `Territory Record · ${code}`, title: territory, summary: `${linkedAppointments.length} linked appointment${linkedAppointments.length === 1 ? '' : 's'} across today and tomorrow`, action: 'Focus live schedule', source: 'JunkWare + LinxUp + Krewe + Finance', updated: 'Reconciled now', facts: [] });
  };
  const openAreaRecord = (territory: ScheduleTerritory, areaCode: string) => {
    const area = serviceAreaCatalog.find((item) => item.territory === territory && item.code === areaCode);
    if (!area) return;
    const linkedAppointments = allScheduledAppointments.filter((appointment) => appointment.territory === territory && appointment.areaDesignator.code === areaCode);
    openRecordDrawer({ territoryId: territory, areaId: areaCode, kicker: `Area Record · ${area.territoryCode} / ${area.code}`, title: area.label, summary: `${linkedAppointments.length} linked appointment${linkedAppointments.length === 1 ? '' : 's'} across ${area.localities.join(' and ')}`, action: 'Focus live schedule', source: 'JunkWare + LinxUp + Krewe + Finance', updated: 'Reconciled now', facts: [] });
  };
  const openTerritorySchedule = (day: ScheduleDay) => {
    if (!activeTerritory || !activeTerritoryCode) return;
    setActiveNav('Schedule');
    setScheduleDay(day);
    setOperatingDate(day === 'today' ? '2026-08-31' : '2026-09-01');
    setCalendarDateDraft(day === 'today' ? '2026-08-31' : '2026-09-01');
    setScheduleView('board');
    setScheduleScope(`T:${activeTerritoryCode}`);
    setScheduleStatusFilter('all');
    setTerritoryPriority(activeTerritoryCode);
    setDrawer(null);
  };
  const openAreaSchedule = (day: ScheduleDay, statusFilter: ScheduleStatusFilter = 'all') => {
    if (!activeArea) return;
    setActiveNav('Schedule');
    setScheduleDay(day);
    setOperatingDate(day === 'today' ? '2026-08-31' : '2026-09-01');
    setCalendarDateDraft(day === 'today' ? '2026-08-31' : '2026-09-01');
    setScheduleView('board');
    setScheduleScope(`A:${activeArea.territoryCode}:${activeArea.code}`);
    setScheduleStatusFilter(statusFilter);
    setTerritoryPriority(activeArea.territoryCode);
    setDrawer(null);
  };
  const openNewAppointmentForArea = () => {
    if (!activeArea) return;
    if (scheduleChangeBlocking) {
      setActiveNav('Schedule');
      setScheduleView('board');
      setDrawer(null);
      setActionFeedback(`Resolve the ${scheduleChangeReceipt?.appointmentId} schedule change before creating another appointment.`);
      return;
    }
    setActiveNav('Schedule');
    setScheduleDay('today');
    setOperatingDate('2026-08-31');
    setNewAppointment({ ...emptyNewAppointment, area: activeArea.localities[0] || 'New Orleans' });
    setNewAppointmentError('');
    setNewAppointmentCustomerQuery('');
    setNewAppointmentCustomerId(null);
    setNewAppointmentAddressVerification(null);
    setReviewedBookingFingerprint(null);
    setDuplicateOverrideReason('');
    setJunkWareCreationState('idle');
    setJunkWareCreationJk('');
    setDrawer(null);
    setNewAppointmentOpen(true);
  };
  const openCustomerRecord = (customerId: string) => {
    const customer = customerRecords.find((item) => item.id === customerId);
    if (!customer) return false;
    setCustomerNoteDraft(customerNotes[customer.id] || '');
    openRecordDrawer({ customerId: customer.id, kicker: 'Customer Record', title: customer.name, summary: `${customer.phone} · ${customer.appointments.length} linked appointment${customer.appointments.length === 1 ? '' : 's'}`, action: 'New appointment', source: 'JunkWare + SearchKings + Podium + QBO', updated: 'Reconciled now', facts: [] });
    return true;
  };
  const saveCustomerNote = () => {
    if (!activeCustomer) return;
    const note = customerNoteDraft.trim();
    if (!note) {
      setActionFeedback('Enter a customer note before saving.');
      return;
    }
    const previous = customerNotes[activeCustomer.id] || 'No OpsCenter customer note';
    setCustomerNotes((notes) => ({ ...notes, [activeCustomer.id]: note }));
    logAudit({ workspace: 'Command', action: 'Customer note updated', record: activeCustomer.name, summary: note, previous, next: note, source: 'OpsCenter customer record', result: 'Completed', refId: activeCustomer.appointments[0]?.jk });
    setActionFeedback('Customer note saved with an attributable audit entry.');
  };
  const openNewAppointmentForCustomer = () => {
    if (!activeCustomer) return;
    if (scheduleChangeBlocking) {
      setActiveNav('Schedule');
      setScheduleView('board');
      setDrawer(null);
      setActionFeedback(`Resolve the ${scheduleChangeReceipt?.appointmentId} schedule change before creating another appointment.`);
      return;
    }
    const latestAppointment = activeCustomer.appointments[0];
    setNewAppointment({ ...emptyNewAppointment, customer: activeCustomer.name, phone: activeCustomer.phone, address: latestAppointment?.details.address || '', area: latestAppointment?.area || 'New Orleans', notes: customerNotes[activeCustomer.id] || latestAppointment?.details.notes || '' });
    setNewAppointmentError('');
    setNewAppointmentCustomerQuery(`${activeCustomer.name} · ${activeCustomer.phone}`);
    setNewAppointmentCustomerId(activeCustomer.id);
    setNewAppointmentAddressVerification(null);
    setReviewedBookingFingerprint(null);
    setDuplicateOverrideReason('');
    setJunkWareCreationState('idle');
    setJunkWareCreationJk('');
    setDrawer(null);
    setNewAppointmentOpen(true);
  };
  const openUnifiedJobRecord = (appointmentId: string, source = 'JunkWare', updated = 'Live') => {
    if (live) {
      const alert = live.snapshot.alerts.find(item => item.title.includes(appointmentId));
      if (alert?.href) window.open(alert.href, '_blank', 'noopener,noreferrer');
      else setActionFeedback('The source record is not available in this Command snapshot.');
      return true;
    }
    setActionFeedback('');
    const matchedDay = (['today', 'tomorrow'] as ScheduleDay[]).find((day) => buildScheduledAppointments(scheduleRowsByDay[day]).some((appointment) => appointment.jk === appointmentId));
    const appointment = matchedDay
      ? buildScheduledAppointments(scheduleRowsByDay[matchedDay]).find((item) => item.jk === appointmentId)
      : undefined;
    if (matchedDay && appointment) {
      setScheduleDay(matchedDay);
      setOperatingDate(matchedDay === 'tomorrow' ? '2026-09-01' : '2026-08-31');
      setCalendarDateDraft(matchedDay === 'tomorrow' ? '2026-09-01' : '2026-08-31');
      openRecordDrawer({ appointmentId, kicker: `Job Record · ${appointment.state}`, title: appointmentId, summary: `${appointment.customer} · ${appointment.area}`, action: 'Open source record', source, updated, facts: [] });
      return true;
    }

    const payment = financePayments.find((item) => item.id === appointmentId);
    const recoveryItems = financeRecoveryItems.filter((item) => item.sourceJob === appointmentId);
    const reviewMatches = marketingReviews.filter((review) => review.selectedAppointment === appointmentId || review.candidates.includes(appointmentId));
    const followup = scheduleFollowups.find((item) => item.jk === appointmentId);
    const history = scheduleHistoryRows.find((item) => item.jk === appointmentId);
    const linkedFacts: DrawerRecord['facts'] = [
      { label: 'JK Number', value: appointmentId },
      { label: 'Schedule Details', value: 'Not loaded in the current operating dates' },
    ];
    if (followup) linkedFacts.push(
      { label: 'Customer', value: followup.customer },
      { label: 'Phone', value: followup.phone },
      { label: 'Area', value: followup.area },
      { label: 'Follow-Up', value: `${followup.label} · ${followup.age} open` },
    );
    if (payment) linkedFacts.push(
      { label: 'Payment Customer', value: payment.customer },
      { label: 'Recorded Total', value: moneyValue(payment.jobTotal) },
      { label: 'Payment Status', value: payment.status },
    );
    recoveryItems.forEach((item, index) => linkedFacts.push({ label: `${item.kind} ${index + 1}`, value: `${item.item} · ${item.status}` }));
    reviewMatches.forEach((review, index) => linkedFacts.push({ label: `Review Match ${index + 1}`, value: `${review.customer} · ${review.status}` }));
    if (history) linkedFacts.push({ label: 'Latest Schedule Activity', value: `${history.type} · ${history.change}` });
    openRecordDrawer({
      jobReferenceId: appointmentId,
      kicker: 'JunkWare Job Reference',
      title: appointmentId,
      summary: followup?.customer || payment?.customer || 'Referenced across OpsCenter; current appointment details are not loaded in this prototype.',
      action: 'Open source record', source, updated, facts: linkedFacts,
    });
    return true;
  };
  const copyJkNumber = (appointmentId: string) => {
    if (!navigator.clipboard) {
      setActionFeedback('Clipboard access is unavailable in this preview.');
      return;
    }
    void navigator.clipboard.writeText(appointmentId).then(() => {
      setCopiedJk(appointmentId);
      window.setTimeout(() => setCopiedJk((current) => current === appointmentId ? null : current), 1400);
    }).catch(() => setActionFeedback('The JK number could not be copied from this preview.'));
  };
  const renderJkLink = (appointmentId: string, source = 'OpsCenter linked record', updated = 'Current view') => (
    <button type="button" className="jk-record-link" onClick={() => openUnifiedJobRecord(appointmentId, source, updated)} aria-label={`Open job record ${appointmentId}`}>{appointmentId}</button>
  );
  const renderLinkedJkText = (value: string, source = 'OpsCenter linked record', updated = 'Current view') => {
    const match = value.match(/JK\d{7}/);
    if (!match || match.index == null) return value;
    const start = match.index;
    return <>{value.slice(0, start)}{renderJkLink(match[0], source, updated)}{value.slice(start + match[0].length)}</>;
  };
  const openAlertRecord = (item: WorkItem) => {
    setNotificationOpen(false);
    if (live) { const href = liveAlert(item)?.href; if (href) window.open(href, '_blank', 'noopener,noreferrer'); return; }
    const appointmentId = item.title.match(/JK\d{7}/)?.[0];
    if (appointmentId && openUnifiedJobRecord(appointmentId, item.source, item.detected)) return;
    openRecordDrawer({
      kicker: item.label,
      title: item.title,
      summary: item.detail,
      action: item.action,
      source: item.source,
      updated: item.detected,
      facts: item.facts,
    });
  };
  const acknowledgeAlert = (item: WorkItem) => {
    if (mutationBusyRef.current) return;
    if (live) { void live.onAlertAction(String(item.id), 'acknowledge'); return; }
    setCompleted((items) => items.includes(item.id) ? items : [...items, item.id]);
    logAudit({ workspace: 'Command', action: 'Alert acknowledged', record: item.title, summary: `Seen by Mission Control. Underlying issue remains separate: ${item.context}`, previous: 'Active', next: 'Acknowledged', source: item.source, result: 'Needs review' });
  };
  const openOperatingContext = (day: ScheduleDay, workspace: 'Schedule' | 'Krewe') => {
    if (live) { setActionFeedback(workspace + ' live integration is still being verified.'); return; }
    setScheduleDay(day);
    setOperatingDate(day === 'today' ? '2026-08-31' : '2026-09-01');
    setCalendarDateDraft(day === 'today' ? '2026-08-31' : '2026-09-01');
    setOperatingDayOpen(false);
    setSearchOpen(false);
    setNotificationOpen(false);
    setQuery('');
    setActionFeedback('');
    if (workspace === 'Schedule') {
      setActiveNav('Schedule');
      setScheduleView('board');
      setScheduleScope('ALL');
      setScheduleStatusFilter('all');
      return;
    }
    setActiveNav('Krewe');
    setKreweView(day === 'today' ? 'today' : 'callin');
  };
  const openCalendarDate = (requestedDate?: string) => {
    if (live) {
      const date = requestedDate || calendarDateDraft;
      if (/^\d{4}-\d{2}-\d{2}$/.test(date)) window.location.assign('/desktop?data=live&date=' + encodeURIComponent(date));
      return;
    }
    const selectedDate = requestedDate || calendarDateDraft;
    const [year, month, day] = selectedDate.split('-').map(Number);
    if (year !== 2026 || month < 8 || month > 9 || (month === 9 && day > 1)) return;
    setCalendarDateDraft(selectedDate);
    setOperatingDate(selectedDate);
    setOperatingDayOpen(false);
    setSearchOpen(false);
    setNotificationOpen(false);
    setQuery('');
    setActiveNav('Schedule');
    if (selectedDate === '2026-09-01') {
      setScheduleDay('tomorrow');
      setScheduleView('board');
      return;
    }
    setScheduleDay('today');
    setSelectedCalendarDay(day);
    setScheduleView('calendar');
  };
  const operatingDateLabel = operatingDate === '2026-08-31'
    ? 'Today, Aug 31'
    : operatingDate === '2026-09-01'
      ? 'Tomorrow, Sep 1'
      : new Date(`${operatingDate}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

  const globalSearchResults = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (normalized.length < 2) return [] as GlobalSearchResult[];
    const results: GlobalSearchResult[] = [];
    const add = (result: GlobalSearchResult) => {
      if (result.searchable.toLowerCase().includes(normalized)) results.push(result);
    };

    customerRecords.forEach((customer) => add({
      key: `customer-${customer.id}`, kind: 'customer', group: 'Customers', refId: customer.id,
      title: customer.name, subtitle: customer.phone,
      context: `${customer.appointments.length} appointment${customer.appointments.length === 1 ? '' : 's'} · ${Array.from(new Set(customer.appointments.map((appointment) => appointment.territory))).join(' · ')}`,
      status: 'Customer record', source: 'Reconciled sources', searchable: `${customer.name} ${customer.phone} ${customer.appointments.map((appointment) => `${appointment.jk} ${appointment.details.address} ${appointment.details.scope}`).join(' ')}`,
    }));
    territoryOrder.forEach((territory) => {
      const appointments = allScheduledAppointments.filter((appointment) => appointment.territory === territory);
      add({
        key: `territory-${territoryDesignators[territory]}`, kind: 'territory', group: 'Schedule', refId: territory,
        title: `${territory} · ${territoryDesignators[territory]}`, subtitle: 'Territory Record',
        context: `${appointments.filter((appointment) => appointment.day === 'today').length} today · ${appointments.filter((appointment) => appointment.day === 'tomorrow').length} tomorrow`,
        status: 'Operating territory', source: 'Reconciled sources', searchable: `${territory} ${territoryDesignators[territory]} ${newAppointmentAreaOptions.filter((area) => appointmentTerritoryForArea(area) === territory).join(' ')}`,
      });
    });
    serviceAreaCatalog.forEach((area) => {
      const appointments = allScheduledAppointments.filter((appointment) => appointment.territory === area.territory && appointment.areaDesignator.code === area.code);
      add({
        key: `area-${area.territoryCode}-${area.code}`, kind: 'area', group: 'Schedule', refId: `${area.territory}|${area.code}`,
        title: `${area.label} · ${area.code}`, subtitle: `${area.territory} · Area Record`,
        context: `${appointments.filter((appointment) => appointment.day === 'today').length} today · ${appointments.filter((appointment) => appointment.day === 'tomorrow').length} tomorrow · ${area.localities.join(' · ')}`,
        status: 'Service area', source: 'Reconciled sources', searchable: `${area.label} ${area.code} ${area.territory} ${area.territoryCode} ${area.localities.join(' ')}`,
      });
    });
    (['today', 'tomorrow'] as ScheduleDay[]).forEach((day) => {
      buildScheduledAppointments(scheduleRowsByDay[day]).forEach((appointment) => add({
        key: `appointment-${day}-${appointment.jk}`, kind: 'appointment', group: 'Schedule', refId: appointment.jk, day,
        title: `${appointment.jk} · ${appointment.customer}`, subtitle: `${appointment.territory} · ${appointment.areaDesignator.code}`,
        context: `${day === 'today' ? 'Today' : 'Tomorrow'} · ${appointment.time} · ${appointment.truck}`, status: appointment.state,
        source: 'JunkWare', searchable: `${appointment.jk} ${appointment.customer} ${appointment.details.phone} ${appointment.details.address} ${appointment.details.scope} ${appointment.territory} ${appointment.area} ${appointment.truck} ${appointment.crew} ${appointment.state}`,
      }));
    });
    kreweMembers.forEach((member) => add({
      key: `krewe-${member.id}`, kind: 'krewe', group: 'Krewe', refId: member.id, title: member.name,
      subtitle: `${member.role} · ${member.truck}`, context: `${member.territory} · ${member.jobs ?? '—'} jobs · ${moneyValue(member.revenue)}`,
      status: member.status, source: 'JunkWare attendance', searchable: `${member.name} ${member.role} ${member.truck} ${member.territory} ${member.status}`,
    }));
    fleetTruckRows.forEach((truck) => add({
      key: `truck-${truck.id}`, kind: 'truck', group: 'Fleet', refId: truck.id, title: `${truck.label} · ${truck.vehicle}`,
      subtitle: `${truck.driver} · ${truck.navigator}`, context: `${truck.territory} · ${truck.location} · ${truck.loadPercent}% full`,
      status: truck.readiness, source: 'LinxUp + Fleet', searchable: `${truck.label} ${truck.vehicle} ${truck.driver} ${truck.navigator} ${truck.territory} ${truck.location} ${truck.assignment} ${truck.operatingStatus} ${truck.readiness}`,
    }));
    marketingLeads.forEach((lead) => add({
      key: `lead-${lead.id}`, kind: 'lead', group: 'Marketing', refId: lead.id, title: `${lead.customer} · ${lead.id}`,
      subtitle: `${lead.phone} · ${lead.territory}`, context: `${lead.intent} · ${moneyValue(lead.quotedValue)}`,
      status: lead.status, source: lead.source, searchable: `${lead.id} ${lead.customer} ${lead.phone} ${lead.territory} ${lead.intent} ${lead.status} ${lead.source}`,
    }));
    marketingReviews.forEach((review) => add({
      key: `review-${review.id}`, kind: 'review', group: 'Marketing', refId: review.id, title: `${review.customer} · ${review.stars} stars`,
      subtitle: `${review.location} · ${review.status}`, context: review.excerpt,
      status: review.status, source: 'Podium', searchable: `${review.id} ${review.customer} ${review.location} ${review.selectedAppointment} ${review.candidates.join(' ')} ${review.excerpt} ${review.status}`,
    }));
    financePayments.forEach((payment) => add({
      key: `payment-${payment.id}`, kind: 'payment', group: 'Finance', refId: payment.id, title: `${payment.id} · ${payment.customer}`,
      subtitle: `${payment.truck} · ${payment.method}`, context: `${moneyValue(payment.jobTotal)} job · ${moneyValue(payment.paymentAmount + payment.adjustment)} recorded`,
      status: payment.status, source: 'JunkWare + QBO', searchable: `${payment.id} ${payment.customer} ${payment.truck} ${payment.method} ${payment.reference} ${payment.status} ${payment.note}`,
    }));
    financeRecoveryItems.forEach((item) => add({
      key: `${item.kind.toLowerCase()}-${item.id}`, kind: item.kind.toLowerCase() as 'resale' | 'recycling', group: 'Finance', refId: item.id,
      title: `${item.item} · ${item.id}`, subtitle: `${item.location} · ${item.kind} source`, context: `${item.quantity} · ${moneyValue(item.expectedValue)} expected`,
      status: item.status, source: 'Truck Records', searchable: `${item.id} ${item.sourceJob} ${item.item} ${item.location} ${item.quantity} ${item.owner} ${item.status} ${item.note}`,
    }));
    return results.slice(0, 30);
  }, [query, customerRecords, allScheduledAppointments, scheduleRowsByDay, kreweMembers, fleetTruckRows, marketingLeads, marketingReviews, financePayments, financeRecoveryItems]);

  const visibleLauncherCommands = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return launcherCommands;
    return launcherCommands.filter((command) => `${command.label} ${command.description} ${command.workspace} ${command.keywords}`.toLowerCase().includes(normalized));
  }, [query]);

  const closeGlobalSearch = () => {
    setSearchOpen(false);
    setQuery('');
  };
  const openGlobalSearchResult = (result: GlobalSearchResult) => {
    closeGlobalSearch();
    setActionFeedback('');
    if (result.kind === 'customer') {
      openCustomerRecord(result.refId);
      return;
    }
    if (result.kind === 'territory') {
      openTerritoryRecord(result.refId as ScheduleTerritory);
      return;
    }
    if (result.kind === 'area') {
      const [territory, areaCode] = result.refId.split('|');
      openAreaRecord(territory as ScheduleTerritory, areaCode);
      return;
    }
    if (result.kind === 'appointment') {
      const appointment = buildScheduledAppointments(scheduleRowsByDay[result.day || 'today']).find((item) => item.jk === result.refId);
      if (!appointment) return;
      setActiveNav('Schedule');
      setScheduleView('board');
      setScheduleScope('ALL');
      setScheduleStatusFilter('all');
      openUnifiedJobRecord(appointment.jk, 'JunkWare', result.day === 'tomorrow' ? 'Tomorrow plan' : 'Live');
      return;
    }
    if (result.kind === 'krewe') {
      const member = kreweMembers.find((item) => item.id === result.refId);
      if (!member) return;
      setActiveNav('Krewe');
      setKreweView('today');
      openKreweMember(member);
      return;
    }
    if (result.kind === 'truck') {
      const truck = fleetTruckRows.find((item) => item.id === result.refId);
      if (!truck) return;
      setActiveNav('Fleet');
      setFleetView('overview');
      openFleetTruck(truck);
      return;
    }
    if (result.kind === 'lead') {
      const lead = marketingLeads.find((item) => item.id === result.refId);
      if (!lead) return;
      setActiveNav('Marketing'); setMarketingView('leads'); setMarketingLeadFilter('all');
      openRecordDrawer({ kicker: `Lead · ${lead.status}`, title: lead.customer, summary: `${lead.intent} · ${lead.territory}`, action: 'Open lead recovery', source: lead.source, updated: lead.age, facts: [{ label: 'Lead', value: lead.id }, { label: 'Phone', value: lead.phone, href: `tel:+1${lead.phone.replace(/\D/g, '')}` }, { label: 'Quoted value', value: moneyValue(lead.quotedValue) }, { label: 'Last contact', value: lead.lastContact }, { label: 'Next context', value: lead.reason }] });
      return;
    }
    if (result.kind === 'review') {
      const review = marketingReviews.find((item) => item.id === result.refId);
      if (!review) return;
      setActiveNav('Marketing'); setMarketingView('reviews');
      openRecordDrawer({ kicker: `Review · ${review.status}`, title: review.customer, summary: `${review.stars} stars · ${review.location}`, action: 'Open review attribution', source: 'Podium', updated: review.age, facts: [{ label: 'Review', value: review.id }, { label: 'Proposed job', value: review.selectedAppointment }, { label: 'Review text', value: review.excerpt }] });
      return;
    }
    if (result.kind === 'payment') {
      const payment = financePayments.find((item) => item.id === result.refId);
      if (!payment) return;
      setActiveNav('Finance'); setFinanceView('payments');
      if (openUnifiedJobRecord(payment.id, 'JunkWare + QBO', 'Current daily close')) return;
      openRecordDrawer({ kicker: `Payment · ${payment.status}`, title: payment.id, summary: `${payment.customer} · ${payment.truck}`, action: 'Open payment reconciliation', source: 'JunkWare + QBO', updated: 'Current daily close', facts: [{ label: 'Job total', value: moneyValue(payment.jobTotal) }, { label: 'Captured payment', value: moneyValue(payment.paymentAmount) }, { label: 'Adjustment', value: moneyValue(payment.adjustment) }, { label: 'Method', value: payment.method }, { label: 'Reference', value: payment.reference }, { label: 'Review note', value: payment.note }] });
      return;
    }
    const recoveryItem = financeRecoveryItems.find((item) => item.id === result.refId);
    if (!recoveryItem) return;
    setActiveNav('Finance'); setFinanceView(result.kind === 'resale' ? 'resale' : 'recycling');
    openRecordDrawer({ kicker: `${recoveryItem.kind} · ${recoveryItem.status}`, title: recoveryItem.item, summary: `${recoveryItem.sourceJob} · ${recoveryItem.location}`, action: `Open ${recoveryItem.kind.toLowerCase()} record`, source: 'Truck Records', updated: recoveryItem.age, facts: [{ label: 'Record', value: recoveryItem.id }, { label: 'Source job', value: recoveryItem.sourceJob }, { label: 'Quantity', value: recoveryItem.quantity }, { label: 'Expected value', value: moneyValue(recoveryItem.expectedValue) }, { label: 'Realized value', value: moneyValue(recoveryItem.realizedValue) }, { label: 'Owner', value: recoveryItem.owner }, { label: 'Notes', value: recoveryItem.note }] });
  };
  const runLauncherCommand = (commandId: LauncherCommandId) => {
    if (live) { setActionFeedback('Cross-workspace actions are still being connected. No action was submitted.'); return; }
    setActionFeedback('');
    if (commandId === 'new-appointment') {
      closeGlobalSearch();
      setActiveNav('Schedule');
      setScheduleView('board');
      openNewAppointment();
      return;
    }
    if (commandId === 'today-schedule') {
      openOperatingContext('today', 'Schedule');
      return;
    }
    if (commandId === 'tomorrow-plan') {
      openOperatingContext('tomorrow', 'Schedule');
      return;
    }
    if (commandId === 'urgent-actions') {
      closeGlobalSearch();
      setDrawer(null);
      setActiveNav('Command');
      setView('today');
      setActionQueueFilter('urgent');
      return;
    }
    if (commandId === 'truck-load') {
      closeGlobalSearch();
      setActiveNav('Fleet');
      setFleetView('overview');
      const truck = fleetTruckRows.find((item) => item.readiness === 'Attention') || fleetTruckRows.find((item) => item.readiness === 'Ready') || fleetTruckRows[0];
      if (truck) openFleetTruck(truck);
      return;
    }
    if (commandId === 'krewe-correction') {
      closeGlobalSearch();
      setActiveNav('Krewe');
      setKreweView('today');
      const member = kreweMembers.find((item) => item.status === 'Missing clock-in' || item.truck === 'Unassigned' || item.issue) || kreweMembers[0];
      if (member) openKreweMember(member);
      return;
    }
    if (commandId === 'payment-reconciliation') {
      const payment = financePayments.find((item) => item.status !== 'Matched') || financePayments[0];
      if (!payment) return;
      openGlobalSearchResult({
        key: `launcher-payment-${payment.id}`, kind: 'payment', group: 'Finance', refId: payment.id,
        title: `${payment.id} · ${payment.customer}`, subtitle: `${payment.truck} · ${payment.method}`,
        context: payment.note, status: payment.status, source: 'JunkWare + QBO', searchable: payment.id,
      });
      return;
    }
    openSourceHealth();
  };
  const visibleAuditEvents = auditFilter === 'All' ? auditEvents : auditEvents.filter((event) => event.workspace === auditFilter);
  const auditAttentionCount = auditEvents.filter((event) => event.result === 'Needs review').length;
  const auditSourceCount = new Set(auditEvents.map((event) => event.source)).size;
  const openAuditEvent = (event: AuditEvent) => {
    setActionFeedback('');
    if (event.refId?.startsWith('JK') && openUnifiedJobRecord(event.refId, event.source, event.time)) {
      setActiveNav(event.workspace);
      if (event.workspace === 'Schedule') setScheduleView('history');
      if (event.workspace === 'Finance') setFinanceView('payments');
      return;
    }
    if (event.workspace === 'Schedule') {
      setActiveNav('Schedule'); setScheduleDay('today'); setScheduleView('history');
      if (event.refId) openRecordDrawer({ appointmentId: event.refId, kicker: `Audit · ${event.action}`, title: event.record, summary: event.summary, action: 'Open appointment', source: event.source, updated: event.time, facts: [] });
      return;
    }
    if (event.workspace === 'Krewe') {
      setActiveNav('Krewe'); setKreweView('today');
      const member = kreweMembers.find((item) => item.id === event.refId);
      if (member) openKreweMember(member);
      return;
    }
    if (event.workspace === 'Fleet') {
      setActiveNav('Fleet'); setFleetView('overview');
      const truck = fleetTruckRows.find((item) => item.id === event.refId || item.label === event.record);
      if (truck) openFleetTruck(truck);
      return;
    }
    if (event.workspace === 'Marketing') {
      setActiveNav('Marketing');
      const review = marketingReviews.find((item) => item.id === event.refId);
      setMarketingView(review || event.action.toLowerCase().includes('review') ? 'reviews' : 'leads');
      return;
    }
    if (event.workspace === 'Finance') {
      setActiveNav('Finance');
      const recoveryItem = financeRecoveryItems.find((item) => item.id === event.refId);
      setFinanceView(recoveryItem?.kind === 'Resale' ? 'resale' : recoveryItem?.kind === 'Recycling' ? 'recycling' : 'payments');
      return;
    }
    setActiveNav('Command'); setView('now');
  };
  const visibleActionQueue = actionQueue.filter((item) => actionQueueFilter === 'all'
    || (actionQueueFilter === 'urgent' && item.priority === 'critical')
    || (actionQueueFilter === 'approval' && item.approval === 'Pending approval')
    || (actionQueueFilter === 'verification' && item.status === 'Awaiting Verification')
    || (actionQueueFilter === 'mine' && item.owner === 'Mission Control'));
  const urgentActionCount = actionQueue.filter((item) => item.priority === 'critical').length;
  const pendingApprovalCount = actionQueue.filter((item) => item.approval === 'Pending approval').length;
  const inProgressActionCount = actionQueue.filter((item) => item.status === 'In Progress').length;
  const awaitingVerificationCount = actionQueue.filter((item) => item.status === 'Awaiting Verification').length;
  const verifiedActionCount = auditEvents.filter((event) => event.action === 'Action verified').length;
  const myActionCount = actionQueue.filter((item) => item.owner === 'Mission Control').length;
  const closeoutQueueItems = buildScheduledAppointments(scheduleRowsByDay.today).flatMap<CloseoutQueueItem>((appointment) => {
    const category: AppointmentCategory = appointment.kind === 'Estimate' ? 'Estimate' : 'Job';
    const closeoutReceipt = appointmentCloseoutReceipts[appointment.jk];
    if (category === 'Job') {
      if (appointment.state !== 'Completed') return [];
      const payment = financePayments.find((item) => item.id === appointment.jk);
      const paymentDifference = payment ? Math.abs(payment.jobTotal - payment.paymentAmount - payment.adjustment) : null;
      const photosVerified = workItems.some((item) => item.label === 'Photos uploaded' && item.title.includes(appointment.jk));
      const gaps = [
        !payment ? 'Payment record missing' : payment.status !== 'Matched' || paymentDifference ? `${moneyValue(paymentDifference)} payment difference` : '',
        !photosVerified ? 'Required photos not verified' : '',
        closeoutReceipt ? 'JunkWare and QBO read-back pending' : '',
      ].filter(Boolean);
      if (!gaps.length) return [];
      return [{
        id: `closeout-${appointment.jk}`,
        appointmentId: appointment.jk,
        category,
        customer: appointment.customer,
        truck: appointment.truck,
        window: appointment.time,
        amount: payment ? moneyValue(payment.jobTotal) : appointment.details.value,
        exception: !payment ? 'Payment Reconciliation Missing' : payment.status !== 'Matched' || paymentDifference ? 'Payment Reconciliation Required' : 'Closeout Verification Required',
        detail: gaps.join(' · '),
        owner: 'Finance',
        due: 'Now',
        source: 'JunkWare + QBO',
        priority: !payment || Boolean(paymentDifference) ? 'critical' : 'warning',
        primaryAction: payment ? 'Review Reconciliation' : 'Open Job Closeout',
      }];
    }
    if (appointment.state === 'Canceled') return [];
    if (appointment.state === 'Estimate Closed' && closeoutReceipt?.estimateOutcome === 'Not Booked') return [];
    const followUpDue = appointment.state === 'Estimate Closed' && closeoutReceipt?.estimateOutcome === 'Follow-Up Required';
    return [{
      id: `closeout-${appointment.jk}`,
      appointmentId: appointment.jk,
      category,
      customer: appointment.customer,
      truck: appointment.truck,
      window: appointment.time,
      amount: closeoutReceipt ? moneyValue(closeoutReceipt.amount) : appointment.details.value,
      exception: followUpDue ? 'Customer Follow-Up Due' : appointment.state === 'Estimate Closed' ? 'Estimate Disposition Missing' : 'Estimate Outcome Required',
      detail: followUpDue ? `Closed Estimate · ${closeoutReceipt?.notes}` : 'Close as an Estimate or explicitly convert it to a completed Job after the appointment.',
      owner: 'Dispatch',
      due: followUpDue ? closeoutReceipt?.followUpDate || 'Today' : `After ${appointment.time}`,
      source: 'JunkWare Schedule',
      priority: followUpDue || appointment.state === 'Estimate Closed' ? 'warning' : 'watch',
      primaryAction: followUpDue ? 'Open Follow-Up' : 'Record Outcome',
    }];
  });
  const closeoutJobCount = closeoutQueueItems.filter((item) => item.category === 'Job').length;
  const closeoutEstimateCount = closeoutQueueItems.filter((item) => item.category === 'Estimate').length;
  const closeoutUrgentCount = closeoutQueueItems.filter((item) => item.priority === 'critical').length;
  const visibleCloseoutQueueItems = closeoutQueueItems.filter((item) => closeoutQueueFilter === 'all'
    || (closeoutQueueFilter === 'jobs' && item.category === 'Job')
    || (closeoutQueueFilter === 'estimates' && item.category === 'Estimate')
    || (closeoutQueueFilter === 'urgent' && item.priority === 'critical'));
  const linkedDecisionForCloseout = (item: CloseoutQueueItem) => actionQueue.find((action) => action.id === `AQ-CO-${item.appointmentId}`
    || (action.refId === item.appointmentId && action.source.toLowerCase().includes('closeout')));
  const openCloseoutQueueItem = (item: CloseoutQueueItem) => {
    openUnifiedJobRecord(item.appointmentId, item.source, item.due);
  };
  const addCloseoutToDecisions = (item: CloseoutQueueItem) => {
    const existing = linkedDecisionForCloseout(item);
    if (existing) {
      manageActionQueueItem(existing);
      return;
    }
    const actionItem: ActionQueueItem = {
      id: `AQ-CO-${item.appointmentId}`,
      workspace: item.category === 'Job' ? 'Finance' : 'Schedule',
      priority: item.priority,
      title: `${item.exception} · ${item.appointmentId}`,
      detail: `${item.customer} · ${item.truck} · ${item.detail}`,
      record: item.appointmentId,
      owner: item.owner,
      due: item.due,
      source: `Closeout Queue · ${item.source}`,
      action: item.primaryAction,
      status: 'Open',
      note: item.detail,
      escalated: false,
      recommendation: item.category === 'Job' ? 'Resolve the visible closeout gaps, then verify the exact JunkWare and QBO source state.' : 'Record the customer disposition; create a Job only through an explicit category decision.',
      approval: 'Not required',
      verification: item.category === 'Job' ? 'Job total, payment, photos, and source status agree by JK number.' : 'Estimate outcome and any required follow-up are recorded without counting completed-job revenue.',
      verificationSource: item.category === 'Job' ? 'JunkWare + QBO' : 'JunkWare Schedule',
      refId: item.appointmentId,
    };
    setActionQueue((items) => [actionItem, ...items]);
    logAudit({ workspace: 'Command', action: 'Closeout added to Control', record: item.appointmentId, summary: `${item.exception} assigned to ${item.owner}.`, previous: 'Closeout queue only', next: `${actionItem.id} · Open`, source: item.source, result: 'Needs review', refId: item.appointmentId });
    setActionFeedback(`${item.appointmentId} was added to Operating Decisions with ${item.owner} ownership.`);
  };
  const startScheduleUnassignedCount = buildScheduledAppointments(scheduleRowsByDay.today).filter((appointment) => appointment.truck === 'Unassigned').length;
  const startScheduleGapCount = scheduleRowsByDay.today.reduce((count, row) => count + row.jobs.filter((job) => job.jk === 'Open capacity').length, 0);
  const startScheduleExceptionCount = startScheduleUnassignedCount + startScheduleGapCount;
  const startScheduledTruckLabels = new Set(scheduleRowsByDay.today.filter((row) => row.truck !== 'Unassigned' && row.jobs.some((job) => job.jk !== 'Open capacity')).map((row) => row.truck));
  const startFleetExceptions = fleetTruckRows.filter((truck) => startScheduledTruckLabels.has(truck.label) && (truck.readiness !== 'Ready' || truck.checklist === 'Missing'));
  const startKreweExceptions = workingKrewe.filter((member) => member.status === 'Missing clock-in' || member.truck === 'Unassigned' || Boolean(member.issue));
  const startCriticalAlerts = activeAlerts.filter((item) => item.priority === 'critical');
  const startCarryoverCount = Object.keys(dayCloseCarryovers).length;
  const dayStartGates: DayStartGate[] = [
    {
      id: 'schedule', title: 'Schedule Plan', count: startScheduleExceptionCount, unit: 'gaps', owner: 'Dispatch', due: 'Before first dispatch', workspace: 'Schedule', reviewLabel: 'Review Board',
      detail: startScheduleExceptionCount ? `${startScheduleUnassignedCount} unassigned appointments · ${startScheduleGapCount} route gaps.` : 'Every appointment is assigned and sequenced.',
      source: 'JunkWare Schedule', owned: actionQueue.some((item) => item.id === 'AQ-START-schedule'),
    },
    {
      id: 'fleet', title: 'Fleet Readiness', count: startFleetExceptions.length, unit: 'trucks', owner: 'Fleet', due: 'Before departure', workspace: 'Fleet', reviewLabel: 'Review Fleet',
      detail: startFleetExceptions.length ? `${startFleetExceptions.length} scheduled trucks have a readiness or inspection exception.` : 'Scheduled trucks are ready with load status recorded.',
      source: 'Fleet Load Ledger + LinxUp', owned: actionQueue.some((item) => item.id === 'AQ-START-fleet'),
    },
    {
      id: 'krewe', title: 'Krewe Coverage', count: startKreweExceptions.length, unit: 'people', owner: 'Ops Manager', due: 'Before payroll cutoff', workspace: 'Krewe', reviewLabel: 'Review Krewe',
      detail: startKreweExceptions.length ? `${startKreweExceptions.length} attendance or truck-assignment exceptions need ownership.` : 'Attendance and truck assignments are confirmed.',
      source: 'JunkWare Attendance', owned: actionQueue.some((item) => item.id === 'AQ-START-krewe'),
    },
    {
      id: 'carryovers', title: 'Prior Carryovers', count: startCarryoverCount, unit: 'items', owner: 'Mission Control', due: 'By recorded deadline', workspace: 'Command', reviewLabel: 'Review Handoffs',
      detail: startCarryoverCount ? `${startCarryoverCount} prior-day carryovers retain an owner and deadline.` : 'No prior-day carryovers are waiting.',
      source: 'OpsCenter Control', owned: startCarryoverCount > 0,
    },
    {
      id: 'alerts', title: 'Critical Alerts', count: startCriticalAlerts.length, unit: 'alerts', owner: 'Mission Control', due: 'Now', workspace: 'Command', reviewLabel: 'Review Alerts',
      detail: startCriticalAlerts.length ? `${startCriticalAlerts.length} critical alerts must be acknowledged or controlled.` : 'No critical alert is awaiting acknowledgement.',
      source: 'Slack Alerts + OpsCenter Control', owned: startCriticalAlerts.length > 0 && startCriticalAlerts.every((alert) => actionQueue.some((item) => item.alertId === alert.id)),
    },
  ];
  const startDayGateIsCleared = (gate: DayStartGate) => gate.count === 0 || gate.owned;
  const startDayClearedGateCount = dayStartGates.filter(startDayGateIsCleared).length;
  const startDayBlockingGateCount = dayStartGates.length - startDayClearedGateCount;
  const startDayOwnedExceptionCount = dayStartGates.filter((gate) => gate.count > 0 && gate.owned).reduce((sum, gate) => sum + gate.count, 0);
  const startDayReady = startDayBlockingGateCount === 0;
  const startDayProgress = (startDayClearedGateCount / dayStartGates.length) * 100;
  const todayOpenAppointments = buildScheduledAppointments(scheduleRowsByDay.today).filter((appointment) => !isFinalAppointmentState(appointment.state));
  const operatingFleetCloseouts = fleetTruckRows.filter((truck) => truck.readiness !== 'Out of service' && !['Route closed', 'Parked'].includes(truck.operatingStatus));
  const unreconciledKreweRows = workingKrewe.filter((member) => member.clockOut === '—' || Boolean(member.issue));
  const dayCloseGates: DayCloseGate[] = [
    {
      id: 'appointments', title: 'Appointment Disposition', count: todayOpenAppointments.length, unit: 'open', owner: 'Dispatch', reviewLabel: 'Review Schedule',
      detail: todayOpenAppointments.length ? `${todayOpenAppointments.length} appointments do not have a final disposition.` : 'Every appointment has a final disposition.',
      source: 'JunkWare Schedule',
    },
    {
      id: 'jobs', title: 'Job Closeouts', count: closeoutJobCount, unit: 'exceptions', owner: 'Finance', reviewLabel: 'Review Jobs',
      detail: closeoutJobCount ? `${closeoutJobCount} completed Jobs still need payment, photo, or source reconciliation.` : 'Completed Jobs are fully reconciled.',
      source: 'JunkWare + QBO',
    },
    {
      id: 'estimates', title: 'Estimate Outcomes', count: closeoutEstimateCount, unit: 'open', owner: 'Dispatch', reviewLabel: 'Review Estimates',
      detail: closeoutEstimateCount ? `${closeoutEstimateCount} Estimates need an outcome or owned follow-up.` : 'Every Estimate has a recorded disposition.',
      source: 'JunkWare Schedule',
    },
    {
      id: 'fleet', title: 'Fleet End-of-Route', count: operatingFleetCloseouts.length, unit: 'trucks', owner: 'Fleet', reviewLabel: 'Review Truck Loads',
      detail: operatingFleetCloseouts.length ? `${operatingFleetCloseouts.length} operating trucks still need end-of-route load status.` : 'Every operating truck has a final load disposition.',
      source: 'Fleet Load Ledger',
    },
    {
      id: 'handoffs', title: 'Krewe and Handoffs', count: unreconciledKreweRows.length + actionQueue.length, unit: 'items', owner: 'Ops Manager', reviewLabel: 'Review Handoffs',
      detail: `${unreconciledKreweRows.length} Krewe time records and ${actionQueue.length} operating decisions remain open.`,
      source: 'JunkWare Attendance + OpsCenter Control',
    },
  ];
  const clearedDayCloseGateCount = dayCloseGates.filter((gate) => gate.count === 0 || Boolean(dayCloseCarryovers[gate.id])).length;
  const dayCloseReady = clearedDayCloseGateCount === dayCloseGates.length;
  const dayCloseProgress = (clearedDayCloseGateCount / dayCloseGates.length) * 100;
  const activeDayCloseGate = dayCloseGates.find((gate) => gate.id === activeDayCloseGateId);
  const scrollToControlPanel = (id: string) => requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  const reviewDayStartGate = (gateId: DayStartGateId) => {
    if (gateId === 'schedule') {
      setActiveNav('Schedule'); setScheduleDay('today'); setScheduleView('board'); setScheduleScope('ALL'); setScheduleStatusFilter(startScheduleUnassignedCount ? 'unassigned' : 'all'); setTerritoryPriority(null);
      return;
    }
    if (gateId === 'fleet') {
      setActiveNav('Fleet'); setFleetView('overview'); setFleetSummaryFilter('all');
      return;
    }
    if (gateId === 'krewe') {
      setActiveNav('Krewe'); setKreweView('today'); setKreweFilter('attention');
      return;
    }
    if (gateId === 'alerts') {
      setView('now'); setAlertViewFilter('open');
      return;
    }
    setActionQueueFilter('all');
    scrollToControlPanel('operating-decisions');
  };
  const addDayStartGateToDecisions = (gate: DayStartGate) => {
    const existing = actionQueue.find((item) => item.id === `AQ-START-${gate.id}`);
    if (existing) {
      setActionQueueFilter('all');
      scrollToControlPanel('operating-decisions');
      return;
    }
    const actionItem: ActionQueueItem = {
      id: `AQ-START-${gate.id}`,
      workspace: gate.workspace,
      priority: gate.id === 'schedule' || gate.id === 'fleet' || gate.id === 'krewe' ? 'critical' : 'warning',
      title: `Start-of-Day · ${gate.title}`,
      detail: gate.detail,
      record: gate.title,
      owner: gate.owner,
      due: gate.due,
      source: gate.source,
      action: gate.reviewLabel,
      status: 'Open',
      note: `Resolve the ${gate.count} ${gate.unit} before the recorded deadline.`,
      escalated: false,
      recommendation: `Review the exact source records behind this readiness gate, resolve what can be resolved, and keep any remaining exception attributable to ${gate.owner}.`,
      approval: 'Not required',
      verification: `${gate.title} returns to source-ready status or each remaining exception has a verified disposition.`,
      verificationSource: gate.source,
    };
    setActionQueue((items) => [actionItem, ...items]);
    logAudit({ workspace: 'Command', action: 'Morning exception added to Control', record: gate.title, summary: `${gate.count} ${gate.unit} assigned to ${gate.owner} before operating-day start.`, previous: 'Unowned readiness exception', next: `${actionItem.id} · ${gate.owner} · ${gate.due}`, source: gate.source, result: 'Needs review' });
  };
  const beginOperatingDay = () => {
    if (!startDayReady) return;
    const startedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setOperatingDayStarted(true);
    setOperatingDayStartedAt(startedAt);
    logAudit({ workspace: 'Command', action: 'Operating Day Started', record: 'Sunday, August 31', summary: `${startDayClearedGateCount} readiness gates cleared · ${startDayOwnedExceptionCount} owned exceptions.`, previous: 'Morning review', next: `Operating · ${startedAt}`, source: 'OpsCenter Control', result: 'Completed' });
  };
  const reopenDayStartReadiness = () => {
    setOperatingDayStarted(false);
    logAudit({ workspace: 'Command', action: 'Start Readiness Reopened', record: 'Sunday, August 31', summary: 'The start-of-day review was reopened for another operating check.', previous: `Operating · ${operatingDayStartedAt || 'Started'}`, next: 'Morning review', source: 'OpsCenter Control', result: 'Needs review' });
  };
  const reviewDayCloseGate = (gateId: DayCloseGateId) => {
    setActiveDayCloseGateId(null);
    setDayCloseError('');
    if (gateId === 'appointments') {
      setActiveNav('Schedule'); setScheduleDay('today'); setScheduleView('board'); setScheduleScope('ALL'); setScheduleStatusFilter('open'); setTerritoryPriority(null);
      return;
    }
    if (gateId === 'jobs' || gateId === 'estimates') {
      setCloseoutQueueFilter(gateId);
      scrollToControlPanel('closeout-queue');
      return;
    }
    if (gateId === 'fleet') {
      setActiveNav('Fleet'); setFleetView('overview'); setFleetSummaryFilter('all');
      return;
    }
    setActionQueueFilter('all');
    scrollToControlPanel('operating-decisions');
  };
  const startDayCloseCarryover = (gate: DayCloseGate) => {
    const existing = dayCloseCarryovers[gate.id];
    setActiveDayCloseGateId(gate.id);
    setDayCloseCarryoverDraft({ owner: existing?.owner || gate.owner, due: existing?.due || 'Tomorrow · 9:00 AM', note: existing?.note || '' });
    setDayCloseError('');
  };
  const saveDayCloseCarryover = () => {
    if (!activeDayCloseGate) return;
    const owner = dayCloseCarryoverDraft.owner.trim();
    const due = dayCloseCarryoverDraft.due.trim();
    const note = dayCloseCarryoverDraft.note.trim();
    if (!owner || !due) {
      setDayCloseError('Owner and deadline are required for an intentional carryover.');
      return;
    }
    if (note.length < 8) {
      setDayCloseError('Add a specific carryover reason of at least 8 characters.');
      return;
    }
    const recordedAt = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    setDayCloseCarryovers((carryovers) => ({ ...carryovers, [activeDayCloseGate.id]: { owner, due, note, recordedAt } }));
    logAudit({ workspace: 'Command', action: 'Operating Day Carryover Planned', record: activeDayCloseGate.title, summary: `${owner} owns ${activeDayCloseGate.count} ${activeDayCloseGate.unit} until ${due}. ${note}`, previous: 'Blocking day close', next: `Owned carryover · ${owner} · ${due}`, source: activeDayCloseGate.source, result: 'Needs review' });
    setActiveDayCloseGateId(null);
    setDayCloseError('');
  };
  const removeDayCloseCarryover = (gate: DayCloseGate) => {
    setDayCloseCarryovers((carryovers) => {
      const next = { ...carryovers };
      delete next[gate.id];
      return next;
    });
    setOperatingDayClosed(false);
    logAudit({ workspace: 'Command', action: 'Operating Day Carryover Reopened', record: gate.title, summary: 'The intentional carryover was removed and the gate is blocking again.', previous: 'Owned carryover', next: 'Blocking day close', source: gate.source, result: 'Needs review' });
  };
  const closeOperatingDay = () => {
    if (!dayCloseReady) {
      setDayCloseError('Resolve every gate or record an owner and deadline for each intentional carryover.');
      return;
    }
    setOperatingDayClosed(true);
    setDayCloseError('');
    logAudit({ workspace: 'Command', action: 'Operating Day Closed', record: 'Sunday, August 31', summary: `${dayCloseGates.filter((gate) => gate.count === 0).length} gates source-ready · ${Object.keys(dayCloseCarryovers).length} owned carryovers.`, previous: 'Open operating day', next: 'Closed with attributable handoff', source: 'OpsCenter Control', result: 'Completed' });
  };
  const reopenOperatingDay = () => {
    setOperatingDayClosed(false);
    logAudit({ workspace: 'Command', action: 'Operating Day Reopened', record: 'Sunday, August 31', summary: 'Manager reopened the operating day for additional work.', previous: 'Closed', next: 'Open', source: 'OpsCenter Control', result: 'Needs review' });
  };
  const verificationSourceForWorkspace = (workspace: AuditWorkspace) => workspace === 'Schedule' ? 'JunkWare Schedule'
    : workspace === 'Krewe' ? 'JunkWare Attendance + Manager Record'
      : workspace === 'Fleet' ? 'LinxUp GPS + Fleet Record'
        : workspace === 'Marketing' ? 'Podium + JunkWare'
          : workspace === 'Finance' ? 'JunkWare + QBO'
            : 'OpsCenter Audit';
  const verificationSourceForAction = (item: ActionQueueItem) => item.verificationSource || verificationSourceForWorkspace(item.workspace);
  const manageActionQueueItem = (item: ActionQueueItem) => {
    setActionQueueDraft({ owner: item.owner, due: item.due, status: item.status, note: item.note, resolution: item.proposedResolution || '', verificationEvidence: item.verificationEvidence || '' });
    openRecordDrawer({ actionQueueId: item.id, kicker: `${item.workspace} · ${item.status}`, title: item.title, summary: item.detail, action: item.action, source: item.source, updated: item.due, facts: [] });
  };
  const linkedActionForAlert = (item: WorkItem) => actionQueue.find((actionItem) => actionItem.alertId === item.id);
  const alertWorkflowStatus = (item: WorkItem) => live ? ({ active: 'Active', acknowledged: 'Acknowledged', 'in-control': 'In Control', resolved: 'Resolved' } as const)[liveAlert(item)?.workflowState || 'active'] : alertOutcomes[item.id]
    ? 'Resolved'
    : linkedActionForAlert(item)
      ? 'In Control'
      : completed.includes(item.id)
        ? 'Acknowledged'
        : 'Active';
  const alertViewCounts: Record<AlertViewFilter, number> = {
    open: workItems.filter((item) => alertWorkflowStatus(item) !== 'Resolved').length,
    action: workItems.filter((item) => alertWorkflowStatus(item) === 'Active' && (!live || liveAlert(item)?.needsAction)).length,
    control: workItems.filter((item) => alertWorkflowStatus(item) === 'In Control').length,
    acknowledged: workItems.filter((item) => alertWorkflowStatus(item) === 'Acknowledged').length,
    resolved: workItems.filter((item) => alertWorkflowStatus(item) === 'Resolved').length,
    all: workItems.length,
  };
  const visibleCommandAlerts = visibleWork.filter((item) => {
    const status = alertWorkflowStatus(item);
    if (alertViewFilter === 'all') return true;
    if (alertViewFilter === 'open') return status !== 'Resolved';
    if (alertViewFilter === 'action') return status === 'Active' && (!live || liveAlert(item)?.needsAction);
    if (alertViewFilter === 'control') return status === 'In Control';
    if (alertViewFilter === 'acknowledged') return status === 'Acknowledged';
    return status === 'Resolved';
  });
  const openCommandKpi = (label: string) => {
    if (mutationBusyRef.current) { setActionFeedback('Wait for the current action result before opening another workspace.'); return; }
    setDrawer(null);
    setActionFeedback('');
    if (label === 'Completed jobs' || label === "Today’s jobs") {
      setActiveNav('Schedule');
      setScheduleDay('today');
      setOperatingDate(live?.snapshot.date || '2026-08-31');
      setCalendarDateDraft(live?.snapshot.date || '2026-08-31');
      setScheduleView('board');
      setScheduleScope('ALL');
      setScheduleStatusFilter(label === 'Completed jobs' ? 'completed' : 'all');
      setTerritoryPriority(null);
      return;
    }
    if (label === 'Active trucks' || label === 'Revenue / truck') {
      setActiveNav('Fleet');
      setFleetView(label === 'Revenue / truck' ? 'reports' : 'overview');
      return;
    }
    if (label === 'Profit / job' || label === 'Revenue plan') {
      setActiveNav('Finance');
      setFinanceView('overview');
      return;
    }
    setActiveNav('Krewe');
    setKreweView('today');
    setScheduleDay('today');
    setOperatingDate('2026-08-31');
    setCalendarDateDraft('2026-08-31');
  };
  const alertNeedsControl = (item: WorkItem) => alertWorkflowStatus(item) === 'Active';
  const addAlertToControl = (item: WorkItem) => {
    if (mutationBusyRef.current) return;
    if (live) {
      const alert = liveAlert(item);
      if (alert?.workflowState === 'in-control') { setActiveNav('Command'); setView('today'); return; }
      void live.onAlertAction(String(item.id), 'add_to_control').then(() => { setActiveNav('Command'); setView('today'); }); return;
    }
    const existing = linkedActionForAlert(item);
    if (existing) {
      setCompleted((items) => items.includes(item.id) ? items : [...items, item.id]);
      logAudit({ workspace: 'Command', action: 'Alert acknowledged in Control', record: item.title, summary: `Linked to ${existing.id} without creating a duplicate action.`, previous: 'Active alert', next: `${existing.id} · ${existing.status}`, source: item.source, result: 'Needs review', refId: existing.refId });
      manageActionQueueItem(existing);
      return;
    }
    const appointmentId = item.title.match(/JK\d{7}/)?.[0];
    const truckLabel = item.title.match(/Truck \d+/)?.[0];
    const workspace: AuditWorkspace = item.domain === 'Finance' ? 'Finance'
      : item.domain === 'Fleet' ? 'Fleet'
        : item.domain === 'Krewe' ? 'Krewe'
          : item.domain === 'Marketing' ? 'Marketing'
            : 'Schedule';
    const requiresApproval = item.priority === 'critical' || item.label === 'Cancellation' || workspace === 'Finance';
    const verification = item.label === 'New appointment'
      ? 'The appointment is assigned to a truck and visible in the correct operating-day route plan.'
      : item.label === 'On site'
        ? 'Arrival remains source-confirmed and the dispatch disposition is recorded.'
        : item.label === 'Cancellation'
          ? 'Released capacity is reassigned or explicitly recorded as intentionally open.'
          : item.label === 'Job closed'
            ? 'JunkWare totals and the recorded payment reconcile with an attributable correction if required.'
            : item.label === 'Photos uploaded'
              ? 'The complete photo batch remains verified in JunkWare with no outstanding closeout exception.'
              : 'The source record reflects the completed outcome and its verification evidence.';
    const actionItem: ActionQueueItem = {
      id: `AQ-${200 + Number(item.id)}`,
      workspace,
      priority: item.priority,
      title: item.context.replace(/\.$/, ''),
      detail: `${item.title} · ${item.detail}`,
      record: appointmentId || truckLabel || item.title,
      owner: item.owner,
      due: item.priority === 'critical' ? 'Now' : item.priority === 'warning' ? 'Before noon' : 'Today',
      source: `${item.source} alert · ${item.domain}`,
      action: item.action,
      status: 'Open',
      note: item.context,
      escalated: false,
      recommendation: item.context,
      approval: requiresApproval ? 'Pending approval' : 'Not required',
      verification,
      verificationSource: verificationSourceForWorkspace(workspace),
      refId: appointmentId,
      alertId: item.id,
    };
    setActionQueue((items) => [actionItem, ...items]);
    setCompleted((items) => items.includes(item.id) ? items : [...items, item.id]);
    logAudit({ workspace: 'Command', action: 'Alert added to Control', record: item.title, summary: `${actionItem.id} created with ${actionItem.owner} ownership and a verification requirement.`, previous: 'Active alert', next: `${actionItem.id} · ${actionItem.approval}`, source: item.source, result: 'Needs review', refId: appointmentId });
    manageActionQueueItem(actionItem);
  };
  const openActionSource = (item: ActionQueueItem) => {
    const nextStatus = item.approval === 'Pending approval' || item.status === 'Awaiting Verification' ? item.status : 'In Progress';
    setActionQueue((items) => items.map((entry) => entry.id === item.id ? { ...entry, status: nextStatus } : entry));
    logAudit({ workspace: item.workspace, action: 'Source record opened', record: item.record, summary: item.title, previous: item.status, next: nextStatus, source: item.source, result: 'Needs review', refId: item.refId });
    if (item.workspace === 'Schedule') {
      setActiveNav('Schedule'); setScheduleView('board'); setScheduleDay('today'); resetScheduleSelection();
      openRecordDrawer({ kicker: 'Action Queue · Schedule', title: item.title, summary: item.detail, action: item.action, source: item.source, updated: item.due, facts: [{ label: 'Owner', value: item.owner }, { label: 'Due', value: item.due }, { label: 'Record', value: item.record }] });
      return;
    }
    if (item.workspace === 'Krewe') {
      const member = kreweMembers.find((entry) => entry.id === item.refId);
      setActiveNav('Krewe'); setKreweView('today');
      if (member) openKreweMember(member);
      return;
    }
    if (item.workspace === 'Fleet') {
      const truck = fleetTruckRows.find((entry) => entry.id === item.refId);
      setActiveNav('Fleet'); setFleetView('overview');
      if (truck) openFleetTruck(truck);
      return;
    }
    if (item.workspace === 'Marketing') {
      const review = marketingReviews.find((entry) => entry.id === item.refId);
      setActiveNav('Marketing'); setMarketingView('reviews');
      if (review) openRecordDrawer({ kicker: `Action Queue · ${review.status}`, title: review.customer, summary: review.excerpt, action: 'Open review attribution', source: item.source, updated: item.due, facts: [{ label: 'Review', value: review.id }, { label: 'Proposed job', value: review.selectedAppointment }, { label: 'Owner', value: item.owner }] });
      return;
    }
    if (item.workspace === 'Finance') {
      const payment = financePayments.find((entry) => entry.id === item.refId);
      setActiveNav('Finance'); setFinanceView('payments');
      if (payment && openUnifiedJobRecord(payment.id, item.source, item.due)) return;
      if (payment) openRecordDrawer({ kicker: `Action Queue · ${payment.status}`, title: payment.id, summary: item.detail, action: 'Open payment reconciliation', source: item.source, updated: item.due, facts: [{ label: 'Job total', value: moneyValue(payment.jobTotal) }, { label: 'Captured payment', value: moneyValue(payment.paymentAmount) }, { label: 'Difference', value: moneyValue(payment.jobTotal - payment.paymentAmount) }, { label: 'Owner', value: item.owner }] });
      return;
    }
    setActiveNav('Command'); setView('now');
  };
  const saveActionQueueItem = () => {
    if (!activeActionQueueItem) return;
    if (!actionQueueDraft.owner.trim() || !actionQueueDraft.due.trim()) {
      setActionFeedback('Owner and deadline are required.');
      return;
    }
    if (['Waiting', 'Blocked'].includes(actionQueueDraft.status) && !actionQueueDraft.note.trim()) {
      setActionFeedback(`Add an operational note before marking this action ${actionQueueDraft.status.toLowerCase()}.`);
      return;
    }
    if (activeActionQueueItem.approval === 'Pending approval' && actionQueueDraft.status === 'In Progress') {
      setActionFeedback('Approve the recommendation before moving this action into progress.');
      return;
    }
    const previous = `${activeActionQueueItem.status} · ${activeActionQueueItem.owner} · ${activeActionQueueItem.due}`;
    const next = `${actionQueueDraft.status} · ${actionQueueDraft.owner.trim()} · ${actionQueueDraft.due.trim()}`;
    setActionQueue((items) => items.map((item) => item.id === activeActionQueueItem.id ? {
      ...item,
      owner: actionQueueDraft.owner.trim(),
      due: actionQueueDraft.due.trim(),
      status: actionQueueDraft.status,
      note: actionQueueDraft.note.trim(),
    } : item));
    logAudit({ workspace: activeActionQueueItem.workspace, action: 'Action handoff updated', record: activeActionQueueItem.record, summary: actionQueueDraft.note.trim() || activeActionQueueItem.title, previous, next, source: activeActionQueueItem.source, result: actionQueueDraft.status === 'Blocked' ? 'Needs review' : 'Completed', refId: activeActionQueueItem.refId });
    setActionFeedback('Owner, deadline, status, and operational note saved.');
  };
  const escalateActionQueueItem = () => {
    if (!activeActionQueueItem) return;
    setActionQueue((items) => items.map((item) => item.id === activeActionQueueItem.id ? { ...item, priority: 'critical', escalated: true } : item));
    logAudit({ workspace: activeActionQueueItem.workspace, action: 'Action escalated', record: activeActionQueueItem.record, summary: actionQueueDraft.note.trim() || activeActionQueueItem.title, previous: `${activeActionQueueItem.priority} · ${activeActionQueueItem.owner}`, next: `Urgent · Escalated · ${actionQueueDraft.owner || activeActionQueueItem.owner}`, source: activeActionQueueItem.source, result: 'Needs review', refId: activeActionQueueItem.refId });
    setActionFeedback('Escalated to urgent. The owner and source record remain attached.');
  };
  const approveActionQueueItem = () => {
    if (!activeActionQueueItem || activeActionQueueItem.approval !== 'Pending approval') return;
    setActionQueue((items) => items.map((item) => item.id === activeActionQueueItem.id ? { ...item, approval: 'Approved', status: 'In Progress' } : item));
    setActionQueueDraft((draft) => ({ ...draft, status: 'In Progress' }));
    logAudit({ workspace: activeActionQueueItem.workspace, action: 'Recommendation approved', record: activeActionQueueItem.record, summary: activeActionQueueItem.recommendation, previous: 'Pending approval', next: `Approved · ${activeActionQueueItem.owner}`, source: 'OpsBot Control', result: 'Completed', refId: activeActionQueueItem.refId });
    setActionFeedback('Recommendation approved. The action is now in progress and still requires verification.');
  };
  const rejectActionQueueItem = () => {
    if (!activeActionQueueItem || activeActionQueueItem.approval !== 'Pending approval') return;
    const reason = actionQueueDraft.note.trim();
    if (!reason) {
      setActionFeedback('Add an operational note explaining why the recommendation is being rejected.');
      return;
    }
    setActionQueue((items) => items.map((item) => item.id === activeActionQueueItem.id ? { ...item, approval: 'Rejected', status: 'Waiting', note: reason } : item));
    setActionQueueDraft((draft) => ({ ...draft, status: 'Waiting' }));
    logAudit({ workspace: activeActionQueueItem.workspace, action: 'Recommendation rejected', record: activeActionQueueItem.record, summary: reason, previous: 'Pending approval', next: 'Rejected · Alternate plan required', source: 'OpsBot Control', result: 'Needs review', refId: activeActionQueueItem.refId });
    setActionFeedback('Recommendation rejected. The action remains open for an alternate plan.');
  };
  const submitActionForVerification = () => {
    if (!activeActionQueueItem) return;
    if (activeActionQueueItem.approval === 'Pending approval') {
      setActionFeedback('Approve or reject the recommendation before submitting an outcome for verification.');
      return;
    }
    const resolution = actionQueueDraft.resolution.trim();
    if (!resolution) {
      setActionFeedback('Record the claimed outcome before submitting it for verification.');
      return;
    }
    const verificationSource = verificationSourceForAction(activeActionQueueItem);
    setActionQueue((items) => items.map((item) => item.id === activeActionQueueItem.id ? { ...item, status: 'Awaiting Verification', proposedResolution: resolution, verificationSource, verificationEvidence: '', verificationCheckedAt: undefined } : item));
    setActionQueueDraft((draft) => ({ ...draft, status: 'Awaiting Verification', verificationEvidence: '' }));
    logAudit({ workspace: activeActionQueueItem.workspace, action: 'Outcome submitted for verification', record: activeActionQueueItem.record, summary: resolution, previous: activeActionQueueItem.status, next: `Awaiting Verification · ${verificationSource}`, source: activeActionQueueItem.source, result: 'Needs review', refId: activeActionQueueItem.refId });
    setActionFeedback(`Outcome submitted. Verify it against ${verificationSource} before resolving the action.`);
  };
  const failActionVerification = () => {
    if (!activeActionQueueItem || activeActionQueueItem.status !== 'Awaiting Verification') return;
    const evidence = actionQueueDraft.verificationEvidence.trim();
    if (!evidence) {
      setActionFeedback('Record what failed verification before returning the action to progress.');
      return;
    }
    const verificationSource = verificationSourceForAction(activeActionQueueItem);
    setActionQueue((items) => items.map((item) => item.id === activeActionQueueItem.id ? { ...item, status: 'In Progress', verificationEvidence: evidence, verificationCheckedAt: '10:24 AM' } : item));
    setActionQueueDraft((draft) => ({ ...draft, status: 'In Progress' }));
    logAudit({ workspace: activeActionQueueItem.workspace, action: 'Verification failed', record: activeActionQueueItem.record, summary: evidence, previous: `Awaiting Verification · ${verificationSource}`, next: 'In Progress · Corrective work required', source: verificationSource, result: 'Needs review', refId: activeActionQueueItem.refId });
    setActionFeedback('Verification failed. The action is back In Progress with the failed check attached.');
  };
  const completeActionQueueItem = () => {
    if (!activeActionQueueItem) return;
    if (activeActionQueueItem.status !== 'Awaiting Verification') {
      setActionFeedback('Submit the claimed outcome for verification before resolving this action.');
      return;
    }
    const resolution = activeActionQueueItem.proposedResolution || actionQueueDraft.resolution.trim();
    const evidence = actionQueueDraft.verificationEvidence.trim();
    if (!evidence) {
      setActionFeedback('Verification evidence is required before resolving this action.');
      return;
    }
    const verificationSource = verificationSourceForAction(activeActionQueueItem);
    if (activeActionQueueItem.alertId) {
      setAlertOutcomes((outcomes) => ({ ...outcomes, [activeActionQueueItem.alertId!]: { actionId: activeActionQueueItem.id, resolution, source: verificationSource, evidence, time: '10:24 AM' } }));
      setCompleted((items) => items.includes(activeActionQueueItem.alertId!) ? items : [...items, activeActionQueueItem.alertId!]);
    }
    setActionQueue((items) => items.filter((item) => item.id !== activeActionQueueItem.id));
    logAudit({ workspace: activeActionQueueItem.workspace, action: 'Action verified', record: activeActionQueueItem.record, summary: `${resolution} Verification evidence: ${evidence}`, previous: `Awaiting Verification · ${activeActionQueueItem.owner}`, next: `Resolved · ${verificationSource} · 10:24 AM`, source: verificationSource, result: 'Completed', refId: activeActionQueueItem.refId });
    setDrawer(null);
  };

  return (
    <main className={live ? 'ops-app ops-live' : 'ops-app'}>
      <aside className="ops-sidebar">
        <div className="brand-lockup">
          <div className="brand-mark"><MapPin size={23} strokeWidth={2.3} /><span /></div>
          <div><strong>OpsCenter</strong><small>Junk King Louisiana</small></div>
        </div>

        <nav className="primary-nav" aria-label="Primary">
          <p className="nav-label">Workspaces</p>
          {(live ? nav.filter(item => item.label !== 'Finance' || canFinance).map(item => ({ ...item, count: item.label === 'Command' ? workItems.length : 0 })) : nav).map((item) => {
            const Icon = item.icon;
            return (
              <button key={item.label} className={activeNav === item.label ? 'nav-item active' : 'nav-item'} onClick={() => setActiveNav(item.label)}>
                <Icon size={17} /><span>{item.label}</span>{item.count ? <em>{item.count}</em> : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-footer">
          <button className={`health-pulse${sourceAttentionCount ? ' attention' : ''}`} onClick={openSourceHealth}><span />{sourceAttentionCount ? `${sourceAttentionCount} source needs attention` : live ? 'Source checks current' : 'All sources healthy'}</button>
          <div className="user-row"><div className="avatar">MC</div><div><strong>{live?.snapshot.actor.displayName || 'Mission Control'}</strong><small>{live?.snapshot.actor.role || 'Administrator'}</small></div></div>
        </div>
      </aside>

      <section className="ops-content">
        {live && <nav className="live-mobile-navigation" aria-label="Mobile workspaces"><label>Workspace<select aria-label="Choose workspace" value={activeNav} disabled={mutationBusy} onChange={event => setActiveNav(event.target.value)}>{nav.filter(item => item.label !== 'Finance' || canFinance).map(item => <option key={item.label}>{item.label}</option>)}</select></label></nav>}
        <header className="topbar">
          {live ? <LiveSearch date={live.snapshot.date} navigate={setActiveNav} disabled={mutationBusy} finance={canFinance} /> : <div className="global-search-shell">
            {searchOpen && <button className="global-search-backdrop" aria-label="Close search" onClick={closeGlobalSearch} />}
            <div className={`global-search${searchOpen ? ' active' : ''}`}>
              <Search size={17} />
              <Input ref={searchInputRef} value={query} onFocus={() => { setSearchOpen(true); setNotificationOpen(false); setOperatingDayOpen(false); }} onChange={(event) => { setQuery(event.target.value); setSearchOpen(true); setNotificationOpen(false); setOperatingDayOpen(false); }} onKeyDown={(event) => { if (event.key !== 'Enter') return; if (visibleLauncherCommands[0]) runLauncherCommand(visibleLauncherCommands[0].id); else if (globalSearchResults[0]) openGlobalSearchResult(globalSearchResults[0]); }} placeholder="Search records or run a command" aria-label="Search records or run an OpsCenter command" aria-expanded={searchOpen} aria-controls="global-search-results" />
              {query ? <button className="global-search-clear" aria-label="Clear search" onClick={() => { setQuery(''); searchInputRef.current?.focus(); }}><X size={14} /></button> : <kbd>/</kbd>}
            </div>
            {searchOpen && <section className="global-search-panel" id="global-search-results" role="dialog" aria-label="OpsCenter launcher">
              <header><div><span>OpsCenter Launcher</span><strong>{query.trim() ? `${visibleLauncherCommands.length + globalSearchResults.length} match${visibleLauncherCommands.length + globalSearchResults.length === 1 ? '' : 'es'} across commands and records` : 'Run a command or find a record'}</strong></div><small>Press Enter to open the first match</small></header>
              {visibleLauncherCommands.length || globalSearchResults.length ? <div className="global-search-results-body">
                {visibleLauncherCommands.length > 0 && <section className="launcher-command-group"><header><strong>{query.trim() ? 'Matching Commands' : 'Quick Actions'}</strong><span>{visibleLauncherCommands.length}</span></header><div className="launcher-command-grid">{visibleLauncherCommands.map((command) => { const LauncherIcon = command.icon; return <button onClick={() => runLauncherCommand(command.id)} key={command.id}><i><LauncherIcon size={15} /></i><div><strong>{command.label}</strong><small>{command.description}</small></div><span>{command.workspace}</span><ArrowRight size={14} /></button>; })}</div></section>}
                {query.trim().length < 2 && <div className="global-search-record-hint"><Search size={15} /><div><strong>Find Any Operating Record</strong><span>Type a customer, territory, area, JK number, Krewe member, truck, lead, payment, resale item, or recycling record.</span></div></div>}
                {globalSearchResults.length > 0 && <div className="global-search-groups">{(['Customers', 'Schedule', 'Krewe', 'Fleet', 'Marketing', 'Finance'] as const).map((group) => { const groupResults = globalSearchResults.filter((result) => result.group === group); if (!groupResults.length) return null; return <section className="global-search-group" key={group}><header><strong>{group}</strong><span>{groupResults.length}</span></header><div>{groupResults.map((result) => <button onClick={() => openGlobalSearchResult(result)} key={result.key}><i>{group.slice(0, 1)}</i><div><strong>{result.title}</strong><span>{result.subtitle}</span><small>{result.context}</small></div><div className="global-search-result-state"><strong>{result.status}</strong><small>{result.source}</small></div><ArrowRight size={15} /></button>)}</div></section>; })}</div>}
              </div> : <div className="global-search-empty"><Search size={22} /><strong>No commands or records found</strong><p>Try a JK number, customer surname, truck, workspace, or action such as payment reconciliation.</p></div>}
              <footer><span><kbd>↵</kbd> Run first match</span><span><kbd>Esc</kbd> Close and clear</span><strong>Actions open the authoritative workspace</strong></footer>
            </section>}
          </div>
          }
          <div className="topbar-actions">
            <div className="notification-center">
              {notificationOpen && <button className="notification-backdrop" aria-label="Close alerts" onClick={() => setNotificationOpen(false)} />}
              <Button className="notification-trigger" variant="outline" size="lg" aria-label={live && !live.snapshot.sources.alerts ? 'Alert count unavailable' : `${activeAlerts.length} active alerts`} aria-expanded={notificationOpen} aria-controls="notification-panel" onClick={() => { setNotificationOpen((open) => !open); setSearchOpen(false); setOperatingDayOpen(false); setQuery(''); }}><Bell size={16} />{activeAlerts.length > 0 && <><span className="notification-dot" /><b>{activeAlerts.length}</b></>}</Button>
              {notificationOpen && <aside className="notification-panel" id="notification-panel" role="dialog" aria-label="Alerts">
                <header><div><span>Slack source · OpsCenter format</span><strong>Alerts</strong><small>{activeAlerts.length} active · Essential operating information</small></div><button onClick={() => { setActiveNav('Command'); setView('now'); setNotificationOpen(false); }}>Open Command <ArrowRight size={14} /></button></header>
                {activeAlerts.length ? <div className="notification-list">{activeAlerts.map((item) => { const linkedAction = linkedActionForAlert(item); return <article className={`notification-alert ${item.priority}`} key={item.id}><i className={`priority-mark ${item.priority}`} /><button className="notification-alert-open" onClick={() => openAlertRecord(item)}><div><span className={`notification-priority ${item.priority}`}>{item.label}</span><small>{item.domain} · {item.detected}</small><span className={`alert-workflow-status ${linkedAction ? 'in-control' : 'active'}`}>{linkedAction ? 'In Control' : 'Active'}</span></div><strong>{item.title}</strong><p>{item.detail}</p><footer><span>Owner · {item.owner}</span><b>{item.context}</b></footer></button><div className="notification-alert-controls"><button disabled={mutationBusy} onClick={() => { if (!mutationBusyRef.current) acknowledgeAlert(item); }}>Acknowledge</button><button className="primary" disabled={mutationBusy} onClick={() => { if (!mutationBusyRef.current) addAlertToControl(item); }}>{linkedAction ? 'Manage Action' : 'Add to Control'}</button></div></article>; })}</div>
                  : <div className="notification-empty">{live && !live.snapshot.sources.alerts ? <><Activity size={22} /><strong>Slack alerts unavailable</strong><p>Active alert counts are unknown until the source refreshes.</p></> : <><Check size={22} /><strong>No active alerts</strong><p>Acknowledged and resolved alerts remain visible on Command.</p></>}</div>}
                <footer><span><ShieldCheck size={13} />Source and ownership stay attached</span><button onClick={() => { setActiveNav('Command'); setView('now'); setNotificationOpen(false); }}>View All Alerts</button></footer>
              </aside>}
            </div>
            <div className="live-chip"><span />{live ? 'Command checked · ' + new Date(live.snapshot.generatedAt).toLocaleTimeString('en-US', {timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'}) : 'Live · 10:24 AM'}</div>
            {live ? <div className="operating-day-center"><label className="operating-day-trigger"><CalendarDays size={14} /><input aria-label="Choose operating day" type="date" disabled={mutationBusy} value={activeNav === 'Schedule' ? dateForDay(live.snapshot.date, scheduleDay) : live.snapshot.date} onChange={event => { if (event.target.value) live.onDateChange(event.target.value, activeNav); }} /></label></div> : <div className="operating-day-center">
              {operatingDayOpen && <button className="operating-day-backdrop" aria-label="Close operating day" onClick={() => setOperatingDayOpen(false)} />}
              <Button className="operating-day-trigger" variant="outline" size="lg" aria-label="Choose operating day" aria-expanded={operatingDayOpen} aria-controls="operating-day-panel" onClick={() => { setOperatingDayOpen((open) => !open); setSearchOpen(false); setNotificationOpen(false); setQuery(''); }}><CalendarDays size={14} />{operatingDateLabel}</Button>
              {operatingDayOpen && <aside className="operating-day-panel" id="operating-day-panel" role="dialog" aria-label="Operating day">
                <header><div><span>Operating Context</span><strong>Today and Tomorrow</strong><small>Live work and planning remain separate.</small></div></header>
                <div className="operating-day-options">
                  <article className={scheduleDay === 'today' ? 'active' : ''}>
                    <header><div><span>Sunday, August 31</span><strong>Today</strong><small>Live operating day</small></div><i>Live</i></header>
                    <dl><div><dt>Appointments</dt><dd>{scheduleDayCounts.today}</dd></div><div><dt>Working Krewe</dt><dd>{workingKrewe.length}</dd></div><div><dt>Active Alerts</dt><dd>{activeAlerts.length}</dd></div></dl>
                    <footer><button onClick={() => openOperatingContext('today', 'Schedule')}>Open Live Schedule <ArrowRight size={13} /></button><button onClick={() => openOperatingContext('today', 'Krewe')}>Open Today’s Krewe</button></footer>
                  </article>
                  <article className={scheduleDay === 'tomorrow' ? 'active' : ''}>
                    <header><div><span>Monday, September 1</span><strong>Tomorrow</strong><small>Planning context</small></div><i>Plan</i></header>
                    <dl><div><dt>Appointments</dt><dd>{scheduleDayCounts.tomorrow}</dd></div><div><dt>Call-In Candidates</dt><dd>{callInCandidates.length}</dd></div><div><dt>Needs Confirmation</dt><dd>{callInCandidates.filter((candidate) => candidate.status !== 'Confirmed').length}</dd></div></dl>
                    <footer><button onClick={() => openOperatingContext('tomorrow', 'Schedule')}>Open Planning Board <ArrowRight size={13} /></button><button onClick={() => openOperatingContext('tomorrow', 'Krewe')}>Open Call-In Plan</button></footer>
                  </article>
                </div>
                <section className="operating-calendar-picker">
                  <div><span>Calendar Day</span><strong>Choose Another Date</strong><small>August archive · Sep 1 planning</small></div>
                  <label><CalendarDays size={14} /><input type="date" min="2026-08-01" max="2026-09-01" value={calendarDateDraft} onChange={(event) => setCalendarDateDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') openCalendarDate(event.currentTarget.value); }} aria-label="Select calendar day" /></label>
                  <button onClick={(event) => openCalendarDate(event.currentTarget.parentElement?.querySelector<HTMLInputElement>('input[type="date"]')?.value)}>Open Date <ArrowRight size={13} /></button>
                </section>
                <footer><ShieldCheck size={13} /><span>Finance and Marketing keep their own reporting periods.</span></footer>
              </aside>}
            </div>
          }
          </div>
        </header>

        <div className={activeNav === 'Schedule' ? 'workspace schedule-mode' : 'workspace'}>
          <div className="workspace-heading" onClickCapture={event => { if (mutationBusyRef.current) { event.preventDefault(); event.stopPropagation(); } }}>
            <div>
              <span className="eyebrow">{live ? operatingDateHeading : activeNav === 'Schedule' && scheduleView === 'calendar'
                ? selectedCalendarDate.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })
                : activeNav === 'Schedule' && scheduleDay === 'tomorrow' ? 'Monday, September 1' : operatingDateHeading}</span>
              <h1>{activeNav}</h1>
              <p>{activeNav === 'Schedule'
                ? scheduleView === 'calendar' ? 'Review appointment volume, territory coverage, and archived operating days.'
                  : scheduleDay === 'today' ? 'Live truck assignments, appointment windows, and open capacity.' : 'Build tomorrow’s routes before the operating day begins.'
                : activeNav === 'Krewe' ? kreweView === 'today'
                  ? 'Attendance, production, earnings, driving, assignments, and manager actions.'
                  : kreweView === 'callin' ? 'Plan tomorrow’s coverage and record each availability decision.'
                    : kreweView === 'payperiod' ? 'Reconcile hours, production, earnings, and exceptions across the current pay period.'
                      : 'Review monthly labor, production, payroll, and individual performance.'
                : activeNav === 'Fleet' ? fleetView === 'overview'
                  ? 'Vehicle readiness, live work, load status, service risk, and next actions.'
                  : fleetView === 'maintenance' ? 'Daily inspections and repair work orders with accountable ownership.'
                    : fleetView === 'service' ? 'Mileage and date-based preventive-service planning by truck.'
                      : 'Monthly production, driving, downtime, and fleet cost signals.'
                : activeNav === 'Marketing' ? marketingView === 'overview'
                  ? 'Lead recovery, review attribution, booking performance, and immediate marketing actions.'
                  : marketingView === 'leads' ? 'Recover SearchKings leads with contact context, quoted value, and outcome controls.'
                    : marketingView === 'reviews' ? 'Confirm or reassign each review to a completed JunkWare appointment.'
                      : 'Compare calls, qualified demand, bookings, completed jobs, revenue, and acquisition cost.'
                : activeNav === 'Finance' ? financeView === 'overview'
                  ? 'See month-to-date performance, today’s numbers, and the daily close in one operating view.'
                  : financeView === 'payments' ? 'Review every job payment and reconcile differences without losing source detail.'
                    : financeView === 'resale' ? 'Manage resale custody, listing status, disposition, and realized value.'
                      : financeView === 'recycling' ? 'Track recycling loads, yard tickets, payments, and realized value.'
                        : 'Compare exact calendar months and year-to-date operating performance.'
                  : view === 'now' ? 'Live Slack alerts, organized by urgency and operational area.'
                    : view === 'today' ? 'Resolve today’s operating gaps with ownership, approval, source context, and verified outcomes.'
                      : 'Watch operational trends and emerging risks; system health remains supporting context.'}</p>
            </div>
            {activeNav === 'Command' ? (
              <div className="view-switcher workspace-tabs" role="tablist" aria-label="Command views">
                <button onClick={() => setView('now')} className={view === 'now' ? 'active' : ''}>Alerts <span>{live && !live.snapshot.sources.alerts ? '—' : activeAlerts.length}</span></button>
                <button onClick={() => setView('today')} className={view === 'today' ? 'active' : ''}>Control</button>
                <button onClick={() => setView('monitor')} className={view === 'monitor' ? 'active' : ''}>Monitor</button>
              </div>
            ) : activeNav === 'Schedule' ? (
              <div className="schedule-heading-actions">
                <div className="schedule-view-switcher workspace-tabs" role="tablist" aria-label="Schedule views">
                  <button className={scheduleView === 'board' ? 'active' : ''} onClick={() => setScheduleView('board')}>Board <span>{live ? liveScheduleCounts[scheduleDay] : scheduledAppointments.length}</span></button>
                  <button className={scheduleView === 'calendar' ? 'active' : ''} onClick={() => setScheduleView('calendar')}>Calendar</button>
                  <button className={scheduleView === 'followup' ? 'active' : ''} onClick={() => setScheduleView('followup')}>Follow-Up {!live && <span>{activeFollowups.length}</span>}</button>
                  <button className={scheduleView === 'history' ? 'active' : ''} onClick={() => setScheduleView('history')}>History {!live && <span>{scheduleDayHistory.length}</span>}</button>
                </div>
              </div>
            ) : activeNav === 'Krewe' ? (
              <div className="krewe-heading-actions">
                <div className="krewe-view-switcher workspace-tabs" role="tablist" aria-label="Krewe views">
                  {([
                    ['today', 'Today'], ['callin', 'Call-in plan'], ['payperiod', 'Pay period'], ['monthly', 'Monthly'],
                  ] as const).map(([key, label]) => <button className={kreweView === key ? 'active' : ''} onClick={() => { setKreweView(key); if (key === 'today') changeScheduleDay('today'); if (key === 'callin') changeScheduleDay('tomorrow'); }} role="tab" aria-selected={kreweView === key} key={key}>{label}{!live && key === 'today' && <span>{live ? '—' : workingKrewe.length}</span>}</button>)}
                </div>
              </div>
            ) : activeNav === 'Fleet' ? (
              <div className="fleet-heading-actions">
                <div className="fleet-view-switcher workspace-tabs" role="tablist" aria-label="Fleet views">
                  {([['overview', 'Overview'], ['maintenance', 'Maintenance'], ['service', 'Service'], ['reports', 'Reports']] as const).map(([key, label]) => <button className={fleetView === key ? 'active' : ''} onClick={() => setFleetView(key)} role="tab" aria-selected={fleetView === key} key={key}>{label}{!live && key === 'maintenance' && <span>{activeFleetIssues.length}</span>}</button>)}
                </div>
              </div>
            ) : activeNav === 'Marketing' ? (
              <div className="marketing-heading-actions">
                <div className="marketing-view-switcher workspace-tabs" role="tablist" aria-label="Marketing views">
                  {([['overview', 'Overview'], ['leads', 'Lead Recovery'], ['reviews', 'Reviews'], ['performance', 'Performance']] as const).map(([key, label]) => <button className={marketingView === key ? 'active' : ''} onClick={() => { setMarketingView(key); setActionFeedback(''); }} role="tab" aria-selected={marketingView === key} key={key}>{label}{!live && key === 'leads' && marketingRecoveryLeads.length > 0 && <span>{marketingRecoveryLeads.length}</span>}{!live && key === 'reviews' && marketingReviewCount > 0 && <span>{marketingReviewCount}</span>}</button>)}
                </div>
              </div>
            ) : activeNav === 'Finance' ? (
              <div className="finance-heading-actions">
                <div className="finance-view-switcher workspace-tabs" role="tablist" aria-label="Finance views">
                  {([['overview', 'Overview'], ['payments', 'Payments'], ['resale', 'Resale'], ['recycling', 'Recycling'], ['trends', 'Trends']] as const).map(([key, label]) => <button className={financeView === key ? 'active' : ''} onClick={() => { setFinanceView(key); setActionFeedback(''); }} role="tab" aria-selected={financeView === key} key={key}>{label}{!live && key === 'overview' && financeCloseSteps.length < 6 && <span>{6 - financeCloseSteps.length}</span>}{!live && key === 'payments' && financeDifference > 0 && <span>{financePayments.filter((payment) => payment.status !== 'Matched').length}</span>}{key === 'resale' && financeResaleAttention > 0 && <span>{financeResaleAttention}</span>}{key === 'recycling' && financeRecyclingAttention > 0 && <span>{financeRecyclingAttention}</span>}</button>)}
                </div>
              </div>
            ) : null}
          </div>

          {live?.error && <p className="appointment-create-error" role="alert">{live.error}</p>}

          {activeNav === 'Command' && <section className="metric-strip" aria-label="Today at a glance">
            {commandKpiRows.map((kpi) => (
              <button type="button" className={`kpi-card ${kpi.tone}`} disabled={mutationBusy} onClick={() => openCommandKpi(kpi.label)} aria-label={`Open ${kpi.label} details`} key={kpi.label}>
                <div className="kpi-heading"><span>{kpi.label}</span><span className="kpi-card-affordance"><i className={`kpi-dot ${kpi.tone}`} /><ArrowRight size={12} /></span></div>
                <strong>{kpi.value}</strong>
                <div className="kpi-meter" role="progressbar" aria-label={`${kpi.label}: ${kpi.detail}`} aria-valuenow={kpi.progress} aria-valuemin={0} aria-valuemax={100}>
                  {kpi.segments ? kpi.segments.map((segment) => (
                    <i key={segment.label} className={segment.tone} style={{ width: `${segment.value}%` }} title={`${segment.label}: ${segment.value}%`} />
                  )) : <i className={kpi.tone} style={{ width: `${kpi.progress}%` }} />}
                </div>
                <small>{kpi.detail}</small>
              </button>
            ))}
          </section>}

          {activeNav === 'Command' && view === 'now' && live && <Button variant="outline" size="sm" onClick={()=>{setAlertViewFilter('action');requestAnimationFrame(()=>document.getElementById('live-alert-list')?.scrollIntoView({behavior:'auto',block:'start'}));}}>Jump to Needs Action</Button>}
          {activeNav === 'Command' && view === 'now' && live && <CommandMap date={live.snapshot.date} busy={mutationBusy} report={setActionFeedback} onBusyChange={onBusyChange} openSchedule={() => { if (mutationBusyRef.current) return; setScheduleDay('today'); setScheduleView('board'); setActiveNav('Schedule'); }} />}

          {activeNav === 'Command' && view === 'now' && (
            <div className="command-grid">
              <section className="work-panel">
                <div className="section-title">
                  <div><span className="section-kicker">{live && !live.snapshot.sources.alerts ? 'Slack source unavailable · alert counts unknown' : `${alertViewCounts.open} unresolved · ${visibleCommandAlerts.length} shown`}</span><h2 id="live-alert-list">Alerts</h2></div>
                  <Button variant="ghost" size="sm" onClick={() => { setAlertViewFilter('all'); setQuery(''); }}>View All Alerts <ArrowRight /></Button>
                </div>
                <div className="alert-triage-bar" role="toolbar" aria-label="Filter alerts by workflow state">
                  <span>Workflow State</span>
                  <div>
                    {([['open', 'Open'], ['action', 'Needs Action'], ['control', 'In Control'], ['acknowledged', 'Acknowledged'], ['resolved', 'Resolved'], ['all', 'All']] as Array<[AlertViewFilter, string]>).map(([filter, label]) => (
                      <button className={alertViewFilter === filter ? 'active' : ''} aria-pressed={alertViewFilter === filter} onClick={() => setAlertViewFilter(filter)} key={filter}>{label}<b>{live && !live.snapshot.sources.alerts ? '—' : alertViewCounts[filter]}</b></button>
                    ))}
                  </div>
                </div>
                <div className="work-list">
                  {visibleCommandAlerts.length ? visibleCommandAlerts.map((item) => { const linkedAction = linkedActionForAlert(item); const outcome = alertOutcomes[item.id]; const workflowStatus = alertWorkflowStatus(item); const briefFacts = item.facts.filter(fact => /^(customer|total|arrival|reason|context)$/i.test(fact.label)).slice(0, 2); return (
                    <article key={item.id} className={`work-row ${workflowStatus.toLowerCase().replaceAll(' ', '-')}`}>
                      <span className={`priority-mark ${item.priority}`} />
                      <div className="alert-card-main">
                        <div className="alert-card-heading">
                          <div className="work-copy">
                            <div className="work-meta"><Badge variant="outline" className={`priority-badge ${item.priority}`}>{item.label}</Badge><span>{item.domain}</span><span>·</span><span>{item.detected}</span><span className={`alert-workflow-status ${workflowStatus.toLowerCase().replaceAll(' ', '-')}`}>{workflowStatus}</span></div>
                            <h3>{renderLinkedJkText(item.title, item.source, item.detected)}</h3>
                          </div>
                          <div className="alert-card-actions">
                            {!completed.includes(item.id) && !outcome && (!live || liveAlert(item)?.workflowState === 'active' || liveAlert(item)?.workflowState === 'in-control') && <Button variant="outline" size="sm" disabled={Boolean(live && (!live.snapshot.sources.workflow || live.pendingAlertId))} onClick={() => acknowledgeAlert(item)}>Acknowledge</Button>}
                            <Button variant={live || outcome ? 'outline' : 'default'} size="sm" disabled={Boolean(outcome || (live && (!live.snapshot.sources.workflow || live.pendingAlertId || liveAlert(item)?.workflowState === 'resolved')))} onClick={() => addAlertToControl(item)}>{outcome || liveAlert(item)?.workflowState === 'resolved' ? 'Resolved' : linkedAction || liveAlert(item)?.workflowState === 'in-control' ? 'Manage Action' : 'Add to Control'} {outcome ? <Check /> : <ArrowRight />}</Button>
                            {!live && <Button variant="ghost" size="sm" onClick={() => openAlertRecord(item)}>Open Source</Button>}
                          </div>
                        </div>
                        {live && <p className="live-alert-summary">{(briefFacts.length ? briefFacts : item.facts.slice(0, 1)).map(fact => `${fact.label}: ${fact.value}`).join(' · ') || item.context}</p>}
                        <details className="live-alert-details" open={live ? undefined : true}>
                        {live && <summary>Details</summary>}
                        <div className="inline-alert-facts" aria-label={`${item.label} details`}>
                          {item.facts.map((fact) => (
                            <div key={fact.label}>
                              <span>{fact.label}</span>
                              {fact.label.toLowerCase().includes('address') ? <GoogleMapsAddress address={fact.value} /> : fact.label.toLowerCase().includes('phone') ? <PhoneContact phone={fact.value} /> : /^JK\d{7}$/.test(fact.value) ? renderJkLink(fact.value, item.source, item.detected) : fact.href ? <a href={fact.href}>{fact.value}</a> : <strong>{renderLinkedJkText(fact.value, item.source, item.detected)}</strong>}
                            </div>
                          ))}
                          {outcome && <div><span>Evidence</span><strong>{outcome.evidence}</strong></div>}
                          {live && <div><Button variant="ghost" size="sm" onClick={() => openAlertRecord(item)}>Open Source</Button></div>}
                          <div><span>Owner</span><strong>{item.owner}</strong></div>
                          <div className="next-step"><span>{outcome ? 'Verified' : 'Next'}</span><strong>{outcome?.resolution || item.context}</strong>{outcome && <em>{outcome.source} · {outcome.time}</em>}</div>
                        </div>
                        </details>
                      </div>
                    </article>
                  ); }) : <div className="empty-state">{live && !live.snapshot.sources.alerts ? <><Activity size={22} /><strong>Slack alerts unavailable</strong><span>Alert counts are unknown until the source refreshes. This does not confirm that there are no alerts.</span></> : <><Check size={22} /><strong>No alerts in this view</strong><span>Choose another workflow state or clear the search.</span></>}</div>}
                </div>
              </section>
            </div>
          )}

          {activeNav === 'Command' && view === 'today' && !live && (
            <div className="run-grid control-workspace">
              <section className="control-summary-strip" aria-label="Control status">
                <button onClick={() => setActionQueueFilter('all')} className={actionQueueFilter === 'all' ? 'active' : ''}><span>Open Actions</span><strong>{actionQueue.length}</strong><small>Across all workspaces</small></button>
                <button onClick={() => setActionQueueFilter('urgent')} className={`urgent${actionQueueFilter === 'urgent' ? ' active' : ''}`}><span>Urgent</span><strong>{urgentActionCount}</strong><small>Immediate ownership</small></button>
                <button onClick={() => setActionQueueFilter('approval')} className={`approval${actionQueueFilter === 'approval' ? ' active' : ''}`}><span>Awaiting Approval</span><strong>{pendingApprovalCount}</strong><small>Manager decision required</small></button>
                <article><span>In Progress</span><strong>{inProgressActionCount}</strong><small>Action underway</small></article>
                <button onClick={() => setActionQueueFilter('verification')} className={`verification${actionQueueFilter === 'verification' ? ' active' : ''}`}><span>Awaiting Verification</span><strong>{awaitingVerificationCount}</strong><small>Source check required</small></button>
                <article className="verified"><span>Verified Today</span><strong>{verifiedActionCount}</strong><small>Audited outcomes</small></article>
              </section>
              <section className={`start-day-panel${operatingDayStarted ? ' started' : startDayReady ? ' ready' : ' blocked'}`} id="start-of-day-readiness">
                <header className="start-day-heading">
                  <div><span className="section-kicker">Sunday, August 31 · {startDayClearedGateCount} of {dayStartGates.length} gates cleared</span><h2>Start-of-Day Readiness</h2><p>Confirm the live plan, equipment, people, carryovers, and critical alerts before releasing the operation.</p></div>
                  <div className="start-day-heading-actions">
                    <Badge variant="outline" className={`start-day-badge${operatingDayStarted ? ' started' : startDayReady ? ' ready' : ' blocked'}`}>{operatingDayStarted ? `Started · ${operatingDayStartedAt}` : startDayReady ? 'Ready to Start' : `${startDayBlockingGateCount} Blocking`}</Badge>
                    {operatingDayStarted
                      ? <Button variant="outline" size="sm" onClick={reopenDayStartReadiness}>Reopen Readiness</Button>
                      : <Button size="sm" disabled={!startDayReady} onClick={beginOperatingDay}>{startDayReady && startDayOwnedExceptionCount ? `Begin With ${startDayOwnedExceptionCount} Owned Exceptions` : 'Begin Operating Day'} <Play /></Button>}
                  </div>
                </header>
                <div className="start-day-meter" role="progressbar" aria-label={`${startDayClearedGateCount} of ${dayStartGates.length} start-of-day gates cleared`} aria-valuenow={startDayClearedGateCount} aria-valuemin={0} aria-valuemax={dayStartGates.length}><i style={{ width: `${startDayProgress}%` }} /></div>
                <div className="start-day-gates">
                  {dayStartGates.map((gate, index) => {
                    const state = gate.count === 0 ? 'ready' : gate.owned ? 'owned' : 'blocked';
                    return (
                      <article className={state} key={gate.id}>
                        <header><i>{state === 'ready' ? <Check size={12} /> : index + 1}</i><span>{state === 'ready' ? 'Source Ready' : state === 'owned' ? 'Owned Exception' : 'Needs Ownership'}</span></header>
                        <div className="start-day-gate-title"><div><strong>{gate.title}</strong><small>{gate.source}</small></div><b>{gate.count}<em>{gate.unit}</em></b></div>
                        <p>{gate.detail}</p>
                        <footer>
                          <button onClick={() => reviewDayStartGate(gate.id)}>{gate.reviewLabel}</button>
                          {state === 'blocked' && <button className="own" onClick={() => addDayStartGateToDecisions(gate)}>Add to Decisions</button>}
                          {state === 'owned' && <button className="owned" onClick={() => { setActionQueueFilter('all'); scrollToControlPanel('operating-decisions'); }}>{gate.owner} · {gate.due}</button>}
                        </footer>
                      </article>
                    );
                  })}
                </div>
                <footer className="start-day-note"><ShieldCheck size={13} /><span>Source-ready gates are clean. Owned exceptions remain visible in Operating Decisions with accountable follow-through.</span>{!operatingDayStarted && !startDayReady && <strong>Operating-day start remains unavailable.</strong>}</footer>
              </section>
              <section className="activity-panel closeout-queue-panel" id="closeout-queue">
                <div className="section-title closeout-queue-title">
                  <div><span className="section-kicker">{closeoutQueueItems.length} open · {closeoutJobCount} Jobs · {closeoutEstimateCount} Estimates</span><h2>Closeout Queue</h2><p>Job reconciliation and Estimate outcomes stay distinct, with the next action visible in the row.</p></div>
                  <div className="closeout-queue-filters" role="group" aria-label="Filter closeout queue">
                    <button className={closeoutQueueFilter === 'all' ? 'active' : ''} onClick={() => setCloseoutQueueFilter('all')}>All <span>{closeoutQueueItems.length}</span></button>
                    <button className={closeoutQueueFilter === 'jobs' ? 'active' : ''} onClick={() => setCloseoutQueueFilter('jobs')}>Jobs <span>{closeoutJobCount}</span></button>
                    <button className={closeoutQueueFilter === 'estimates' ? 'active' : ''} onClick={() => setCloseoutQueueFilter('estimates')}>Estimates <span>{closeoutEstimateCount}</span></button>
                    <button className={`urgent${closeoutQueueFilter === 'urgent' ? ' active' : ''}`} onClick={() => setCloseoutQueueFilter('urgent')}>Urgent <span>{closeoutUrgentCount}</span></button>
                  </div>
                </div>
                <div className="closeout-queue-scroll">
                  <div className="closeout-queue-head" aria-hidden="true"><span>Category</span><span>Appointment</span><span>Route</span><span>Amount</span><span>Exception and Required Result</span><span>Owner</span><span>Due</span><span>Actions</span></div>
                  <div className="closeout-queue-list">
                    {visibleCloseoutQueueItems.map((item) => {
                      const linkedDecision = linkedDecisionForCloseout(item);
                      return (
                        <article className={item.priority} key={item.id}>
                          <span className={`closeout-category ${item.category.toLowerCase()}`}>{item.category}</span>
                          <div className="closeout-appointment"><strong>{renderJkLink(item.appointmentId, item.source, item.due)}</strong><small>{item.customer}</small></div>
                          <div className="closeout-route"><strong>{item.truck}</strong><small>{item.window}</small></div>
                          <strong className="closeout-amount">{item.amount}</strong>
                          <div className="closeout-exception"><strong>{item.exception}</strong><span>{item.detail}</span><small>{item.source}</small></div>
                          <div className="closeout-owner"><strong>{linkedDecision?.owner || item.owner}</strong><small>{linkedDecision?.status || 'Queue Only'}</small></div>
                          <time>{linkedDecision?.due || item.due}</time>
                          <div className="closeout-row-actions"><button className="primary" onClick={() => openCloseoutQueueItem(item)}>{item.primaryAction}</button><button onClick={() => addCloseoutToDecisions(item)}>{linkedDecision ? 'Manage Decision' : 'Add to Decisions'}</button></div>
                        </article>
                      );
                    })}
                    {!visibleCloseoutQueueItems.length && <div className="closeout-queue-empty"><Check size={18} /><strong>No matching closeouts</strong><span>Nothing in this category currently needs an operating action.</span></div>}
                  </div>
                </div>
                <footer className="closeout-queue-note"><ShieldCheck size={13} /><span>Closing an Estimate never adds completed-job revenue. Job revenue remains pending until its source records reconcile.</span></footer>
              </section>
              <section className="activity-panel action-queue-panel control-action-queue" id="operating-decisions">
                <div className="section-title action-queue-title">
                  <div><span className="section-kicker">{actionQueue.length} open · {pendingApprovalCount} awaiting approval · {awaitingVerificationCount} awaiting verification</span><h2>Operating Decisions</h2><p>Resolve each gap from source context through approval and verification.</p></div>
                  <div className="action-queue-filters" aria-label="Filter action queue">
                    <button className={actionQueueFilter === 'all' ? 'active' : ''} onClick={() => setActionQueueFilter('all')}>All <span>{actionQueue.length}</span></button>
                    <button className={actionQueueFilter === 'urgent' ? 'active' : ''} onClick={() => setActionQueueFilter('urgent')}>Urgent <span>{urgentActionCount}</span></button>
                    <button className={actionQueueFilter === 'approval' ? 'active' : ''} onClick={() => setActionQueueFilter('approval')}>Approval <span>{pendingApprovalCount}</span></button>
                    <button className={actionQueueFilter === 'verification' ? 'active' : ''} onClick={() => setActionQueueFilter('verification')}>Verify <span>{awaitingVerificationCount}</span></button>
                    <button className={actionQueueFilter === 'mine' ? 'active' : ''} onClick={() => setActionQueueFilter('mine')}>Mine <span>{myActionCount}</span></button>
                  </div>
                </div>
                <div className="action-queue-list">
                  {visibleActionQueue.length ? visibleActionQueue.map((item) => (
                    <article className={item.priority} key={item.id}>
                      <div className="action-queue-item-heading">
                        <Badge variant="outline">{item.workspace}</Badge>
                        <span className={`action-priority ${item.priority}`}>{item.priority === 'critical' ? 'Urgent' : item.priority === 'warning' ? 'Attention' : 'Watch'}</span>
                        <span className={`approval-status ${item.approval === 'Not required' ? 'not-required' : item.approval.toLowerCase().replaceAll(' ', '-')}`}>{item.approval}</span>
                        <span className={`action-status ${item.status.toLowerCase().replaceAll(' ', '-')}`}>{item.status}</span>
                        <time>{item.due}</time>
                      </div>
                      <div className="control-action-body">
                        <div><strong>{item.title}</strong><p>{item.detail}</p><div className={`control-recommendation${item.status === 'Awaiting Verification' ? ' verification' : ''}`}><span>{item.status === 'Awaiting Verification' ? 'Outcome to Verify' : 'Recommended Next Move'}</span><strong>{item.status === 'Awaiting Verification' ? item.proposedResolution : item.recommendation}</strong></div></div>
                        <dl><div><dt>Linked Record</dt><dd>{renderLinkedJkText(item.record, item.source, item.due)}</dd></div><div><dt>Owner</dt><dd>{item.owner}</dd></div><div><dt>Verification Source</dt><dd>{verificationSourceForAction(item)}</dd></div><div><dt>Required Result</dt><dd>{item.verification}</dd></div></dl>
                      </div>
                      <footer>
                        <button className="action-queue-open" onClick={() => manageActionQueueItem(item)}>{item.approval === 'Pending approval' ? 'Review and Approve' : item.status === 'Awaiting Verification' ? 'Verify Outcome' : 'Manage Action'} <ArrowRight size={13} /></button>
                        <button className="action-queue-source" onClick={() => openActionSource(item)}>Open Source · {item.action}</button>
                      </footer>
                    </article>
                  )) : <div className="action-queue-empty"><Check size={20} /><strong>No matching actions</strong><span>Open work remains available in the other queue views.</span></div>}
                </div>
                <footer className="action-queue-note"><ShieldCheck size={13} /><span>Opening source context never approves or resolves an action. Resolution requires a recorded source check.</span></footer>
              </section>
              <section className="routes-panel control-route-panel">
                <div className="section-title"><div><span className="section-kicker">4 active routes · 12 stops</span><h2>Live Operations</h2><p>Current route context supporting today’s decisions.</p></div><Button variant="outline" size="sm" onClick={() => { setActiveNav('Schedule'); setScheduleDay('today'); setScheduleView('board'); }}>Open Schedule <ArrowRight /></Button></div>
                <div className="control-route-list">
                  {schedule.map((route) => (
                    <article className={route.tone} key={route.truck}>
                      <header><div><span className={`route-state ${route.tone}`}>{route.status}</span><strong>{route.truck}</strong><small>{route.crew}</small></div><button onClick={() => openFleetTruckByLabel(route.truck)}>Open <ArrowRight size={12} /></button></header>
                      <div><span>Current</span><strong>{renderLinkedJkText(route.current, 'JunkWare schedule', 'Live')}</strong><small>{route.currentMeta}</small></div>
                      <div><span>Next</span><strong>{route.next}</strong><small>Confirmed</small></div>
                      <footer><strong>{route.stops}</strong><span><i style={{ width: `${route.progress}%` }} /></span></footer>
                    </article>
                  ))}
                </div>
              </section>
              <section className={`activity-panel day-close-panel${operatingDayClosed ? ' closed' : ''}`} id="end-of-day-readiness">
                <div className="section-title day-close-title">
                  <div><span className="section-kicker">Sunday, August 31 · {clearedDayCloseGateCount} of {dayCloseGates.length} gates cleared</span><h2>End-of-Day Readiness</h2><p>Close the operating day only after every source is ready or its remaining work has an owner and deadline.</p></div>
                  <Badge variant="outline" className={operatingDayClosed ? 'day-close-badge closed' : dayCloseReady ? 'day-close-badge ready' : 'day-close-badge blocked'}>{operatingDayClosed ? 'Operating Day Closed' : dayCloseReady ? 'Ready to Close' : `${dayCloseGates.length - clearedDayCloseGateCount} Blocking`}</Badge>
                </div>
                <div className="day-close-layout">
                  <div className="day-close-gate-list">
                    {dayCloseGates.map((gate, index) => {
                      const carryover = dayCloseCarryovers[gate.id];
                      const sourceReady = gate.count === 0;
                      return (
                        <div className={`day-close-gate-shell ${sourceReady ? 'ready' : carryover ? 'carryover' : 'blocked'}`} key={gate.id}>
                          <article className="day-close-gate">
                            <i>{sourceReady ? <Check size={14} /> : index + 1}</i>
                            <div className="day-close-gate-copy"><strong>{gate.title}</strong><span>{gate.detail}</span><small>{gate.source}</small>{carryover && <em>{carryover.note}</em>}</div>
                            <div className="day-close-gate-count"><strong>{gate.count}</strong><span>{gate.unit}</span></div>
                            <span className={`day-close-gate-status ${sourceReady ? 'ready' : carryover ? 'carryover' : 'blocked'}`}>{sourceReady ? 'Source Ready' : carryover ? 'Owned Carryover' : 'Needs Action'}</span>
                            <div className="day-close-gate-actions">
                              <button disabled={sourceReady} onClick={() => reviewDayCloseGate(gate.id)}>{gate.reviewLabel}</button>
                              {!sourceReady && (carryover
                                ? <button className="carryover" onClick={() => startDayCloseCarryover(gate)}>{carryover.owner} · {carryover.due}</button>
                                : <button className="carryover" onClick={() => startDayCloseCarryover(gate)}>Plan Carryover</button>)}
                            </div>
                          </article>
                          {activeDayCloseGateId === gate.id && !sourceReady && (
                            <div className="day-close-carryover-editor">
                              <div><span>Intentional Carryover</span><strong>{gate.title}</strong><small>{gate.count} {gate.unit} will remain open after today.</small></div>
                              <label><span>Owner</span><select value={dayCloseCarryoverDraft.owner} onChange={(event) => setDayCloseCarryoverDraft((draft) => ({ ...draft, owner: event.target.value }))}><option>Dispatch</option><option>Finance</option><option>Fleet</option><option>Ops Manager</option><option>Mission Control</option></select></label>
                              <label><span>Deadline</span><Input value={dayCloseCarryoverDraft.due} onChange={(event) => setDayCloseCarryoverDraft((draft) => ({ ...draft, due: event.target.value }))} placeholder="Required deadline" /></label>
                              <label className="reason"><span>Reason and Next Action</span><Textarea value={dayCloseCarryoverDraft.note} onChange={(event) => setDayCloseCarryoverDraft((draft) => ({ ...draft, note: event.target.value }))} placeholder="Why is this carrying over, and what happens next?" /></label>
                              <footer><button onClick={() => { setActiveDayCloseGateId(null); setDayCloseError(''); }}>Cancel</button>{carryover && <button className="remove" onClick={() => { removeDayCloseCarryover(gate); setActiveDayCloseGateId(null); }}>Remove Carryover</button>}<Button size="sm" onClick={saveDayCloseCarryover}>Save Carryover <Check /></Button></footer>
                              {dayCloseError && <p role="alert">{dayCloseError}</p>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <aside className={operatingDayClosed ? 'closed' : dayCloseReady ? 'ready' : 'blocked'}>
                    <span>Operating Day</span>
                    <h3>{operatingDayClosed ? 'Closed with an Attributable Handoff' : dayCloseReady ? 'Ready to Close' : 'Close Blocked'}</h3>
                    <p>{operatingDayClosed ? 'Every gate was source-ready or assigned as an intentional carryover.' : dayCloseReady ? 'Every remaining item has a recorded owner and deadline.' : 'Resolve the blocking gates or document intentional carryovers.'}</p>
                    <div className="day-close-meter" role="progressbar" aria-label={`${clearedDayCloseGateCount} of ${dayCloseGates.length} day-close gates cleared`} aria-valuenow={clearedDayCloseGateCount} aria-valuemin={0} aria-valuemax={dayCloseGates.length}><i style={{ width: `${dayCloseProgress}%` }} /></div>
                    <dl><div><dt>Cleared Gates</dt><dd>{clearedDayCloseGateCount} / {dayCloseGates.length}</dd></div><div><dt>Owned Carryovers</dt><dd>{Object.keys(dayCloseCarryovers).length}</dd></div><div><dt>Blocking Gates</dt><dd>{dayCloseGates.length - clearedDayCloseGateCount}</dd></div></dl>
                    {operatingDayClosed ? <Button variant="outline" onClick={reopenOperatingDay}>Reopen Operating Day</Button> : <Button disabled={!dayCloseReady} onClick={closeOperatingDay}>Close Operating Day <ShieldCheck /></Button>}
                    {!dayCloseReady && <small>Unavailable until every gate is cleared.</small>}
                    {dayCloseError && !activeDayCloseGateId && <em>{dayCloseError}</em>}
                    <footer>Prototype only · source systems are not changed</footer>
                  </aside>
                </div>
              </section>
              <section className="audit-panel">
                <div className="section-title audit-title">
                  <div><span className="section-kicker">Attributable operating record</span><h2>Activity and Audit</h2><p>Actions, source changes, and exceptions stay together with before-and-after context.</p></div>
                  <div className="audit-filters" aria-label="Filter audit activity by workspace">
                    {auditWorkspaces.map((workspace) => <button className={auditFilter === workspace ? 'active' : ''} onClick={() => setAuditFilter(workspace)} key={workspace}>{workspace}</button>)}
                  </div>
                </div>
                <div className="audit-summary" aria-label="Audit summary">
                  <div><span>Recorded Today</span><strong>{auditEvents.length}</strong></div>
                  <div><span>Completed</span><strong>{auditEvents.length - auditAttentionCount}</strong></div>
                  <div className={auditAttentionCount ? 'attention' : ''}><span>Needs Review</span><strong>{auditAttentionCount}</strong></div>
                  <div><span>Connected Sources</span><strong>{auditSourceCount}</strong></div>
                </div>
                <div className="audit-table-scroll">
                  <div className="audit-table-head"><span>Time</span><span>Workspace</span><span>Action</span><span>Record</span><span>Change</span><span>Actor / Source</span><span>Result</span><span /></div>
                  <div className="audit-list">
                    {visibleAuditEvents.map((event) => (
                      <article className={event.result === 'Needs review' ? 'needs-review' : ''} key={event.id}>
                        <time>{event.time}</time>
                        <span className="audit-workspace">{event.workspace}</span>
                        <div className="audit-action"><strong>{event.action}</strong><small>{event.summary}</small></div>
                        <strong className="audit-record">{renderLinkedJkText(event.record, event.source, event.time)}</strong>
                        <div className="audit-change"><span>{event.previous}</span><ArrowRight size={12} /><strong>{event.next}</strong></div>
                        <div className="audit-source"><strong>{event.actor}</strong><span>{event.source}</span></div>
                        <span className={`audit-result ${event.result === 'Needs review' ? 'attention' : 'completed'}`}>{event.result}</span>
                        <button className="audit-open" onClick={() => openAuditEvent(event)}>Open <ArrowRight size={13} /></button>
                      </article>
                    ))}
                  </div>
                </div>
                <footer className="audit-footer"><span><ShieldCheck size={13} />Every entry keeps its actor, source, prior state, new state, and outcome.</span><strong>{visibleAuditEvents.length} event{visibleAuditEvents.length === 1 ? '' : 's'} shown</strong></footer>
              </section>
            </div>
          )}

          {activeNav === 'Command' && view === 'monitor' && !live && (
            <div className="monitor-layout">
              <section className="signal-grid" aria-label="Operational trend signals">
                {monitorSignals.map((signal) => { const Icon = signal.icon; return (
                  <article className={`signal-card ${signal.tone}`} key={signal.label}>
                    <div className="signal-heading"><span><Icon size={15} />{signal.label}</span><i className={`kpi-dot ${signal.tone}`} /></div>
                    <strong>{signal.value}</strong>
                    <div className="signal-meter"><i className={signal.tone} style={{ width: `${signal.progress}%` }} /></div>
                    <small>{signal.detail}</small>
                  </article>
                ); })}
              </section>
              <section className="watch-panel">
                <div className="section-title"><div><span className="section-kicker">3 emerging risks</span><h2>Watchlist</h2></div></div>
                <div className="monitor-watch-grid">
                  {monitorWatchlist.map((item) => (
                    <article className="watch-row" key={item.title}>
                      <Badge variant="outline" className={`priority-badge ${item.priority}`}>{item.label}</Badge>
                      <strong>{item.title}</strong>
                      <p>{item.detail}</p>
                      <Button variant="outline" size="sm" onClick={() => openRecordDrawer({
                        kicker: item.label,
                        title: item.title,
                        summary: item.detail,
                        action: item.action,
                        source: 'OpsCenter monitor',
                        updated: 'Live',
                        facts: [
                          { label: 'Priority', value: item.priority },
                          { label: 'Signal', value: item.label },
                        ],
                      })}>{item.action} <ArrowRight /></Button>
                    </article>
                  ))}
                </div>
              </section>
              <section className="health-panel compact-health-panel">
                <div className="section-title"><div><span className="section-kicker">3 healthy · 1 attention</span><h2>System Health</h2></div><Button variant="ghost" size="sm" onClick={openSourceHealth}>Source Details <ArrowRight /></Button></div>
                <div className="source-health-strip">
                  {healthSources.map((source) => (
                    <article className="monitor-source-row" key={source.name}>
                      <div className="source-identity"><strong>{source.name}</strong><small>{source.area}</small></div>
                      <span className={`health-status ${source.tone}`}><i />{source.state}</span>
                      <span className="source-freshness">{source.freshness}</span>
                    </article>
                  ))}
                </div>
              </section>
            </div>
          )}

          {live && activeNav === 'Command' && view !== 'now' && <LiveControl date={live.snapshot.date} view={view} report={setActionFeedback} onNavigate={setActiveNav} onBusyChange={onBusyChange} />}
          {live && activeNav === 'Krewe' && <LiveKrewe date={live.snapshot.date} view={kreweView} onViewChange={setKreweView} onBusyChange={onBusyChange} />}
          {live && activeNav === 'Fleet' && <LiveFleet date={live.snapshot.date} view={fleetView} onViewChange={setFleetView} onBusyChange={onBusyChange} />}
          {live && activeNav === 'Marketing' && <LiveMarketing date={live.snapshot.date} view={marketingView} onViewChange={setMarketingView} onBusyChange={onBusyChange} />}
          {live && activeNav === 'Finance' && canFinance && <LiveFinance date={live.snapshot.date} view={financeView} onViewChange={setFinanceView} onBusyChange={onBusyChange} />}
          {activeNav === 'Schedule' && live && <LiveSchedule baseDate={live.snapshot.date} day={scheduleDay} view={scheduleView} onDayChange={setScheduleDay} onCounts={setLiveScheduleCounts} report={setActionFeedback} onBusyChange={onBusyChange} onOpenDate={date => live.onDateChange(date, 'Schedule')} />}
          {activeNav === 'Schedule' && !live && (
            <section className="schedule-workspace">
              <div className="schedule-control-bar">
                <div className="day-switcher" role="tablist" aria-label="Schedule day">
                  <button onClick={() => changeScheduleDay('today')} className={scheduleDay === 'today' ? 'active' : ''}>Today <span>{scheduleDayCounts.today}</span></button>
                  <button onClick={() => changeScheduleDay('tomorrow')} className={scheduleDay === 'tomorrow' ? 'active' : ''}>Tomorrow <span>{scheduleDayCounts.tomorrow}</span></button>
                </div>
                <div className="schedule-control-actions">
                  {scheduleView === 'board' && <Button variant="outline" size="sm" onClick={() => setShowScheduleMap((visible) => !visible)}>{showScheduleMap ? 'Hide Map' : 'Show Map'}</Button>}
                  <Button size="sm" onClick={openNewAppointment}>New Appointment</Button>
                </div>
              </div>

              {scheduleView === 'board' && <>
                <div className="schedule-summary-strip">
                  <button className={`schedule-summary-button${scheduleStatusFilter === 'all' ? ' active' : ''}`} onClick={() => setScheduleStatusFilter('all')}><span>Scheduled</span><strong>{scheduledAppointments.length}</strong></button>
                  <button className={`schedule-summary-button${scheduleStatusFilter === 'completed' ? ' active' : ''}`} onClick={() => setScheduleStatusFilter(scheduleStatusFilter === 'completed' ? 'all' : 'completed')}><span>Completed Jobs</span><strong>{scheduleCompletedJobCount}</strong></button>
                  <button className={`schedule-summary-button estimate${scheduleStatusFilter === 'closed-estimates' ? ' active' : ''}`} onClick={() => setScheduleStatusFilter(scheduleStatusFilter === 'closed-estimates' ? 'all' : 'closed-estimates')}><span>Closed Estimates</span><strong>{scheduleClosedEstimateCount}</strong></button>
                  <button className={`schedule-summary-button${scheduleStatusFilter === 'open' ? ' active' : ''}`} onClick={() => setScheduleStatusFilter(scheduleStatusFilter === 'open' ? 'all' : 'open')}><span>Open</span><strong>{scheduleOpenAppointmentCount}</strong></button>
                  <button className={`schedule-summary-button attention${scheduleStatusFilter === 'unassigned' ? ' active' : ''}`} onClick={() => setScheduleStatusFilter(scheduleStatusFilter === 'unassigned' ? 'all' : 'unassigned')}><span>Unassigned</span><strong>{scheduledAppointments.filter((appointment) => appointment.truck === 'Unassigned').length}</strong></button>
                  <button className={`schedule-summary-button attention${scheduleStatusFilter === 'verify' ? ' active' : ''}`} onClick={() => setScheduleStatusFilter(scheduleStatusFilter === 'verify' ? 'all' : 'verify')}><span>Verify Address</span><strong>{scheduledAppointments.filter((appointment) => !appointment.addressVerified).length}</strong></button>
                  <Button variant="outline" size="sm" onClick={resetScheduleSelection} disabled={!scheduleFiltersActive && !territoryPriority}>Clear</Button>
                </div>
                <div className={`schedule-board-layout${showScheduleMap ? ' map-open' : ''}`}>
                {showScheduleMap && (
                  <section className="schedule-map-panel">
                    <div className="schedule-map-canvas">
                      <iframe key={scheduleScope} title={`${scheduleScopeLabel} operations map`} src={scheduleMapSrc} loading="lazy" />
                      <div className={`schedule-map-markers${scheduleFiltersActive ? ' scope-focused' : ''}`} aria-label="Map markers">
                        {scheduleDay === 'today' ? <>
                          <button className={`map-marker truck-marker on-site${mapMarkerMatchesScheduleScope('NS', 'COV') ? '' : ' scope-muted'}${routeTruckMarkerClass('Truck 2')}`} style={{ left: '67%', top: '22%' }} aria-label="Open Truck 2 record" onClick={() => openFleetTruckByLabel('Truck 2')}>T2</button>
                          <button className={`map-marker truck-marker stale${mapMarkerMatchesScheduleScope('JP', 'MET') ? '' : ' scope-muted'}${routeTruckMarkerClass('Truck 4')}`} style={{ left: '57%', top: '61%' }} aria-label="Open Truck 4 record" onClick={() => openFleetTruckByLabel('Truck 4')}>T4</button>
                          <button className={`map-marker truck-marker${mapMarkerMatchesScheduleScope('NO', 'NO') ? '' : ' scope-muted'}${routeTruckMarkerClass('Truck 8')}`} style={{ left: '64%', top: '70%' }} aria-label="Open Truck 8 record" onClick={() => openFleetTruckByLabel('Truck 8')}>T8</button>
                          <button className={`map-marker truck-marker${mapMarkerMatchesScheduleScope('BR', 'BR') ? '' : ' scope-muted'}${routeTruckMarkerClass('Truck 9')}`} style={{ left: '19%', top: '44%' }} aria-label="Open Truck 9 record" onClick={() => openFleetTruckByLabel('Truck 9')}>T9</button>
                          <button className={`map-marker truck-marker${mapMarkerMatchesScheduleScope('NS', 'HAM') ? '' : ' scope-muted'}${routeTruckMarkerClass('Truck 3')}`} style={{ left: '76%', top: '25%' }} aria-label="Open Truck 3 record" onClick={() => openFleetTruckByLabel('Truck 3')}>T3</button>
                          <button className={`map-marker truck-marker${mapMarkerMatchesScheduleScope('BR', 'ASC') ? '' : ' scope-muted'}${routeTruckMarkerClass('Truck 5')}`} style={{ left: '31%', top: '56%' }} aria-label="Open Truck 5 record" onClick={() => openFleetTruckByLabel('Truck 5')}>T5</button>
                          <button className={`map-marker truck-marker out-of-service${mapMarkerMatchesScheduleScope('NO', 'RP') ? '' : ' scope-muted'}${routeTruckMarkerClass('Truck 6')}`} style={{ left: '49%', top: '65%' }} aria-label="Open Truck 6 record" onClick={() => openFleetTruckByLabel('Truck 6')}>T6</button>
                          <button className={`map-marker truck-marker${mapMarkerMatchesScheduleScope('BR', 'LIV') ? '' : ' scope-muted'}${routeTruckMarkerClass('Truck 7')}`} style={{ left: '24%', top: '40%' }} aria-label="Open Truck 7 record" onClick={() => openFleetTruckByLabel('Truck 7')}>T7</button>
                          <button className={`map-marker appointment-marker${appointmentIdMatchesScheduleFilters('JK4001241') ? '' : ' scope-muted'}${routeFocusAppointmentId === 'JK4001241' ? ' route-selected' : ''}`} style={{ left: '72%', top: '28%' }} aria-label="Compare routes to appointment JK4001241" onClick={() => setRouteFocusAppointmentId('JK4001241')}>1</button>
                          <button className={`map-marker appointment-marker completed${appointmentIdMatchesScheduleFilters('JK4001204') ? '' : ' scope-muted'}${routeFocusAppointmentId === 'JK4001204' ? ' route-selected' : ''}`} style={{ left: '62%', top: '66%' }} aria-label="Compare routes to completed appointment JK4001204" onClick={() => setRouteFocusAppointmentId('JK4001204')}>✓</button>
                          <button className={`map-marker appointment-marker verify${appointmentIdMatchesScheduleFilters('JK4001301') ? '' : ' scope-muted'}${routeFocusAppointmentId === 'JK4001301' ? ' route-selected' : ''}`} style={{ left: '48%', top: '76%' }} aria-label="Compare routes to appointment JK4001301" onClick={() => setRouteFocusAppointmentId('JK4001301')}>!</button>
                        </> : <>
                          <button className={`map-marker truck-marker planned-origin${routeTruckMarkerClass('Truck 2')}`} style={{ left: '68%', top: '21%' }} aria-label="Open Truck 2 planned origin" onClick={() => openFleetTruckByLabel('Truck 2')}>T2</button>
                          <button className={`map-marker truck-marker planned-origin${routeTruckMarkerClass('Truck 4')}`} style={{ left: '56%', top: '60%' }} aria-label="Open Truck 4 planned origin" onClick={() => openFleetTruckByLabel('Truck 4')}>T4</button>
                          <button className={`map-marker truck-marker planned-origin${routeTruckMarkerClass('Truck 8')}`} style={{ left: '63%', top: '71%' }} aria-label="Open Truck 8 planned origin" onClick={() => openFleetTruckByLabel('Truck 8')}>T8</button>
                          <button className={`map-marker truck-marker planned-origin${routeTruckMarkerClass('Truck 9')}`} style={{ left: '18%', top: '43%' }} aria-label="Open Truck 9 planned origin" onClick={() => openFleetTruckByLabel('Truck 9')}>T9</button>
                          <button className={`map-marker truck-marker planned-origin${routeTruckMarkerClass('Truck 3')}`} style={{ left: '76%', top: '25%' }} aria-label="Open Truck 3 planned origin" onClick={() => openFleetTruckByLabel('Truck 3')}>T3</button>
                          <button className={`map-marker truck-marker planned-origin${routeTruckMarkerClass('Truck 5')}`} style={{ left: '31%', top: '56%' }} aria-label="Open Truck 5 planned origin" onClick={() => openFleetTruckByLabel('Truck 5')}>T5</button>
                          <button className={`map-marker truck-marker planned-origin${routeTruckMarkerClass('Truck 7')}`} style={{ left: '24%', top: '40%' }} aria-label="Open Truck 7 planned origin" onClick={() => openFleetTruckByLabel('Truck 7')}>T7</button>
                          <button className={`map-marker appointment-marker planned${appointmentIdMatchesScheduleFilters('JK4001401') ? '' : ' scope-muted'}${routeFocusAppointmentId === 'JK4001401' ? ' route-selected' : ''}`} style={{ left: '70%', top: '27%' }} aria-label="Compare routes to tomorrow appointment JK4001401" onClick={() => setRouteFocusAppointmentId('JK4001401')}>1</button>
                          <button className={`map-marker appointment-marker planned${appointmentIdMatchesScheduleFilters('JK4001402') ? '' : ' scope-muted'}${routeFocusAppointmentId === 'JK4001402' ? ' route-selected' : ''}`} style={{ left: '56%', top: '59%' }} aria-label="Compare routes to tomorrow appointment JK4001402" onClick={() => setRouteFocusAppointmentId('JK4001402')}>2</button>
                          <button className={`map-marker appointment-marker planned${appointmentIdMatchesScheduleFilters('JK4001403') ? '' : ' scope-muted'}${routeFocusAppointmentId === 'JK4001403' ? ' route-selected' : ''}`} style={{ left: '64%', top: '69%' }} aria-label="Compare routes to tomorrow appointment JK4001403" onClick={() => setRouteFocusAppointmentId('JK4001403')}>3</button>
                          <button className={`map-marker appointment-marker verify${appointmentIdMatchesScheduleFilters('JK4001409') ? '' : ' scope-muted'}${routeFocusAppointmentId === 'JK4001409' ? ' route-selected' : ''}`} style={{ left: '69%', top: '76%' }} aria-label="Compare routes to tomorrow appointment JK4001409" onClick={() => setRouteFocusAppointmentId('JK4001409')}>!</button>
                        </>}
                      </div>
                      <div className="map-focus-chip"><span>{scheduleFiltersActive ? 'Filtered view' : scheduleDay === 'today' ? 'Operating footprint' : 'Planning footprint'}</span><strong>{scheduleFilterSummary}</strong><div className="map-focus-actions">{selectedArea ? <button onClick={() => openAreaRecord(selectedArea.territory.territory, selectedArea.code)}>Open Area</button> : selectedTerritory ? <button onClick={() => openTerritoryRecord(selectedTerritory.territory)}>Open Territory</button> : null}{scheduleFiltersActive || territoryPriority ? <button onClick={resetScheduleSelection}>Reset</button> : null}</div></div>
                      <div className="map-operation-summary"><span>{visibleAppointmentCount} shown</span><span>{visibleAppointments.filter((appointment) => appointment.addressVerified).length} addresses verified</span><span>{visibleAppointments.filter((appointment) => appointment.state === 'Canceled').length} canceled</span></div>
                      <div className="map-legend">{scheduleDay === 'today' ? <><span><i className="truck" />Truck</span><span><i className="appointment" />Appointment</span><span><i className="verified" />Completed</span><span><i className="attention" />Verify</span></> : <><span><i className="appointment" />Planned appointment</span><span><i className="attention" />Verify</span></>}</div>
                    </div>
                    <aside className="schedule-map-controls">
                      <div><span className="section-kicker">{scheduleDay === 'today' ? 'Live map' : 'Planning map'}</span><h2>{scheduleDay === 'today' ? 'Dispatch Positions' : 'Appointment Coverage'}</h2><p>Marker and board selections stay linked.</p></div>
                      <div className="map-control-buttons">
                        <button className={!scheduleFiltersActive && !territoryPriority ? 'active' : ''} onClick={resetScheduleSelection}>All</button>
                        {appointmentsByTerritory.map((group) => (
                          <button className={scheduleScope === `T:${group.designator}` || scheduleScope.startsWith(`A:${group.designator}:`) ? 'active' : ''} onClick={() => setScheduleScope(`T:${group.designator}`)} key={group.designator} title={group.territory}>{group.designator}</button>
                        ))}
                      </div>
                      {routeFocusAppointment ? (
                        <section className="route-intelligence-panel" aria-label={`Closest trucks to ${routeFocusAppointment.jk}`}>
                          <header>
                            <div><span>Closest Trucks</span><strong>{renderJkLink(routeFocusAppointment.jk, 'JunkWare schedule', 'Live')} · {routeFocusAppointment.area}</strong></div>
                            <div><button onClick={openRouteFocusAppointment}>Open</button><button aria-label="Clear route comparison" onClick={() => setRouteFocusAppointmentId(null)}>×</button></div>
                          </header>
                          <div className="route-candidate-list">
                            {routeCandidates.map((candidate, index) => (
                              <div className={`route-candidate-row ${candidate.tone}${index === 0 ? ' best' : ''}`} key={candidate.truckId}>
                                <span className="route-rank">{index + 1}</span>
                                <div><strong>{candidate.truck}</strong><small>{renderLinkedJkText(candidate.reason, 'JunkWare schedule', 'Route comparison')}</small></div>
                                <div><b>{candidate.minutes} min · {candidate.miles} mi</b><small>Free {candidate.available} · {candidate.origin} → {candidate.arrival}</small></div>
                                <em>{candidate.buffer === null ? 'Conflict' : candidate.buffer < 0 ? `${Math.abs(candidate.buffer)}m late` : `${candidate.buffer}m buffer`}</em>
                              </div>
                            ))}
                          </div>
                          <footer>{scheduleDay === 'today' ? 'Projected from current or preceding stop' : 'Projected from tomorrow’s planned sequence'} · Comparison only · Prototype route estimate</footer>
                        </section>
                      ) : (
                        <div className="map-status-list">{scheduleDay === 'today' ? <>
                          <span><i className="healthy" />Truck 2 · Covington · 42 sec</span>
                          <span><i className="healthy" />Truck 8 · New Orleans · 1 min</span>
                          <span><i className="warning" />Truck 4 · Position stale · 18 min</span>
                        </> : <>
                          <span><i className="healthy" />8 trucks have planned work</span>
                          <span><i className="healthy" />5 territories represented</span>
                          <span><i className="warning" />3 addresses need verification</span>
                        </>}</div>
                      )}
                      <Button variant="outline" size="sm" onClick={reviewUnverifiedAddresses}>Review Addresses <ArrowRight /></Button>
                    </aside>
                  </section>
                )}
                <div className="schedule-board-shell">
                  <div className="section-title"><div><span className="section-kicker">{scheduleDay === 'today' ? 'Today · Live board' : 'Tomorrow · Planning board'}</span><h2>Truck Schedule</h2></div><div className="schedule-board-actions"><span className="schedule-drag-help"><GripVertical size={13} />Drag appointment → truck + time</span><Button variant="ghost" size="sm" disabled title="Available when this local prototype is connected to JunkWare">JunkWare Link Unavailable</Button></div></div>
                  <div className="schedule-board-scroll">
                    <div className={`schedule-board ${scheduleDensity}${draggedAppointmentId ? ' drag-active' : ''}`} style={{ gridTemplateRows: `22px repeat(${scheduleRows.length}, minmax(0, 1fr))` }}>
                      <div className="schedule-time-row"><span>Route</span>{scheduleTimes.map((time) => <span key={time}>{time}</span>)}</div>
                      {showScheduleNow && (
                        <div className="schedule-now-line" style={{ left: scheduleNowLeft }} aria-label={`Current time ${scheduleNowLabel}`}>
                          <span>{scheduleNowLabel}</span>
                        </div>
                      )}
                      {scheduleRows.map((row) => (
                        <div className={`schedule-truck-row${bestRouteCandidate?.truck === row.truck ? ' route-best-truck' : routeFocusAppointment && routeCandidateTruckLabels.has(row.truck) ? ' route-candidate-truck' : ''}`} data-schedule-truck={row.truck} key={row.truck}>
                          <button type="button" className="schedule-truck-cell" disabled={!fleetTruckRows.some((truck) => truck.label === row.truck)} onClick={() => openFleetTruckByLabel(row.truck)} aria-label={`Open ${row.truck} record`}><i className={row.tone} /><strong>{row.truck}</strong><span>{row.crew}</span><small>{row.status}</small></button>
                          {scheduleTimes.map((time, slot) => (
                            <div
                              className="schedule-drop-zone"
                              key={`${row.truck}-${time}`}
                              style={{ gridColumn: slot + 2 }}
                              aria-hidden="true"
                            />
                          ))}
                          {dragPreview?.targetTruck === row.truck && (
                            <div
                              className={`schedule-drag-preview${dragPreview.conflictIds.length ? ' conflict' : ''}`}
                              style={{ gridColumn: `${dragPreview.targetStart + 2} / span ${dragPreview.duration}` }}
                            >
                              <strong>{dragPreview.appointmentId}</strong><small>{dragPreview.targetTime}{dragPreview.conflictIds.length ? ` · Conflicts ${dragPreview.conflictIds.join(', ')}` : ' · Drop to review'}</small>
                            </div>
                          )}
                          {buildRouteLegs(row).map((leg) => (
                            <div
                              className={`schedule-route-leg ${leg.tone}`}
                              key={`${row.truck}-${leg.from.jk}-${leg.to.jk}`}
                              style={{ gridColumn: `${leg.from.start + leg.from.duration + 2} / ${leg.to.start + 2}` }}
                              title={`${leg.from.jk} to ${leg.to.jk}: ${leg.minutes} minutes, ${leg.miles} miles, ${leg.buffer} minute buffer · Prototype route estimate`}
                            >
                              <strong>{leg.minutes}m · {leg.miles}mi</strong><small>{leg.buffer}m buffer</small>
                            </div>
                          ))}
                          {row.jobs.map((job) => (
                            <div
                              className={`schedule-appointment ${job.kind.toLowerCase()} ${job.state.toLowerCase().replaceAll(' ', '-')}${scheduleFiltersActive ? scheduleJobMatchesFilters(job, row.truck) ? ' scope-match' : ' scope-muted' : ''}${routeFocusAppointmentId === job.jk ? ' route-selected' : ''}${draggedAppointmentId === job.jk ? ' is-dragging' : ''}`}
                              key={`${row.truck}-${job.jk}`}
                              style={{ gridColumn: `${job.start + 2} / span ${job.duration}` }}
                              role="group"
                              tabIndex={0}
                              aria-label={`${job.jk} · ${job.customer} · ${job.time}`}
                              aria-grabbed={draggedAppointmentId === job.jk}
                              aria-roledescription={job.jk === 'Open capacity' || isFinalAppointmentState(job.state) ? undefined : 'draggable appointment'}
                              onPointerDown={(event) => beginSchedulePointerDrag(event, job.jk)}
                              onClick={() => job.jk === 'Open capacity' ? openRecordDrawer({
                                appointmentId: job.jk === 'Open capacity' ? undefined : job.jk,
                                kicker: `${job.kind} · ${job.state}`,
                                title: job.jk,
                                summary: `${job.customer} · ${job.area}`,
                                action: job.jk === 'Open capacity' ? 'Fill route gap' : 'Open appointment',
                                source: 'JunkWare schedule',
                                updated: 'Live',
                                facts: [
                                  { label: 'Time', value: job.time }, { label: 'Truck', value: row.truck },
                                  { label: 'Crew', value: row.crew }, { label: 'Customer', value: job.customer },
                                  { label: 'Area', value: job.area }, { label: 'Status', value: job.state },
                                ],
                              }) : setRouteFocusAppointmentId(job.jk)}
                              onKeyDown={(event) => {
                                if (event.target !== event.currentTarget || !['Enter', ' '].includes(event.key)) return;
                                event.preventDefault();
                                if (job.jk !== 'Open capacity') setRouteFocusAppointmentId(job.jk);
                              }}
                            >
                              {job.jk !== 'Open capacity' && !isFinalAppointmentState(job.state) && <i className="schedule-appointment-grip" aria-hidden="true"><GripVertical size={10} /></i>}
                              <span>{job.time}</span>
                              {job.jk === 'Open capacity'
                                ? <strong>{job.jk}</strong>
                                : <button type="button" className="jk-record-link schedule-jk-link" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.stopPropagation(); openUnifiedJobRecord(job.jk, 'JunkWare schedule', 'Live'); }}>{job.jk}</button>}
                              <small title={`${job.customer} · ${job.area}`}>{job.customer} · {job.area}</small>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>
                  {pendingScheduleMove && pendingMoveAppointment && (
                    <section className={`schedule-move-confirmation${pendingScheduleMove.conflictIds.length ? ' has-conflict' : ''}`} aria-label="Confirm schedule move">
                      <header>
                        <div><span>{pendingScheduleMove.conflictIds.length ? 'Schedule Conflict' : 'Confirm Move'}</span><strong>{pendingMoveAppointment.jk} · {pendingMoveAppointment.customer}</strong></div>
                        <button aria-label="Cancel schedule move" onClick={() => setPendingScheduleMove(null)}>×</button>
                      </header>
                      <div className="schedule-move-path">
                        <span><b>From</b>{pendingScheduleMove.sourceTruck} · {pendingScheduleMove.sourceTime}</span>
                        <ArrowRight size={14} />
                        <span><b>To</b>{pendingScheduleMove.targetTruck} · {pendingScheduleMove.targetTime}</span>
                      </div>
                      {pendingScheduleMove.conflictIds.length > 0 && <p>Overlaps {pendingScheduleMove.conflictIds.join(', ')}. Confirm only if the route is intentionally double-booked.</p>}
                      <div className="schedule-move-route-impact">
                        {pendingScheduleMove.routeSegments.length ? pendingScheduleMove.routeSegments.map((segment) => (
                          <span className={segment.tone} key={segment.label}><b>{segment.label}</b>{segment.minutes} min · {segment.miles} mi · {segment.buffer < 0 ? `${Math.abs(segment.buffer)}m late` : `${segment.buffer}m buffer`}</span>
                        )) : <span><b>Route Impact</b>{pendingScheduleMove.targetTruck === 'Unassigned' ? 'Removed from a truck route' : 'First or only stop on this route'}</span>}
                      </div>
                      <footer>
                        <Button variant="outline" size="sm" onClick={() => setPendingScheduleMove(null)}>Cancel</Button>
                        <Button variant="outline" size="sm" onClick={() => commitScheduleMove(true)}>Preview Sync Issue</Button>
                        <Button size="sm" onClick={() => commitScheduleMove(false)}>{pendingScheduleMove.conflictIds.length ? 'Move Anyway' : 'Confirm Move'}</Button>
                      </footer>
                    </section>
                  )}
                </div>
                </div>
                {scheduleChangeReceipt && (
                  <section className={`schedule-change-receipt sync-${scheduleChangeReceipt.syncState}${scheduleChangeReceipt.undone ? ' undone' : ''}`} aria-label="Schedule change receipt">
                    <header>
                      <div>
                        <span>{scheduleChangeReceipt.undone ? 'Previous Plan Restored' : scheduleChangeReceipt.syncState === 'verified' ? 'Schedule Change Verified' : ['uncertain', 'searching', 'safe-retry'].includes(scheduleChangeReceipt.syncState) ? 'Schedule Sync Needs Attention' : 'Syncing Schedule Change'}</span>
                        <strong>{scheduleChangeReceipt.appointmentId} · {scheduleChangeReceipt.customer}</strong>
                      </div>
                      <button aria-label="Dismiss schedule change receipt" disabled={!scheduleChangeResolved} onClick={() => setScheduleChangeReceipt(null)}>×</button>
                    </header>
                    <div className="schedule-change-path">
                      <span><b>Previous</b>{scheduleChangeReceipt.sourceTruck} · {scheduleChangeReceipt.sourceTime}</span>
                      <ArrowRight size={14} />
                      <span><b>{scheduleChangeReceipt.undone ? 'Was Changed To' : 'Proposed'}</b>{scheduleChangeReceipt.targetTruck} · {scheduleChangeReceipt.targetTime}</span>
                      <div className="schedule-change-facts">{scheduleChangeReceipt.changes.map((change) => <small key={change}>{change}</small>)}</div>
                    </div>
                    <div className="schedule-change-followup">
                      <button
                        className={!scheduleChangeReceipt.requiresCustomerConfirmation ? 'not-required' : scheduleChangeReceipt.customerConfirmed ? 'complete' : ''}
                        disabled={!scheduleChangeReceipt.requiresCustomerConfirmation || scheduleChangeReceipt.customerConfirmed || scheduleChangeReceipt.undone || scheduleChangeReceipt.syncState !== 'verified'}
                        onClick={() => recordScheduleChangeFollowup('customer')}
                      >
                        <span>Customer Confirmation</span>
                        <strong>{!scheduleChangeReceipt.requiresCustomerConfirmation ? 'Not Required' : scheduleChangeReceipt.customerConfirmed ? 'Recorded' : scheduleChangeReceipt.undone ? 'Not Required' : scheduleChangeReceipt.syncState === 'verified' ? 'Needed' : 'Waiting'}</strong>
                        <small>{!scheduleChangeReceipt.requiresCustomerConfirmation ? 'No customer-facing detail changed' : scheduleChangeReceipt.customerConfirmed ? 'Manager-confirmed' : scheduleChangeReceipt.syncState === 'verified' ? 'Record after customer confirms' : 'Available after source verification'}</small>
                      </button>
                      <button
                        className={!scheduleChangeReceipt.requiresCrewNotification ? 'not-required' : scheduleChangeReceipt.crewNotified ? 'complete' : ''}
                        disabled={!scheduleChangeReceipt.requiresCrewNotification || scheduleChangeReceipt.crewNotified || scheduleChangeReceipt.undone || scheduleChangeReceipt.syncState !== 'verified'}
                        onClick={() => recordScheduleChangeFollowup('crew')}
                      >
                        <span>Crew Notification</span>
                        <strong>{!scheduleChangeReceipt.requiresCrewNotification ? 'Not Required' : scheduleChangeReceipt.crewNotified ? 'Recorded' : scheduleChangeReceipt.undone ? 'Not Required' : scheduleChangeReceipt.syncState === 'verified' ? 'Needed' : 'Waiting'}</strong>
                        <small>{!scheduleChangeReceipt.requiresCrewNotification ? 'No assignment or service instruction changed' : scheduleChangeReceipt.crewNotified ? `Recorded for ${scheduleChangeReceipt.targetTruck}` : scheduleChangeReceipt.syncState === 'verified' ? 'Record after crew is notified' : 'Available after source verification'}</small>
                      </button>
                      <div className={`schedule-change-source ${scheduleChangeReceipt.syncState}`}>
                        <span>JunkWare Sync</span>
                        <strong>{scheduleChangeReceipt.undone ? 'Not Applied' : scheduleChangeSyncCopy[scheduleChangeReceipt.syncState].label}</strong>
                        <small>{scheduleChangeReceipt.undone ? 'The unverified local change was removed' : scheduleChangeReceipt.sourceVerifiedAt ? `${scheduleChangeReceipt.day === 'today' ? 'Today' : 'Tomorrow'} · ${scheduleChangeReceipt.targetTruck} · ${scheduleChangeReceipt.targetTime} · ${scheduleChangeReceipt.sourceVerifiedAt}` : scheduleChangeSyncCopy[scheduleChangeReceipt.syncState].detail}</small>
                      </div>
                    </div>
                    <footer>
                      <small>{scheduleChangeReceipt.undone ? 'The original truck and time are restored.' : scheduleChangeReceipt.syncState === 'verified' ? 'Prototype source read-back passed. Communications remain separate actions.' : ['uncertain', 'safe-retry'].includes(scheduleChangeReceipt.syncState) ? 'Do not notify the customer or Krewe until the source state is verified.' : 'Prototype sync simulation · No external write or message is sent.'}</small>
                      <div>
                        {scheduleChangeReceipt.syncState === 'uncertain' && !scheduleChangeReceipt.undone && <Button variant="outline" size="sm" onClick={searchScheduleMoveInJunkWare}>Search JunkWare</Button>}
                        {scheduleChangeReceipt.syncState === 'searching' && !scheduleChangeReceipt.undone && <Button variant="outline" size="sm" disabled>Searching…</Button>}
                        {scheduleChangeReceipt.syncState === 'safe-retry' && !scheduleChangeReceipt.undone && <Button size="sm" onClick={retryScheduleMoveSync}>Retry Sync</Button>}
                        {['uncertain', 'safe-retry'].includes(scheduleChangeReceipt.syncState) && !scheduleChangeReceipt.undone && <Button variant="outline" size="sm" onClick={undoScheduleMove}>Restore Previous Plan</Button>}
                        {scheduleChangeResolved && <Button variant="ghost" size="sm" onClick={() => setScheduleChangeReceipt(null)}>Dismiss</Button>}
                      </div>
                    </footer>
                  </section>
                )}
                <section className="appointment-register">
                  <div className="section-title appointment-register-title">
                    <div><span className="section-kicker">{visibleAppointmentCount} shown · {scheduleFilterSummary}</span><h2>All Appointments</h2></div>
                    {!scheduleFiltersActive && !territoryPriority ? <Button variant="ghost" size="sm" onClick={exportScheduleDay}>Export Day <ArrowRight /></Button> : <Button variant="outline" size="sm" onClick={resetScheduleSelection}>Show All {scheduledAppointments.length}</Button>}
                  </div>
                  <nav className="appointment-territory-toolbar" aria-label="Prioritize territory">
                    <span>Territory order</span>
                    {appointmentsByTerritory.map((group) => (
                      <button className={territoryPriority === group.designator ? 'active' : ''} onClick={() => { setScheduleScope('ALL'); setTerritoryPriority(group.designator); }} key={group.designator} title={`Move ${group.territory} to the top`}><i className={group.territory.toLowerCase().replaceAll(' ', '-')} />{group.designator}<small>{group.appointments.length}</small></button>
                    ))}
                    <button className="reset-order" onClick={resetScheduleSelection} disabled={!territoryPriority && scheduleScope === 'ALL'}>Reset order</button>
                  </nav>
                  <div className="appointment-register-table" role="table" aria-label="All scheduled appointments">
                    {orderedVisibleAppointmentGroups.length === 0 && <div className="appointment-empty-state"><strong>No appointments match this view</strong><span>Clear the schedule filters to return to the full operating day.</span><Button variant="outline" size="sm" onClick={resetScheduleSelection}>Clear filters</Button></div>}
                    {orderedVisibleAppointmentGroups.map((group) => (
                      <section className={`appointment-territory-group ${group.territory.toLowerCase().replaceAll(' ', '-')}`} role="rowgroup" key={group.territory}>
                        <div className="appointment-territory-heading"><div><i /><button className={scheduleScope === `T:${group.designator}` ? 'active' : ''} onClick={() => setScheduleScope(`T:${group.designator}`)} aria-label={`Focus ${group.territory}`}>{group.designator}</button><button className="territory-record-link" onClick={() => openTerritoryRecord(group.territory)}>{group.territory}<ArrowRight size={11} /></button></div><span>{group.appointments.length} appointment{group.appointments.length === 1 ? '' : 's'}</span></div>
                        <div className="appointment-register-head" role="row">
                          <span>Time</span><span>Appointment</span><span>Customer</span><span>Service location</span><span>Assignment</span><span>Work</span><span>Status and notes</span>
                        </div>
                        {group.areas.map((area) => (
                          <section className={`appointment-area-group ${area.code.toLowerCase()}`} key={`${group.territory}-${area.code}`}>
                            <div className="appointment-area-heading"><div><button className={scheduleScope === `A:${group.designator}:${area.code}` ? 'active' : ''} onClick={() => setScheduleScope(`A:${group.designator}:${area.code}`)} aria-label={`Focus ${area.label}`}>{area.code}</button><button className="area-record-link" onClick={() => openAreaRecord(group.territory, area.code)}>{area.label}<ArrowRight size={10} /></button></div><span>{area.appointments.length} appointment{area.appointments.length === 1 ? '' : 's'}</span></div>
                            {area.appointments.map((appointment) => (
                              <article className={`appointment-register-row${appointment.state === 'Canceled' ? ' canceled' : appointment.state === 'Estimate Closed' ? ' estimate-closed' : ''}`} role="row" key={`${appointment.truck}-${appointment.jk}`}>
                                <div><strong>{appointment.time}</strong><small>{appointment.kind}</small></div>
                                <div>{renderJkLink(appointment.jk, 'JunkWare schedule', 'Live')}</div>
                                <div><strong>{appointment.customer}</strong><PhoneContact phone={appointment.details.phone} /></div>
                                <div><GoogleMapsAddress address={appointment.details.address} /><small>{appointment.area}</small></div>
                                <div><strong>{appointment.truck}</strong><small>{appointment.crew}</small></div>
                                <div><strong>{appointment.details.scope}</strong><small>{appointment.details.value}</small></div>
                                <div><span className={`appointment-state ${appointment.state.toLowerCase().replaceAll(' ', '-')}`}>{appointment.state}</span><small>{appointment.cancellationReason ? appointment.cancellationReason : `${appointment.addressVerified ? 'Address verified · ' : ''}${appointment.details.notes}`}</small></div>
                              </article>
                            ))}
                          </section>
                        ))}
                      </section>
                    ))}
                  </div>
                </section>
              </>}

              {scheduleView === 'calendar' && (
                <section className="schedule-calendar-shell">
                  <div className="section-title"><div><span className="section-kicker">31 days · {scheduleCalendarTotal} appointments</span><h2>August 2026</h2></div><Button variant="outline" size="sm" onClick={openScheduleMonthSummary}>Monthly Summary <ArrowRight /></Button></div>
                  <div className="schedule-calendar-grid">
                    {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span className="calendar-weekday" key={day}>{day}</span>)}
                    {Array.from({ length: 42 }, (_, index) => {
                      const day = index - 4;
                      if (day < 1 || day > 31) return <span className="calendar-empty" key={`empty-${index}`} />;
                      const count = scheduleCalendarCounts[day] || 0;
                      const dayLabel = new Date(2026, 7, day).toLocaleDateString([], { weekday: 'short' });
                      const territoryCounts = calendarTerritoryBreakdown(day, count).filter((territory) => territory.count > 0);
                      return (
                        <button className={`calendar-day${day === selectedCalendarDay ? ' selected' : ''}`} aria-pressed={day === selectedCalendarDay} key={day} onClick={() => { const date = `2026-08-${String(day).padStart(2, '0')}`; setSelectedCalendarDay(day); setOperatingDate(date); setCalendarDateDraft(date); }}>
                          <strong><b>{day}</b><em>{dayLabel}</em></strong><span>{count ? `${count} scheduled` : 'No appointments'}</span>
                          {territoryCounts.length > 0 ? <small>{territoryCounts.map((territory) => <i className={`territory-${territory.code.toLowerCase()}`} key={territory.code}><b>{territory.code}</b>{territory.count}</i>)}</small> : null}
                        </button>
                      );
                    })}
                  </div>
                  <section className="calendar-selection-panel" aria-label={`${selectedCalendarLabel} schedule summary`}>
                    <div className="calendar-selection-heading"><span>{selectedCalendarDay === 31 ? 'Today' : 'Selected day'}</span><strong>{selectedCalendarLabel}</strong><small>{selectedCalendarCount ? `${selectedCalendarCount} appointments across ${selectedCalendarTerritories.filter((territory) => territory.count > 0).length} territories` : 'No appointments scheduled'}</small></div>
                    <div className="calendar-selection-metrics">
                      <div><span>Scheduled</span><strong>{selectedCalendarCount}</strong></div>
                      <div><span>Routes</span><strong>{selectedCalendarCount ? Math.max(1, Math.ceil(selectedCalendarCount / 3)) : 0}</strong></div>
                      <div><span>Capacity</span><strong>{selectedCalendarCount ? Math.max(0, 18 - selectedCalendarCount) : 18}</strong><small>open slots</small></div>
                    </div>
                    <div className="calendar-territory-summary" aria-label="Territory counts">
                      {selectedCalendarTerritories.map((territory) => <span className={`territory-${territory.code.toLowerCase()}${territory.count ? '' : ' empty'}`} key={territory.code}><b>{territory.code}</b>{territory.count}</span>)}
                    </div>
                    {selectedCalendarDay === 31
                      ? <Button onClick={() => { changeScheduleDay('today'); setScheduleView('board'); }}>Open live board <ArrowRight /></Button>
                      : <Button variant="outline" onClick={() => openRecordDrawer({
                        kicker: 'Calendar day', title: selectedCalendarLabel, summary: `${selectedCalendarCount} scheduled appointments`,
                        action: 'Close summary', source: 'JunkWare schedule', updated: 'Calendar archive',
                        facts: [
                          { label: 'Appointments', value: String(selectedCalendarCount) },
                          { label: 'Routes', value: String(selectedCalendarCount ? Math.max(1, Math.ceil(selectedCalendarCount / 3)) : 0) },
                          { label: 'Territories', value: selectedCalendarTerritories.filter((territory) => territory.count > 0).map((territory) => `${territory.code} ${territory.count}`).join(' · ') || 'None' },
                        ],
                      })}>Review day summary <ArrowRight /></Button>}
                  </section>
                </section>
              )}

              {scheduleView === 'followup' && (
                <section className="schedule-followup-shell">
                  <div className="section-title"><div><span className="section-kicker">{activeFollowups.length} active · Sorted by urgency</span><h2>Follow-Up Queue</h2></div>{handledFollowups.length > 0 && <Button variant="outline" size="sm" onClick={() => setHandledFollowups([])}>Restore handled</Button>}</div>
                  <div className="followup-overview" aria-label="Follow-up summary">
                    <button className={followupFilter === 'all' ? 'active' : ''} onClick={() => setFollowupFilter('all')}><span>Due now</span><strong>{activeFollowups.filter((item) => item.priority === 'critical').length}</strong><small>Oldest · 2h 16m</small></button>
                    <button className={followupFilter === 'estimates' ? 'active' : ''} onClick={() => setFollowupFilter('estimates')}><span>Open estimates</span><strong>{followupCounts.estimates}</strong><small>Pricing and contact</small></button>
                    <button className={followupFilter === 'unclosed' ? 'active' : ''} onClick={() => setFollowupFilter('unclosed')}><span>Unclosed jobs</span><strong>{followupCounts.unclosed}</strong><small>Closeout required</small></button>
                    <button className={followupFilter === 'photos' ? 'active' : ''} onClick={() => setFollowupFilter('photos')}><span>Missing photos</span><strong>{followupCounts.photos}</strong><small>Verify complete batch</small></button>
                  </div>
                  <div className="followup-filters">
                    {([['all', 'All'], ['estimates', 'Open estimates'], ['closed', 'Closed estimates'], ['unclosed', 'Unclosed jobs'], ['photos', 'Missing photos']] as const).map(([value, label]) => (
                      <button className={followupFilter === value ? 'active' : ''} onClick={() => setFollowupFilter(value)} key={value}>{label} <span>{followupCounts[value]}</span></button>
                    ))}
                  </div>
                  <div className="followup-list">
                    {visibleFollowups.length === 0 && <div className="followup-empty"><Check /><strong>No active records in this view</strong><span>Choose another filter or restore handled records.</span></div>}
                    {visibleFollowups.map((item) => (
                      <article className={`followup-row ${item.priority}`} key={item.jk}>
                        <div className="followup-record-type"><i /><Badge variant="outline">{item.label}</Badge><small>{item.age} open</small></div>
                        <div className="followup-record-main"><strong>{renderJkLink(item.jk, 'JunkWare follow-up', `${item.age} open`)} · {item.customer}</strong><span>{item.detail}</span><small>{item.next}</small></div>
                        <div className="followup-record-meta"><span><b>Area</b>{item.area}</span><span><b>Owner</b>{item.owner}</span></div>
                        <div className="followup-record-actions">
                          <Button variant="outline" size="sm" onClick={() => openRecordDrawer({
                            followupId: item.jk, kicker: `${item.label} · ${item.priority}`, title: item.jk, summary: item.customer, action: 'Mark handled', source: 'JunkWare follow-up', updated: `${item.age} open`,
                            facts: [
                              { label: 'Customer', value: item.customer }, { label: 'Phone', value: item.phone, href: `tel:${item.phone.replace(/\D/g, '')}` },
                              { label: 'Area', value: item.area }, { label: 'Owner', value: item.owner }, { label: 'Age', value: item.age },
                              { label: 'Context', value: item.detail }, { label: 'Next action', value: item.next },
                            ],
                          })}>Open</Button>
                          <Button variant="ghost" size="sm" onClick={() => markFollowupHandled(item.jk)}><Check />Handled</Button>
                        </div>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {scheduleView === 'history' && (
                <div className="schedule-history-grid">
                  <section className="schedule-history-shell">
                    <div className="section-title"><div><span className="section-kicker">{scheduleDay === 'today' ? 'Today' : 'Tomorrow'} · {scheduleDayHistory.length} recorded changes</span><h2>Activity History</h2></div>{historyFilter !== 'all' && <Button variant="ghost" size="sm" onClick={() => setHistoryFilter('all')}>Clear filter</Button>}</div>
                    <div className="history-overview" role="tablist" aria-label="History filters">
                      {[
                        { key: 'all', label: 'All activity', detail: 'Full audit trail' },
                        { key: 'plan', label: 'Plan changes', detail: 'Time and assignment' },
                        { key: 'cancelled', label: 'Cancellations', detail: 'Capacity released' },
                        { key: 'confirmation', label: 'Confirmations', detail: 'Status and verification' },
                      ].map((item) => <button className={historyFilter === item.key ? 'active' : ''} role="tab" aria-selected={historyFilter === item.key} onClick={() => setHistoryFilter(item.key as ScheduleHistoryFilter)} key={item.key}><span>{item.label}</span><strong>{historyCounts[item.key as ScheduleHistoryFilter]}</strong><small>{item.detail}</small></button>)}
                    </div>
                    <div className="history-list">
                      {visibleHistoryRows.map((item, index) => {
                        const appointment = scheduledAppointments.find((record) => record.jk === item.jk);
                        const territoryCode = appointment ? territoryDesignators[appointment.territory] : null;
                        return (
                          <article className={`history-row ${item.type.toLowerCase()}`} key={`${item.time}-${item.jk}-${index}`}>
                            <div className="history-kind"><i /><Badge variant="outline">{item.type}</Badge><time>{item.time}</time></div>
                            <div className="history-change"><strong>{renderJkLink(item.jk, item.source, item.time)}{appointment ? ` · ${appointment.customer}` : ''}</strong><span>{item.change}</span><small>{appointment ? `${territoryCode} · ${appointment.areaDesignator.code} · ${appointment.area}` : 'Schedule record'}</small></div>
                            <div className="history-origin"><span><b>Changed by</b>{item.by}</span><span><b>Source</b>{item.source}</span></div>
                            <Button variant="outline" size="sm" onClick={() => openUnifiedJobRecord(item.jk, item.source, item.time)}>Open</Button>
                          </article>
                        );
                      })}
                      {visibleHistoryRows.length === 0 && <div className="history-empty"><Check size={19} /><strong>No matching changes</strong><span>Today’s schedule has no activity in this category.</span></div>}
                    </div>
                  </section>
                  <section className="schedule-month-summary history-audit-summary">
                    <div className="section-title"><div><span className="section-kicker">Audit coverage</span><h2>Change Sources</h2></div></div>
                    <p>Every operational change keeps its actor, source, time, and affected appointment together.</p>
                    <dl>{historySourceCounts.map((item) => <div key={item.source}><dt>{item.source}</dt><dd>{item.count}</dd></div>)}</dl>
                    <div className="history-audit-note"><span>Latest activity</span><strong>{scheduleDayHistory[0]?.time || 'No changes recorded'}</strong><small>{scheduleDayHistory[0] ? <>{scheduleDayHistory[0].type} · {renderJkLink(scheduleDayHistory[0].jk, scheduleDayHistory[0].source, scheduleDayHistory[0].time)}</> : 'The audit trail is clear.'}</small></div>
                    <Button variant="outline" size="sm" onClick={() => setScheduleView('board')}>Review current board <ArrowRight /></Button>
                  </section>
                </div>
              )}
            </section>
          )}

          {activeNav === 'Krewe' && !live && (
            <section className={`krewe-workspace krewe-view-${kreweView}`}>
              {kreweView === 'today' && <>
                <div className="krewe-kpi-strip" aria-label="Today’s Krewe summary">
                  <article><span>Krewe count</span><strong>{workingKrewe.length}</strong><small>Clocked in or job attributed</small></article>
                  <article><span>Krewe revenue</span><strong>{moneyValue(dailyKreweRevenue)}</strong><small>Credited across today’s Krewe</small></article>
                  <article><span>Average RPH</span><strong>{moneyValue(dailyAverageRph)}</strong><small>{dailyRphRows.length} members with worked hours</small></article>
                  <article><span>Employee total earnings</span><strong>{moneyValue(dailyTotalEarnings)}</strong><small>Available payroll rows only</small></article>
                </div>

                <section className="krewe-snapshot-shell">
                  <div className="section-title"><div><span className="section-kicker">Ranked by credited revenue</span><h2>Krewe Snapshot</h2></div><span className="krewe-live-label">{rankedKrewe.length} ranked</span></div>
                  <div className="krewe-snapshot-table">
                    <div className="krewe-snapshot-head"><span>Rank</span><span>Krewe member</span><span>Truck</span><span>Jobs</span><span>Revenue</span><span>Revenue / hr</span><span>Average job</span><span>Daily earnings</span></div>
                    {rankedKrewe.map((member, index) => <button className={index < 3 ? `rank-${index + 1}` : ''} onClick={() => openKreweMember(member)} key={member.id}><span className="krewe-rank">{String(index + 1).padStart(2, '0')}</span><span className="snapshot-person"><strong>{member.name}</strong><small>{member.status}</small></span><span>{member.truck}</span><span>{member.jobs ?? '—'}</span><strong>{moneyValue(member.revenue)}</strong><span>{moneyValue(member.rph)}</span><span>{moneyValue(member.averageJob)}</span><strong>{moneyValue(member.totalPay)}</strong></button>)}
                  </div>
                </section>

                <div className="krewe-summary-strip" role="tablist" aria-label="Krewe filters">
                  {[
                    { key: 'all', label: 'Full roster', detail: 'Everyone remains visible' },
                    { key: 'working', label: 'Working today', detail: 'Clocked in or job attributed' },
                    { key: 'unassigned', label: 'Unassigned', detail: 'Working without a truck' },
                    { key: 'attention', label: 'Needs attention', detail: 'Time or coverage exception' },
                    { key: 'off', label: 'Off today', detail: 'Roster only' },
                  ].map((item) => <button className={kreweFilter === item.key ? 'active' : ''} role="tab" aria-selected={kreweFilter === item.key} onClick={() => setKreweFilter(item.key as KreweFilter)} key={item.key}><span>{item.label}</span><strong>{kreweCounts[item.key as KreweFilter]}</strong><small>{item.detail}</small></button>)}
                </div>

                <div className="krewe-layout">
                  <section className="krewe-roster-shell">
                    <div className="section-title"><div><span className="section-kicker">{visibleKrewe.length} shown · Live source refresh</span><h2>Today’s Krewe Performance</h2></div>{kreweFilter !== 'all' && <Button variant="ghost" size="sm" onClick={() => setKreweFilter('all')}>Show full roster</Button>}</div>
                    <div className="krewe-performance-head"><span>Krewe member</span><span>Time</span><span>Assignment</span><span>Production</span><span>Hourly labor</span><span>Tips</span><span>Bonuses</span><span>Total pay</span><span /></div>
                    <div className="krewe-roster-list">
                      {visibleKrewe.map((member) => (
                        <article className={`krewe-performance-row${member.issue ? ' attention' : ''}`} key={member.id}>
                          <div className="krewe-identity"><i>{member.initials}</i><span><strong>{member.name}</strong><small>{member.role} · {member.id}</small></span></div>
                          <div className="krewe-time"><span className={`krewe-status ${member.status.toLowerCase().replaceAll(' ', '-')}`}>{member.status}</span><small>{member.clockIn === '—' ? 'No clock-in' : `${member.clockIn}${member.clockOut !== '—' ? `–${member.clockOut}` : ' · On shift'}`}</small></div>
                          <label className="krewe-assignment"><span className="sr-only">Truck assignment for {member.name}</span><select value={member.truck} disabled={member.status === 'Off today'} onChange={(event) => assignKreweMember(member.id, event.target.value)}>{member.status === 'Off today' && <option>Not scheduled</option>}{kreweTruckOptions.map((truck) => <option value={truck} key={truck}>{truck}</option>)}</select><small>{member.assignmentConfidence}</small></label>
                          <div className="krewe-number"><strong>{member.jobs == null ? '—' : `${member.jobs} · ${moneyValue(member.jobRevenue)}`}</strong><small>{member.revenue == null ? 'Roster only' : `${moneyValue(member.revenue)} credited`}</small></div>
                          <div className="krewe-number"><strong>{moneyValue(member.regularPay == null ? null : member.regularPay + (member.overtimeAdditional || 0))}</strong><small>{member.regularPay == null ? 'Unavailable' : `${moneyValue(member.regularPay)} regular + ${moneyValue(member.overtimeAdditional)} OT`}</small></div>
                          <div className="krewe-number"><strong>{moneyValue(member.tips)}</strong><small>today</small></div>
                          <div className="krewe-number"><strong>{member.revenueBonus == null ? '—' : moneyValue((member.revenueBonus || 0) + (member.manualBonus || 0))}</strong><small>{member.manualBonus ? `${moneyValue(member.manualBonus)} manual` : 'Revenue + manual'}</small></div>
                          <div className="krewe-number pay"><strong>{moneyValue(member.totalPay)}</strong><small>{member.hours == null ? 'Hours unavailable' : `${metricValue(member.hours, 'h')} worked`}</small></div>
                          <Button variant="outline" size="sm" onClick={() => openKreweMember(member)}>Open</Button>
                        </article>
                      ))}
                      {visibleKrewe.length === 0 && <div className="krewe-empty"><Users size={20} /><strong>No Krewe members match this view</strong><span>Clear the filter or search to return to the full roster.</span></div>}
                    </div>
                    <footer className="krewe-roster-note">Daily totals include people with a recorded clock-in or explicit job attribution. Roster-only people remain visible without invented attendance, production, or pay.</footer>
                  </section>
                  <aside className="krewe-exceptions-shell">
                    <div className="section-title"><div><span className="section-kicker">{kreweCounts.attention} need action</span><h2>Coverage Exceptions</h2></div></div>
                    {kreweMembers.filter((member) => member.issue).map((member) => (
                      <article className="krewe-exception" key={member.id}>
                        <div><Badge variant="outline">{member.status === 'Missing clock-in' ? 'Time record' : 'Assignment'}</Badge><span>{member.role}</span></div>
                        <strong>{member.name}</strong><p>{member.issue}</p><small>{member.truck} · {member.territory}</small>
                        <Button variant="outline" size="sm" onClick={() => openKreweMember(member)}>{member.status === 'Missing clock-in' ? 'Correct time' : 'Assign truck'} <ArrowRight /></Button>
                      </article>
                    ))}
                    <div className="krewe-coverage-note"><span>Coverage</span><strong>8 of 9 working members assigned</strong><small>One available driver can cover open capacity.</small></div>
                  </aside>
                </div>
              </>}

              {kreweView === 'callin' && <section className="krewe-callin-shell">
                <div className="section-title"><div><span className="section-kicker">Tomorrow · Monday, Sep 1</span><h2>Tomorrow’s Call-In Plan</h2><p>Suggested staffing based on tomorrow’s appointments, current-week hours, recent activity, and driver coverage.</p></div><Button variant="outline" size="sm" onClick={() => { setActiveNav('Schedule'); changeScheduleDay('tomorrow'); setScheduleView('board'); }}>Review tomorrow’s jobs <ArrowRight /></Button></div>
                <div className="krewe-callin-summary"><div><span>Appointments</span><strong>12</strong><small>Across 5 territories</small></div><div><span>Coverage target</span><strong>6 Krewes</strong><small>12 people</small></div><div><span>Already assigned</span><strong>10</strong><small>Confirmed on routes</small></div><div><span>Call in</span><strong>{callInCandidates.filter((candidate) => candidate.status === 'Confirmed').length} / 2</strong><small>8-hour planning estimate</small></div></div>
                <div className="krewe-callin-territories"><span><b>NS</b>3 appointments · 2 Krewes</span><span><b>JP</b>3 appointments · 1 Krewe</span><span><b>NO</b>2 appointments · 1 Krewe</span><span><b>BR</b>3 appointments · 1 Krewe</span><span><b>LF</b>1 appointment · 1 Krewe</span></div>
                <div className="krewe-callin-list">
                  {callInCandidates.map((candidate) => { const member = kreweMembers.find((item) => item.id === candidate.memberId); if (!member) return null; return (
                    <article className={`krewe-callin-row status-${candidate.status.toLowerCase()}`} key={candidate.memberId}>
                      <span className="krewe-callin-rank">{candidate.rank}</span>
                      <div className="krewe-callin-person"><div><strong>{member.name}</strong><Badge variant="outline">{candidate.suggestedRole}</Badge>{candidate.overtimeRisk && <Badge variant="outline" className="overtime-risk">Overtime risk</Badge>}</div><p>{candidate.reason}</p></div>
                      <div className="krewe-callin-metrics"><span><small>This week</small><strong>{metricValue(member.weeklyHours, ' hrs')}</strong></span><span><small>After call-in</small><strong>{metricValue(candidate.projectedHours, ' hrs')}</strong></span><span><small>Recent RPH</small><strong>{moneyValue(candidate.recentRph)}</strong></span><span><small>Jobs</small><strong>{candidate.recentJobs}</strong></span></div>
                      <div className="krewe-callin-actions"><span className={`callin-state ${candidate.status.toLowerCase()}`}>{candidate.status}</span><div>{candidate.status === 'Recommended' && <Button variant="outline" size="sm" onClick={() => updateCallInStatus(candidate.memberId, 'Called')}>Mark called</Button>}{candidate.status === 'Called' && <><Button size="sm" onClick={() => updateCallInStatus(candidate.memberId, 'Confirmed')}>Confirm</Button><Button variant="outline" size="sm" onClick={() => updateCallInStatus(candidate.memberId, 'Unavailable')}>Unavailable</Button></>}{['Confirmed', 'Unavailable'].includes(candidate.status) && <Button variant="ghost" size="sm" onClick={() => updateCallInStatus(candidate.memberId, 'Recommended')}>Reset</Button>}</div></div>
                    </article>
                  ); })}
                </div>
                <footer className="krewe-callin-note"><strong>Recommendation is not a commitment.</strong><span>Confirm availability before scheduling, and keep the call outcome attributable.</span></footer>
              </section>}

              {kreweView === 'payperiod' && <section className="krewe-period-shell">
                <div className="section-title"><div><span className="section-kicker">Aug 18–31 · Current pay period</span><h2>Pay-Period Reconciliation</h2><p>Hours, production, and earnings stay together so exceptions can be corrected without leaving Krewe.</p></div><Badge variant="outline">Source through Aug 31</Badge></div>
                <div className="krewe-period-summary"><div><span>Regular hours</span><strong>{metricValue(periodTotals.regularHours, ' hrs')}</strong></div><div><span>Overtime hours</span><strong>{metricValue(periodTotals.overtimeHours, ' hrs')}</strong></div><div><span>Credited revenue</span><strong>{moneyValue(periodTotals.revenue)}</strong></div><div><span>Hourly labor</span><strong>{moneyValue(periodTotals.labor)}</strong></div><div><span>Tips</span><strong>{moneyValue(periodTotals.tips)}</strong></div><div><span>Bonuses</span><strong>{moneyValue(periodTotals.bonuses)}</strong></div><div><span>Supplemental</span><strong>{moneyValue(periodTotals.supplemental)}</strong></div><div><span>Total pay</span><strong>{moneyValue(periodTotals.totalPay)}</strong></div></div>
                <div className="krewe-period-table">
                  <div className="krewe-period-head"><span>Krewe member</span><span>Hours</span><span>Production</span><span>Hourly labor</span><span>Tips</span><span>Bonuses</span><span>Supplemental</span><span>Total pay</span><span /></div>
                  {visibleKrewe.map((member) => <article key={member.id}><div className="krewe-identity"><i>{member.initials}</i><span><strong>{member.name}</strong><small>{member.role} · {member.id}</small></span></div><div><strong>{metricValue(member.period.regularHours + member.period.overtimeHours, ' hrs')}</strong><small>{metricValue(member.period.regularHours, ' regular')} · {metricValue(member.period.overtimeHours, ' OT')}</small></div><div><strong>{member.period.jobs} jobs</strong><small>{moneyValue(member.period.revenue)} credited</small></div><div><strong>{moneyValue(member.period.labor)}</strong><small>Regular + OT additional</small></div><div><strong>{moneyValue(member.period.tips)}</strong></div><div><strong>{moneyValue(member.period.bonuses)}</strong></div><div><strong>{moneyValue(member.period.supplemental)}</strong></div><div className="pay"><strong>{moneyValue(member.period.totalPay)}</strong></div><Button variant="outline" size="sm" onClick={() => openKreweMember(member)}>Review</Button></article>)}
                </div>
                <footer className="krewe-roster-note">Open a Krewe member to correct attendance, update the truck assignment, or add a reasoned manual bonus. Corrections remain attributable and do not overwrite the source record in this prototype.</footer>
              </section>}

              {kreweView === 'monthly' && <section className="krewe-monthly-shell">
                <div className="section-title"><div><span className="section-kicker">Monthly operating view</span><h2>{kreweMonth === 'august' ? 'August 2026' : 'July 2026'} Krewe Summary</h2><p>Labor, production, payroll, and driving signals in one reconciled view.</p></div><label className="krewe-month-select"><span>Month</span><select value={kreweMonth} onChange={(event) => setKreweMonth(event.target.value as 'august' | 'july')}><option value="august">August 2026</option><option value="july">July 2026</option></select></label></div>
                <div className="krewe-monthly-kpis">
                  <article><span>Krewe revenue</span><strong>{moneyValue(monthlyTotals.revenue)}</strong></article><article><span>Regular hours</span><strong>{metricValue(monthlyTotals.regularHours, ' hrs')}</strong></article><article><span>Overtime hours</span><strong>{metricValue(monthlyTotals.overtimeHours, ' hrs')}</strong></article><article><span>Hourly labor cost</span><strong>{moneyValue(monthlyTotals.labor)}</strong></article><article><span>Tips</span><strong>{moneyValue(monthlyTotals.tips)}</strong></article><article><span>Automated bonuses</span><strong>{moneyValue(monthlyTotals.automatedBonuses)}</strong></article><article><span>Manual bonuses</span><strong>{moneyValue(monthlyTotals.manualBonuses)}</strong></article><article><span>Total bonuses</span><strong>{moneyValue(monthlyTotals.bonuses)}</strong></article><article><span>Total payroll</span><strong>{moneyValue(monthlyTotals.totalPay)}</strong></article><article><span>Payroll % of revenue</span><strong>{monthlyTotals.revenue ? `${((monthlyTotals.totalPay / monthlyTotals.revenue) * 100).toFixed(1)}%` : '—'}</strong></article><article><span>Revenue / labor hr</span><strong>{moneyValue(monthlyTotals.regularHours + monthlyTotals.overtimeHours ? monthlyTotals.revenue / (monthlyTotals.regularHours + monthlyTotals.overtimeHours) : null)}</strong></article><article><span>Jobs completed</span><strong>{monthlyTotals.jobs}</strong></article><article><span>Average job size</span><strong>{moneyValue(monthlyTotals.jobs ? monthlyTotals.revenue / monthlyTotals.jobs : null)}</strong></article><article><span>Average driving score</span><strong>{(kreweMembers.reduce((sum, member) => sum + (member.driverScore || 0), 0) / kreweMembers.filter((member) => member.driverScore != null).length).toFixed(1)}</strong></article><article><span>Workdays</span><strong>{Math.round(23 * monthFactor)}</strong></article><article><span>Employee shifts</span><strong>{Math.round(208 * monthFactor)}</strong></article>
                </div>
                <div className="krewe-monthly-breakdown">
                  <div className="section-title"><div><span className="section-kicker">Full roster · Ranked by credited revenue</span><h2>Monthly Krewe Breakdown</h2></div></div>
                  <div className="krewe-month-head"><span>Krewe member</span><span>Hours</span><span>Jobs</span><span>Revenue</span><span>Revenue / hr</span><span>Labor</span><span>Tips</span><span>Bonuses</span><span>Total pay</span><span /></div>
                  {[...visibleKrewe].sort((a, b) => b.month.revenue - a.month.revenue).map((member) => { const hours = (member.month.regularHours + member.month.overtimeHours) * monthFactor; return <article key={member.id}><div className="krewe-identity"><i>{member.initials}</i><span><strong>{member.name}</strong><small>{member.role} · {member.id}</small></span></div><strong>{metricValue(hours, ' hrs')}</strong><strong>{Math.round(member.month.jobs * monthFactor)}</strong><strong>{moneyValue(member.month.revenue * monthFactor)}</strong><span>{moneyValue(hours ? member.month.revenue * monthFactor / hours : null)}</span><span>{moneyValue(member.month.labor * monthFactor)}</span><span>{moneyValue(member.month.tips * monthFactor)}</span><span>{moneyValue(member.month.bonuses * monthFactor)}</span><strong className="pay">{moneyValue(member.month.totalPay * monthFactor)}</strong><Button variant="outline" size="sm" onClick={() => openKreweMember(member)}>Open</Button></article>; })}
                </div>
              </section>}
            </section>
          )}

          {activeNav === 'Fleet' && !live && (
            <section className={`fleet-workspace fleet-view-${fleetView}`}>
              {fleetView === 'overview' && <>
                <section className="fleet-load-board">
                  <div className="section-title"><div><span className="section-kicker">Physical truck ledger</span><h2>Truck Load Status</h2><p>Closeouts accumulate load. Dump and metal-yard resets require an explicit verified action.</p></div></div>
                  <div className="fleet-load-cards">{fleetTruckRows.map((truck) => <button className={truck.loadPercent >= 80 ? 'critical' : truck.loadPercent >= 55 ? 'attention' : ''} onClick={() => openFleetTruck(truck)} key={truck.id}><div><strong>{truck.label}</strong><span>{truck.operatingStatus}</span></div><b>{truck.loadPercent}% full</b><span className="load-meter"><i style={{ width: `${truck.loadPercent}%` }} /></span><small>{truck.loadNote}</small><em>{truck.metalNote}</em></button>)}</div>
                </section>

                <div className="fleet-kpi-strip" aria-label="Fleet readiness summary">
                  <button className={fleetSummaryFilter === 'ready' ? 'active' : ''} aria-pressed={fleetSummaryFilter === 'ready'} onClick={() => setFleetSummaryFilter((current) => current === 'ready' ? 'all' : 'ready')}><span>Ready</span><strong>{fleetCounts.ready}</strong><small>Inspected with no blocking repair</small></button>
                  <button className={fleetSummaryFilter === 'working' ? 'active' : ''} aria-pressed={fleetSummaryFilter === 'working'} onClick={() => setFleetSummaryFilter((current) => current === 'working' ? 'all' : 'working')}><span>Working Now</span><strong>{fleetCounts.active}</strong><small>On route, en route, or on site</small></button>
                  <button className={`attention${fleetSummaryFilter === 'attention' ? ' active' : ''}`} aria-pressed={fleetSummaryFilter === 'attention'} onClick={() => setFleetSummaryFilter((current) => current === 'attention' ? 'all' : 'attention')}><span>Needs Attention</span><strong>{fleetCounts.attention}</strong><small>Inspection, repair, or service risk</small></button>
                  <button className={`critical${fleetSummaryFilter === 'out' ? ' active' : ''}`} aria-pressed={fleetSummaryFilter === 'out'} onClick={() => setFleetSummaryFilter((current) => current === 'out' ? 'all' : 'out')}><span>Out of Service</span><strong>{fleetCounts.out}</strong><small>Removed from dispatch</small></button>
                  <button className={`attention${fleetSummaryFilter === 'service' ? ' active' : ''}`} aria-pressed={fleetSummaryFilter === 'service'} onClick={() => setFleetSummaryFilter((current) => current === 'service' ? 'all' : 'service')}><span>Service Due / Soon</span><strong>{fleetCounts.service}</strong><small>Mileage or date-based target</small></button>
                  <button className={`attention${fleetSummaryFilter === 'stale' ? ' active' : ''}`} aria-pressed={fleetSummaryFilter === 'stale'} onClick={() => setFleetSummaryFilter((current) => current === 'stale' ? 'all' : 'stale')}><span>Telemetry Stale</span><strong>{fleetCounts.stale}</strong><small>Per-truck LinxUp freshness</small></button>
                </div>

                <div className="fleet-overview-grid">
                  <section className="fleet-readiness-shell">
                    <div className="section-title"><div><span className="section-kicker">{visibleFleetTrucks.length} trucks · {fleetSummaryFilterLabels[fleetSummaryFilter]}</span><h2>Fleet Readiness</h2><p>Assignment, vehicle condition, telemetry, service, and load stay together.</p></div>{fleetSummaryFilter !== 'all' && <Button variant="ghost" size="sm" onClick={() => setFleetSummaryFilter('all')}>Clear Filter</Button>}</div>
                    <div className="fleet-table-head"><span>Truck</span><span>Readiness</span><span>Live assignment</span><span>GPS</span><span>Inspection</span><span>Service</span><span>Load</span><span /></div>
                    <div className="fleet-truck-list">
                      {visibleFleetTrucks.map((truck) => <article className={`fleet-truck-row ${truck.readiness.toLowerCase().replaceAll(' ', '-')}`} key={truck.id}>
                        <div className="fleet-truck-identity"><i><Truck size={15} /></i><span><strong>{truck.label}</strong><small>{truck.vehicle} · {truck.odometer.toLocaleString()} mi</small></span></div>
                        <div><span className={`fleet-readiness ${truck.readiness.toLowerCase().replaceAll(' ', '-')}`}>{truck.readiness}</span><small>{truck.operatingStatus}</small></div>
                        <div><strong>{renderLinkedJkText(truck.assignment, 'Fleet + JunkWare', truck.gpsFresh ? `Updated ${truck.gpsAge} ago` : `Stale · ${truck.gpsAge}`)}</strong><small>{truck.driver} · {truck.navigator}</small></div>
                        <div><strong>{truck.location}</strong><small className={truck.gpsFresh ? 'fresh' : 'stale'}>{truck.gpsFresh ? `Updated ${truck.gpsAge} ago` : `Stale · ${truck.gpsAge}`}</small></div>
                        <div><strong>{truck.checklist}</strong><small>{truck.checklist === 'Missing' ? 'Complete before dispatch' : 'Daily checklist'}</small></div>
                        <div><strong>{truck.nextService}</strong><small className={`service-${truck.serviceTone}`}>{truck.serviceTone === 'due' ? 'Due now' : truck.serviceTone === 'soon' ? 'Due soon' : 'Current'}</small></div>
                        <div className="fleet-load-cell"><strong>{truck.loadPercent}%</strong><span><i style={{ width: `${truck.loadPercent}%` }} /></span><small>{truck.loadNote}</small></div>
                        <Button variant="outline" size="sm" onClick={() => openFleetTruck(truck)}>Open</Button>
                      </article>)}
                      {visibleFleetTrucks.length === 0 && <div className="job-record-empty-row">No trucks match this Fleet filter.</div>}
                    </div>
                  </section>
                  <aside className="fleet-exceptions-shell">
                    <div className="section-title"><div><span className="section-kicker">{activeFleetIssues.length} active</span><h2>Fleet Exceptions</h2></div><Button variant="ghost" size="sm" onClick={() => setFleetView('maintenance')}>All repairs <ArrowRight /></Button></div>
                    {activeFleetIssues.map((issue) => { const truck = fleetTruckRows.find((item) => item.id === issue.truckId); return <article className={`fleet-exception ${issue.severity.toLowerCase().replaceAll(' ', '-')}`} key={issue.id}><div><Badge variant="outline">{issue.severity}</Badge><span>{issue.status}</span></div><strong>{truck?.label} · {issue.title}</strong><p>{issue.description}</p><small>{issue.owner || 'Unassigned'} · Due {issue.due || 'not set'}</small><Button variant="outline" size="sm" onClick={() => openFleetIssue(issue)}>Open work order <ArrowRight /></Button></article>; })}
                    <div className="fleet-source-note"><span>Telemetry</span><strong>{fleetTruckRows.length - fleetCounts.stale} of {fleetTruckRows.length} reporting fresh</strong><small>Fleet-wide collection health does not override a stale individual tracker.</small></div>
                  </aside>
                </div>

              </>}

              {fleetView === 'maintenance' && <section className="fleet-maintenance-shell">
                <div className="fleet-maintenance-summary"><article><span>Ready</span><strong>{fleetCounts.ready}</strong><small>Inspection complete, no blocker</small></article><article><span>Missing inspection</span><strong>{fleetTruckRows.filter((truck) => truck.checklist === 'Missing').length}</strong><small>Complete before dispatch</small></article><article><span>Active repairs</span><strong>{activeFleetIssues.length}</strong><small>{activeFleetIssues.filter((issue) => issue.status === 'In progress').length} in progress</small></article><article><span>Out of service</span><strong>{fleetCounts.out}</strong><small>Dispatch blocked</small></article></div>
                <section className="fleet-inspection-shell">
                  <div className="section-title"><div><span className="section-kicker">Today · Daily readiness</span><h2>Inspection Status</h2><p>Missing inspections remain actionable beside open repair counts.</p></div></div>
                  <div className="fleet-inspection-grid">{fleetTruckRows.map((truck) => { const issues = activeFleetIssues.filter((issue) => issue.truckId === truck.id); return <article className={truck.checklist === 'Missing' ? 'missing' : ''} key={truck.id}><div><strong>{truck.label}</strong><span className={`fleet-readiness ${truck.readiness.toLowerCase().replaceAll(' ', '-')}`}>{truck.readiness}</span></div><p>{truck.checklist === 'Complete' ? 'Daily checklist complete' : 'Daily checklist missing'}</p><small>{issues.length ? `${issues.length} active repair${issues.length === 1 ? '' : 's'}` : 'No open repairs'}</small>{truck.checklist === 'Missing' ? <Button size="sm" onClick={() => completeFleetChecklist(truck.id)}>Mark inspected</Button> : <Button variant="outline" size="sm" onClick={() => openFleetTruck(truck)}>Review truck</Button>}</article>; })}</div>
                </section>
                <section className="fleet-repair-shell">
                  <div className="section-title"><div><span className="section-kicker">Repair work orders</span><h2>Repair Queue</h2><p>Status, owner, due date, resolution, cost, and downtime remain together.</p></div><div className="fleet-repair-filters"><button className={fleetIssueFilter === 'active' ? 'active' : ''} onClick={() => setFleetIssueFilter('active')}>Active</button><button className={fleetIssueFilter === 'all' ? 'active' : ''} onClick={() => setFleetIssueFilter('all')}>All history</button></div></div>
                  <div className="fleet-repair-head"><span>Truck</span><span>Issue</span><span>Severity</span><span>Status</span><span>Owner</span><span>Due</span><span>Cost</span><span>Downtime</span><span /></div>
                  <div className="fleet-repair-list">{visibleFleetIssues.map((issue) => { const truck = fleetTruckRows.find((item) => item.id === issue.truckId); return <article className={issue.status === 'Resolved' ? 'resolved' : ''} key={issue.id}><strong>{truck?.label}</strong><div><strong>{issue.title}</strong><small>{issue.description}</small></div><span className={`repair-severity ${issue.severity.toLowerCase().replaceAll(' ', '-')}`}>{issue.severity}</span><strong>{issue.status}</strong><span>{issue.owner || 'Unassigned'}</span><span>{issue.due || '—'}</span><strong>{moneyValue(issue.cost)}</strong><span>{metricValue(issue.downtime, ' hrs')}</span><Button variant="outline" size="sm" onClick={() => openFleetIssue(issue)}>Update</Button></article>; })}</div>
                </section>
              </section>}

              {fleetView === 'service' && <section className="fleet-service-shell">
                <div className="section-title"><div><span className="section-kicker">Mileage + date planning</span><h2>Preventive-Service Planner</h2><p>Planning guides use completed maintenance and current vehicle mileage.</p></div></div>
                <div className="fleet-service-truck-tabs" role="tablist" aria-label="Service plan by truck">{fleetTruckRows.map((truck) => <button className={selectedServiceTruck === truck.id ? 'active' : ''} onClick={() => setSelectedServiceTruck(truck.id)} role="tab" aria-selected={selectedServiceTruck === truck.id} key={truck.id}>{truck.label}</button>)}</div>
                <div className="fleet-service-vehicle"><div><span>Vehicle</span><strong>{selectedFleetServiceTruck.vehicle}</strong><small>{selectedFleetServiceTruck.label}</small></div><div><span>Current mileage</span><strong>{selectedFleetServiceTruck.odometer.toLocaleString()} mi</strong><small>Latest LinxUp inventory</small></div><div><span>Next service</span><strong>{selectedFleetServiceTruck.nextService}</strong><small className={`service-${selectedFleetServiceTruck.serviceTone}`}>{selectedFleetServiceTruck.serviceTone === 'due' ? 'Due now' : selectedFleetServiceTruck.serviceTone === 'soon' ? 'Due soon' : 'Current'}</small></div></div>
                <div className="fleet-service-table"><div className="fleet-service-head"><span>Service</span><span>Last completed</span><span>Next target</span><span>Status</span><span /></div>{serviceTypes.map((service, index) => { const key = `${selectedFleetServiceTruck.id}:${service.key}`; const scheduled = scheduledServices.includes(key); const primary = index === (selectedFleetServiceTruck.serviceTone === 'due' ? 3 : selectedFleetServiceTruck.serviceTone === 'soon' ? 0 : 2); const status = scheduled ? 'Scheduled' : primary ? selectedFleetServiceTruck.serviceTone === 'due' ? 'Due now' : selectedFleetServiceTruck.serviceTone === 'soon' ? 'Due soon' : 'Current' : 'Current'; return <article key={service.key}><div><strong>{service.label}</strong><small>{service.interval}</small></div><div><strong>{index % 2 ? 'Jul 14, 2026' : 'Jun 22, 2026'}</strong><small>{(selectedFleetServiceTruck.odometer - (index + 1) * 1260).toLocaleString()} mi</small></div><div><strong>{primary ? selectedFleetServiceTruck.nextService : index % 2 ? 'Oct 12, 2026' : 'Nov 18, 2026'}</strong><small>{service.key === 'oil' ? `${(selectedFleetServiceTruck.odometer + 1240).toLocaleString()} mi` : 'Date target'}</small></div><span className={`service-status ${status.toLowerCase().replaceAll(' ', '-')}`}>{status}</span>{scheduled ? <small>Added to plan</small> : <Button variant="outline" size="sm" onClick={() => scheduleFleetService(selectedFleetServiceTruck.id, service.key)}>Schedule</Button>}</article>; })}</div>
                <footer className="fleet-service-note">Planning intervals are guides. Manufacturer requirements and shop recommendations take priority.</footer>
              </section>}

              {fleetView === 'reports' && <section className="fleet-reports-shell">
                <div className="section-title"><div><span className="section-kicker">{fleetReportMonth === 'august' ? 'August 2026' : 'July 2026'} · Monthly fleet</span><h2>Performance and Cost Report</h2><p>Production, utilization, driving, repair cost, and downtime by truck.</p></div><label className="fleet-month-select"><span>Month</span><select value={fleetReportMonth} onChange={(event) => setFleetReportMonth(event.target.value as 'august' | 'july')}><option value="august">August 2026</option><option value="july">July 2026</option></select></label></div>
                <div className="fleet-report-kpis"><article><span>Fleet revenue</span><strong>{moneyValue(fleetTotals.revenue * fleetReportFactor)}</strong></article><article><span>Jobs completed</span><strong>{Math.round(fleetTotals.jobs * fleetReportFactor)}</strong></article><article><span>Average job</span><strong>{moneyValue(fleetTotals.jobs ? fleetTotals.revenue / fleetTotals.jobs : null)}</strong></article><article><span>Miles driven</span><strong>{Math.round(fleetTotals.miles * fleetReportFactor).toLocaleString()}</strong></article><article><span>Idle time</span><strong>{metricValue(fleetTotals.idle * fleetReportFactor / 60, ' hrs')}</strong></article><article><span>Repair cost</span><strong>{moneyValue(fleetIssues.reduce((sum, issue) => sum + (issue.cost || 0), 0) * fleetReportFactor)}</strong></article><article><span>Downtime</span><strong>{metricValue(fleetIssues.reduce((sum, issue) => sum + issue.downtime, 0) * fleetReportFactor, ' hrs')}</strong></article><article><span>Average driver score</span><strong>{(fleetTruckRows.reduce((sum, truck) => sum + (truck.driverScore || 0), 0) / fleetTruckRows.filter((truck) => truck.driverScore != null).length).toFixed(1)}</strong></article></div>
                <div className="fleet-report-table"><div className="fleet-report-head"><span>Truck</span><span>Readiness</span><span>Jobs</span><span>Revenue</span><span>Miles</span><span>Idle</span><span>Driver score</span><span>Repair cost</span><span>Downtime</span><span /></div>{fleetTruckRows.map((truck) => { const issues = fleetIssues.filter((issue) => issue.truckId === truck.id); return <article key={truck.id}><div className="fleet-truck-identity"><i><Truck size={14} /></i><span><strong>{truck.label}</strong><small>{truck.vehicle}</small></span></div><span className={`fleet-readiness ${truck.readiness.toLowerCase().replaceAll(' ', '-')}`}>{truck.readiness}</span><strong>{Math.round(truck.jobs * fleetReportFactor)}</strong><strong>{moneyValue(truck.revenue * fleetReportFactor)}</strong><span>{Math.round(truck.miles * fleetReportFactor).toLocaleString()} mi</span><span>{metricValue(truck.idleMinutes * fleetReportFactor, ' min')}</span><strong>{truck.driverScore ?? '—'}</strong><span>{moneyValue(issues.reduce((sum, issue) => sum + (issue.cost || 0), 0) * fleetReportFactor)}</span><span>{metricValue(issues.reduce((sum, issue) => sum + issue.downtime, 0) * fleetReportFactor, ' hrs')}</span><Button variant="outline" size="sm" onClick={() => openFleetTruck(truck)}>Open</Button></article>; })}</div>
              </section>}
            </section>
          )}

          {activeNav === 'Marketing' && !live && (
            <section className={`marketing-workspace marketing-view-${marketingView}`}>
              {actionFeedback && <p className="marketing-feedback" role="status"><Check size={14} />{actionFeedback}</p>}

              {marketingView === 'overview' && <>
                <div className="marketing-kpi-strip" aria-label="Marketing operating summary">
                  <button className="critical" onClick={() => setMarketingView('leads')}><span>Leads to Recover</span><strong>{marketingRecoveryLeads.length}</strong><small>{marketingLostCount} lost · Highest priority first</small></button>
                  <button onClick={() => setMarketingView('performance')}><span>Qualified Calls</span><strong>{marketingTotals.qualified}</strong><small>{marketingTotals.calls} total SearchKings calls</small></button>
                  <button onClick={() => setMarketingView('performance')}><span>Matched JunkWare Bookings</span><strong>{marketingTotals.bookings}</strong><small>Last 7 days: 20 · ↓ 20.0% vs prior 7 days</small></button>
                  <button onClick={() => setMarketingView('performance')}><span>Attributed Completed Revenue</span><strong>{moneyValue(marketingTotals.revenue)}</strong><small>Completed JunkWare appointments only</small></button>
                  <button className="attention" onClick={() => setMarketingView('reviews')}><span>Today’s Reviews</span><strong>{todaysMarketingReviews.length}</strong><small>{todaysReviewAverage == null ? 'No reviews today' : `${todaysReviewAverage.toFixed(1)} average · ${todaysMarketingReviews.filter((review) => review.status === 'Needs attribution').length} need attribution`}</small></button>
                </div>

                <div className="marketing-overview-grid">
                  <section className="marketing-recovery-shell">
                    <div className="section-title"><div><span className="section-kicker">SearchKings · Lost first</span><h2>Lead Recovery</h2><p>Customer, intent, value, contact history, and outcome controls stay in one row.</p></div><Button variant="ghost" size="sm" onClick={() => setMarketingView('leads')}>View All <ArrowRight /></Button></div>
                    <div className="marketing-lead-head"><span>Lead</span><span>Need</span><span>Quoted Value</span><span>Contact</span><span>Status</span><span /></div>
                    <div className="marketing-lead-list">{marketingRecoveryLeads.slice(0, 4).map((lead) => <article className={lead.status === 'Lost' ? 'lost' : 'followup'} key={lead.id}>
                      <div><strong>{lead.customer}</strong><small>{lead.territory} · {lead.age} ago</small></div>
                      <div><strong>{lead.intent}</strong><small>{lead.reason}</small></div>
                      <strong>{moneyValue(lead.quotedValue)}</strong>
                      <div><PhoneContact phone={lead.phone} /><small>{lead.lastContact}</small></div>
                      <span className={`marketing-lead-status ${lead.status.toLowerCase().replaceAll(' ', '-')}`}>{lead.status}</span>
                      <div className="marketing-row-actions"><a href={`tel:+1${lead.phone.replace(/\D/g, '')}`} aria-label={`Call ${lead.customer}`}><PhoneCall size={13} /></a><button onClick={() => updateMarketingLeadStatus(lead.id, 'Contacted')}>Contacted</button></div>
                    </article>)}</div>
                  </section>

                  <aside className="marketing-attention-shell">
                    <div className="section-title"><div><span className="section-kicker">Needs action</span><h2>Marketing Exceptions</h2></div></div>
                    <button onClick={() => setMarketingView('reviews')}><span className="exception-count attention">{marketingReviewCount}</span><div><strong>Reviews need attribution</strong><small>Confirm the proposed customer and JK number.</small></div><ArrowRight size={14} /></button>
                    <button onClick={() => setMarketingView('leads')}><span className="exception-count critical">3</span><div><strong>Lost leads have no outbound contact</strong><small>Oldest untouched lead is 38 minutes old.</small></div><ArrowRight size={14} /></button>
                    <button onClick={() => setMarketingView('performance')}><span className="exception-count">6</span><div><strong>Qualified calls are unmatched</strong><small>Review phone matches before crediting a booking.</small></div><ArrowRight size={14} /></button>
                    <div className="marketing-source-note"><span>Source boundary</span><strong>SearchKings identifies demand. JunkWare confirms bookings and completed revenue.</strong></div>
                  </aside>
                </div>

                <section className="marketing-funnel-shell">
                  <div className="section-title"><div><span className="section-kicker">Current month · Reconciled funnel</span><h2>Demand to Completed Revenue</h2></div><Button variant="ghost" size="sm" onClick={() => setMarketingView('performance')}>Performance Detail <ArrowRight /></Button></div>
                  <div className="marketing-funnel">
                    <article><span>SearchKings Calls</span><strong>{marketingTotals.calls}</strong><small>All tracked calls</small></article>
                    <i><ArrowRight /></i><article><span>Qualified Calls</span><strong>{marketingTotals.qualified}</strong><small>{((marketingTotals.qualified / marketingTotals.calls) * 100).toFixed(1)}% of calls</small></article>
                    <i><ArrowRight /></i><article><span>Matched Bookings</span><strong>{marketingTotals.bookings}</strong><small>{((marketingTotals.bookings / marketingTotals.qualified) * 100).toFixed(1)}% of qualified</small></article>
                    <i><ArrowRight /></i><article><span>Completed Jobs</span><strong>{marketingTotals.completed}</strong><small>Verified in JunkWare</small></article>
                    <i><ArrowRight /></i><article><span>Completed Revenue</span><strong>{moneyValue(marketingTotals.revenue)}</strong><small>Revenue authority: JunkWare</small></article>
                  </div>
                </section>
              </>}

              {marketingView === 'leads' && <section className="marketing-leads-shell">
                <div className="section-title"><div><span className="section-kicker">{visibleMarketingLeads.length} shown · SearchKings</span><h2>Leads to Recover</h2><p>Lost leads remain first; direct calling and outcome updates do not require another screen.</p></div><div className="marketing-filters">{([['recover', 'Recover'], ['lost', 'Lost'], ['followup', 'Follow-Up'], ['all', 'All']] as const).map(([key, label]) => <button className={marketingLeadFilter === key ? 'active' : ''} onClick={() => setMarketingLeadFilter(key)} key={key}>{label}</button>)}</div></div>
                <div className="marketing-lead-head detailed"><span>Lead</span><span>Need</span><span>Quoted Value</span><span>Call</span><span>Contact History</span><span>Status</span><span>Outcome</span></div>
                <div className="marketing-lead-list detailed">{visibleMarketingLeads.length ? visibleMarketingLeads.map((lead) => <article className={lead.status === 'Lost' ? 'lost' : lead.status === 'Needs follow-up' ? 'followup' : 'resolved'} key={lead.id}>
                  <div><strong>{lead.customer}</strong><PhoneContact phone={lead.phone} /><small>{lead.territory} · {lead.source}</small></div>
                  <div><strong>{lead.intent}</strong><small>{lead.reason}</small></div>
                  <strong>{moneyValue(lead.quotedValue)}</strong>
                  <button className="marketing-recording" onClick={() => setActionFeedback(`${lead.id} recording opened. Duration ${lead.callDuration}.`)}><Play size={12} />{lead.callDuration}</button>
                  <div><strong>{lead.lastContact}</strong><small>{lead.age} since the inbound call</small></div>
                  <span className={`marketing-lead-status ${lead.status.toLowerCase().replaceAll(' ', '-')}`}>{lead.status}</span>
                  <div className="marketing-outcome-actions"><a href={`tel:+1${lead.phone.replace(/\D/g, '')}`}><PhoneCall size={12} />Call</a><button onClick={() => updateMarketingLeadStatus(lead.id, 'Contacted')}>Contacted</button><button onClick={() => updateMarketingLeadStatus(lead.id, 'Booked')}>Booked</button></div>
                </article>) : <div className="marketing-empty"><strong>No leads match this view.</strong><span>Change the filter or clear the global search.</span></div>}</div>
              </section>}

              {marketingView === 'reviews' && <section className="marketing-reviews-shell">
                <div className="section-title"><div><span className="section-kicker">Podium · {marketingReviewCount} need confirmation</span><h2>Review Attribution</h2><p>Name matches are proposals only. Confirm or reassign the JK number before crediting the review.</p></div><Badge variant="outline">4 Louisiana locations</Badge></div>
                <div className="marketing-review-summary"><article><span>Reviews Loaded</span><strong>{marketingReviews.length}</strong><small>Read-only Podium source</small></article><article><span>Need Attribution</span><strong>{marketingReviewCount}</strong><small>Manager confirmation required</small></article><article><span>Attributed</span><strong>{marketingReviews.length - marketingReviewCount}</strong><small>Confirmed in this workspace</small></article><article><span>Average Rating</span><strong>{(marketingReviews.reduce((sum, review) => sum + review.stars, 0) / marketingReviews.length).toFixed(1)}</strong><small>Current review set</small></article></div>
                <div className="marketing-review-grid">{marketingReviews.map((review) => <article className={review.status === 'Attributed' ? 'attributed' : ''} key={review.id}>
                  <div className="marketing-review-heading"><div><span className="review-stars">{Array.from({ length: review.stars }).map((_, index) => <Star fill="currentColor" size={12} key={index} />)}</span><strong>{review.customer}</strong><small>{review.location} · {review.age} ago</small></div><Badge variant="outline">{review.status}</Badge></div>
                  <p>“{review.excerpt}”</p>
                  <div className="marketing-review-match"><span>Proposed JunkWare appointment</span><select value={review.selectedAppointment} onChange={(event) => selectMarketingReviewAppointment(review.id, event.target.value)} disabled={review.status === 'Attributed'}>{review.candidates.map((candidate) => <option key={candidate}>{candidate}</option>)}</select><div className="marketing-review-job-link">Open {renderJkLink(review.selectedAppointment, 'Podium + JunkWare', review.age)}</div><small>{review.candidates.length} conservative name-match candidate{review.candidates.length === 1 ? '' : 's'} · Completed jobs only</small></div>
                  {review.status === 'Attributed' ? <div className="review-confirmed"><Check size={14} />Confirmed as {renderJkLink(review.selectedAppointment, 'Podium + JunkWare', review.age)}</div> : <Button size="sm" onClick={() => confirmMarketingReview(review.id)}>Confirm Match</Button>}
                </article>)}</div>
              </section>}

              {marketingView === 'performance' && <section className="marketing-performance-shell">
                <div className="section-title"><div><span className="section-kicker">August 2026 · Source comparison</span><h2>Marketing Performance</h2><p>Calls and demand remain separate from JunkWare-authoritative bookings and completed revenue.</p></div><Badge variant="outline">Current month</Badge></div>
                <div className="marketing-performance-kpis"><article><span>Total Calls</span><strong>{marketingTotals.calls}</strong><small>SearchKings reporting</small></article><article><span>Qualified</span><strong>{marketingTotals.qualified}</strong><small>{((marketingTotals.qualified / marketingTotals.calls) * 100).toFixed(1)}% qualification</small></article><article><span>Matched Bookings</span><strong>{marketingTotals.bookings}</strong><small>Phone match within 7 days</small></article><article><span>Completed Jobs</span><strong>{marketingTotals.completed}</strong><small>Verified in JunkWare</small></article><article><span>Completed Revenue</span><strong>{moneyValue(marketingTotals.revenue)}</strong><small>Attributed completed revenue</small></article><article><span>Paid Media Cost</span><strong>{moneyValue(marketingTotals.cost)}</strong><small>{(marketingTotals.revenue / marketingTotals.cost).toFixed(2)}× completed ROAS</small></article></div>
                <div className="marketing-performance-head"><span>Source</span><span>Calls</span><span>Qualified</span><span>Bookings</span><span>Completed</span><span>Completed Revenue</span><span>Cost</span><span>ROAS</span></div>
                <div className="marketing-performance-table">{marketingSources.map((source) => <article key={source.source}><strong>{source.source}</strong><span>{source.calls}</span><span>{source.qualified} · {((source.qualified / source.calls) * 100).toFixed(0)}%</span><span>{source.bookings}</span><span>{source.completed}</span><strong>{moneyValue(source.revenue)}</strong><span>{moneyValue(source.cost)}</span><strong>{source.cost ? `${(source.revenue / source.cost).toFixed(2)}×` : 'Organic'}</strong></article>)}</div>
                <footer className="marketing-performance-note"><ShieldCheck size={14} /><span>Attribution uses normalized phone matching within seven days. A match is a booking signal; revenue appears only after JunkWare marks the appointment completed.</span></footer>
              </section>}
            </section>
          )}

          {activeNav === 'Finance' && !live && (
            <section className={`finance-workspace finance-view-${financeView}`}>
              {actionFeedback && <p className="finance-feedback" role="status"><Check size={14} />{actionFeedback}</p>}

              {financeView === 'overview' && <>
                <section className="finance-monthly-shell finance-overview-monthly">
                  <div className="section-title"><div><span className="section-kicker">August 2026 · Month to date</span><h2>Month-to-Date Totals</h2><p>Reconciled revenue, costs, and operating profit lead the Finance overview.</p></div><Badge variant="outline">Through Aug 31</Badge></div>
                  <div className="finance-monthly-kpis"><article><span>Revenue</span><strong>{moneyValue(financeMonth.revenue)}</strong><small>Reconciled JunkWare revenue</small></article><article><span>Jobs Completed</span><strong>{financeMonth.jobs}</strong><small>{moneyValue(financeMonth.revenue / financeMonth.jobs)} average job</small></article><article><span>Total Costs</span><strong>{moneyValue(financeCostTotal)}</strong><small>{((financeCostTotal / financeMonth.revenue) * 100).toFixed(1)}% of revenue</small></article><article><span>Operating Profit</span><strong>{moneyValue(financeMonth.profit)}</strong><small>{((financeMonth.profit / financeMonth.revenue) * 100).toFixed(1)}% margin</small></article><article><span>Revenue Change</span><strong>+{(((financeMonth.revenue - financePriorMonth.revenue) / financePriorMonth.revenue) * 100).toFixed(1)}%</strong><small>Versus exact prior month</small></article><article><span>Profit Change</span><strong>+{(((financeMonth.profit - financePriorMonth.profit) / financePriorMonth.profit) * 100).toFixed(1)}%</strong><small>Versus exact prior month</small></article></div>
                </section>

                <section className="finance-daily-shell">
                  <div className="section-title"><div><span className="section-kicker">Sunday, August 31</span><h2>Today’s Numbers</h2><p>Current closeouts, captured payments, costs, and estimated net for today.</p></div><Badge variant="outline">Live day</Badge></div>
                  <div className="finance-kpi-strip" aria-label="Daily finance summary">
                  <button onClick={() => setFinanceView('payments')}><span>Recorded Revenue</span><strong>{moneyValue(financeJobTotal)}</strong><small>{financePayments.length} closed jobs with payments</small></button>
                  <button onClick={() => setFinanceView('payments')}><span>Payments and Adjustments</span><strong>{moneyValue(financePaymentTotal)}</strong><small>{financeMatchedCount} of {financePayments.length} reconciled</small></button>
                  <button className={financeDifference ? 'critical' : ''} onClick={() => setFinanceView('payments')}><span>Unreconciled Difference</span><strong>{moneyValue(financeDifference)}</strong><small>{financeDifference ? 'Requires review before daily close' : 'All job payments balance'}</small></button>
                  <button onClick={() => setActionFeedback('Today’s four company cost entries are included in the daily close below.')}><span>Company Costs Today</span><strong>$412</strong><small>4 recorded cost entries</small></button>
                  <button className="healthy" onClick={() => openRecordDrawer({ kicker: 'Finance · Daily Estimate', title: 'Estimated Net Today', summary: `${moneyValue(financeJobTotal - 412)} after current company costs`, action: 'Close Summary', source: 'JunkWare closeouts + company costs', updated: 'Current operating day', facts: [{ label: 'Recorded revenue', value: moneyValue(financeJobTotal) }, { label: 'Company costs', value: '$412' }, { label: 'Estimated net', value: moneyValue(financeJobTotal - 412) }, { label: 'Calculation', value: 'Recorded revenue less current costs' }] })}><span>Estimated Net Today</span><strong>{moneyValue(financeJobTotal - 412)}</strong><small>Recorded revenue less current costs</small></button>
                  </div>
                </section>

                <div className="finance-close-grid">
                  <section className="finance-close-shell">
                    <div className="section-title"><div><span className="section-kicker">{financeCloseSteps.length} of 6 complete</span><h2>Daily Close</h2><p>Each step stays tied to its source record instead of becoming a disconnected checkbox.</p></div><Badge variant="outline">Sunday, Aug 31</Badge></div>
                    <div className="finance-close-list">
                      <article className={financeCloseSteps.includes('jobs') ? 'complete' : ''}><i>{financeCloseSteps.includes('jobs') ? <Check /> : '1'}</i><div><strong>Verify Closed Job Totals</strong><small>{financePayments.length} closed jobs · {moneyValue(financeJobTotal)} recorded revenue</small></div><span>JunkWare closeouts</span><Button variant="outline" size="sm" onClick={() => completeFinanceCloseStep('jobs')}>{financeCloseSteps.includes('jobs') ? 'Reopen' : 'Verify'}</Button></article>
                      <article className={financeCloseSteps.includes('payments') ? 'complete' : ''}><i>{financeCloseSteps.includes('payments') ? <Check /> : '2'}</i><div><strong>Reconcile Payments by Job</strong><small>{financeMatchedCount} matched · {moneyValue(financeDifference)} difference remains</small></div><span>JunkWare + QBO</span><Button variant="outline" size="sm" onClick={() => setFinanceView('payments')}>Review</Button></article>
                      <article className={financeCloseSteps.includes('costs') ? 'complete' : ''}><i>{financeCloseSteps.includes('costs') ? <Check /> : '3'}</i><div><strong>Review Company Costs</strong><small>4 entries · $412 recorded today</small></div><span>OpsBot + QBO</span><Button variant="outline" size="sm" onClick={() => completeFinanceCloseStep('costs')}>{financeCloseSteps.includes('costs') ? 'Reopen' : 'Verify'}</Button></article>
                      <article className={financeCloseSteps.includes('trucks') ? 'complete' : ''}><i>{financeCloseSteps.includes('trucks') ? <Check /> : '4'}</i><div><strong>Confirm Truck Records</strong><small>3 of 8 operating trucks submitted closeout records</small></div><span>Authoritative daily evidence</span><Button variant="outline" size="sm" onClick={() => completeFinanceCloseStep('trucks')}>{financeCloseSteps.includes('trucks') ? 'Reopen' : 'Verify'}</Button></article>
                      <article className={financeCloseSteps.includes('resale') ? 'complete' : ''}><i>{financeCloseSteps.includes('resale') ? <Check /> : '5'}</i><div><strong>Review Resale Inventory</strong><small>{financeResaleAttention} items need a disposition decision</small></div><span>Truck Records intake</span><Button variant="outline" size="sm" onClick={() => setFinanceView('resale')}>Review</Button></article>
                      <article className={financeCloseSteps.includes('recycling') ? 'complete' : ''}><i>{financeCloseSteps.includes('recycling') ? <Check /> : '6'}</i><div><strong>Review Recycling Records</strong><small>{financeRecyclingAttention} runs need a yard ticket or payment action</small></div><span>Truck Records + yard tickets</span><Button variant="outline" size="sm" onClick={() => setFinanceView('recycling')}>Review</Button></article>
                    </div>
                  </section>

                  <aside className="finance-exceptions-shell">
                    <div className="section-title"><div><span className="section-kicker">4 exception types</span><h2>Finance Exceptions</h2></div></div>
                    <button onClick={() => setFinanceView('payments')}><span className="finance-exception-count critical">1</span><div><strong>Payment difference</strong><small>JK4001204 · {moneyValue(financeDifference)} remains unreconciled.</small></div><ArrowRight /></button>
                    <button onClick={() => setActionFeedback('Truck Records opened for the three submitted closeouts.')}><span className="finance-exception-count attention">5</span><div><strong>Truck Records missing</strong><small>Operating trucks without a submitted daily record.</small></div><ArrowRight /></button>
                    <button onClick={() => setFinanceView('resale')}><span className="finance-exception-count attention">{financeResaleAttention}</span><div><strong>Resale decisions</strong><small>Retained inventory needs listing or disposition.</small></div><ArrowRight /></button>
                    <button onClick={() => setFinanceView('recycling')}><span className="finance-exception-count attention">{financeRecyclingAttention}</span><div><strong>Recycling records</strong><small>Yard ticket or payment confirmation is still open.</small></div><ArrowRight /></button>
                    <div className="finance-source-note"><span>Daily authority</span><strong>Truck Records provide daily operating evidence. JunkWare and QBO support payment reconciliation.</strong></div>
                  </aside>
                </div>

                <div className="finance-monthly-grid">
                  <section className="finance-territory-shell"><div className="section-title"><div><span className="section-kicker">Month to date · Operating contribution</span><h2>Territory Performance</h2></div></div><div className="finance-territory-head"><span>Territory</span><span>Jobs</span><span>Revenue</span><span>Direct Costs</span><span>Contribution</span></div><div className="finance-territory-list">{financeTerritories.map((territory) => <article key={territory.territory}><button className="finance-territory-link" onClick={() => openTerritoryRecord(territory.territory as ScheduleTerritory)}>{territory.territory}<ArrowRight size={11} /></button><span>{territory.jobs}</span><strong>{moneyValue(territory.revenue)}</strong><span>{moneyValue(territory.costs)}</span><strong>{territory.margin.toFixed(1)}%</strong></article>)}</div></section>
                  <section className="finance-cost-shell"><div className="section-title"><div><span className="section-kicker">Month to date · Published costs</span><h2>Cost Breakdown</h2></div></div><div className="finance-cost-list">{financeCosts.map((cost) => <article key={cost.category}><div><strong>{cost.category}</strong><small>{cost.source}</small></div><strong>{moneyValue(cost.amount)}</strong><span className={cost.amount > cost.prior ? 'up' : 'down'}>{cost.amount >= cost.prior ? '+' : ''}{(((cost.amount - cost.prior) / cost.prior) * 100).toFixed(1)}%</span></article>)}</div><footer>Total published costs <strong>{moneyValue(financeCostTotal)}</strong></footer></section>
                </div>
              </>}

              {financeView === 'payments' && <section className="finance-payments-shell">
                <div className="section-title"><div><span className="section-kicker">{financePayments.length} jobs · {financeMatchedCount} reconciled</span><h2>Payments by Job</h2><p>JK number, customer, job total, payment, adjustment, and review state remain visible together.</p></div><Badge variant="outline">Sunday, Aug 31</Badge></div>
                <div className="finance-payment-summary"><article><span>Job Totals</span><strong>{moneyValue(financeJobTotal)}</strong><small>JunkWare closeouts</small></article><article><span>Captured Payments</span><strong>{moneyValue(financePayments.reduce((sum, payment) => sum + payment.paymentAmount, 0))}</strong><small>Card and cash records</small></article><article><span>Verified Adjustments</span><strong>{moneyValue(financePayments.reduce((sum, payment) => sum + payment.adjustment, 0))}</strong><small>Explicit reconciliation entries</small></article><article className={financeDifference ? 'attention' : ''}><span>Difference</span><strong>{moneyValue(financeDifference)}</strong><small>{financeDifference ? 'Needs review' : 'Fully reconciled'}</small></article></div>
                <div className="finance-payment-head"><span>JK Number</span><span>Customer</span><span>Truck</span><span>Job Total</span><span>Payment</span><span>Adjustment</span><span>Difference</span><span>Method / Reference</span><span>Status</span><span /></div>
                <div className="finance-payment-list">{financePayments.map((payment) => { const difference = payment.jobTotal - payment.paymentAmount - payment.adjustment; return <article className={payment.status === 'Matched' ? 'matched' : 'review'} key={payment.id}><button className="finance-job-link" onClick={() => openUnifiedJobRecord(payment.id, 'JunkWare + QBO', 'Current daily close')}>{payment.id}</button><div><strong>{payment.customer}</strong><small>{payment.note}</small></div><button className="finance-truck-link" onClick={() => openFleetTruckByLabel(payment.truck)}>{payment.truck}</button><strong>{moneyValue(payment.jobTotal)}</strong><span>{moneyValue(payment.paymentAmount)}</span><span>{moneyValue(payment.adjustment)}</span><strong className={difference ? 'difference' : ''}>{moneyValue(Math.abs(difference))}</strong><div><strong>{payment.method}</strong><small>{payment.reference}</small></div><span className={`finance-payment-status ${payment.status.toLowerCase().replaceAll(' ', '-')}`}>{payment.status}</span>{payment.status === 'Matched' ? <small className="finance-balanced"><Check size={12} />Balanced</small> : <Button variant="outline" size="sm" onClick={() => confirmFinanceAdjustment(payment.id)}>Confirm Adjustment</Button>}</article>; })}</div>
                <footer className="finance-payment-note"><ShieldCheck size={14} /><span>A payment difference is never hidden. Confirming an adjustment records it separately from the captured payment and balances it against the JunkWare job total.</span></footer>
              </section>}

              {financeView === 'resale' && <>
                <div className="finance-recovery-kpis" aria-label="Resale summary">
                  <article className={financeResaleAttention ? 'attention' : ''}><span>Needs Action</span><strong>{financeResaleAttention}</strong><small>Listing or disposition required</small></article>
                  <article><span>On Hand</span><strong>{financeResaleItems.filter((item) => item.status !== 'Sold').length}</strong><small>Items currently in custody</small></article>
                  <article><span>Expected On-Hand Value</span><strong>{moneyValue(financeResaleOnHandValue)}</strong><small>Open resale inventory</small></article>
                  <article><span>Realized Revenue</span><strong>{moneyValue(financeResaleRevenue)}</strong><small>Completed sales</small></article>
                  <article><span>Source Coverage</span><strong>{financeResaleItems.length}</strong><small>Every item retains its JK source</small></article>
                </div>
                <section className="finance-resale-shell">
                  <div className="section-title"><div><span className="section-kicker">Physical custody + value</span><h2>Resale Inventory</h2><p>Source job, current location, expected value, owner, and disposition stay together.</p></div><Button variant="outline" size="sm" onClick={() => completeFinanceCloseStep('resale')}>{financeCloseSteps.includes('resale') ? 'Reopen Daily Review' : 'Mark Reviewed Today'}</Button></div>
                  <div className="finance-resale-head"><span>Item</span><span>Source Job</span><span>Location</span><span>Expected</span><span>Status</span><span>Owner</span><span /></div>
                  <div className="finance-resale-list">{financeResaleItems.map((item) => <article className={item.status === 'Sold' ? 'complete' : item.status === 'Awaiting disposition' ? 'attention' : ''} key={item.id}><div><strong>{item.item}</strong><small>{item.quantity} · {item.age} old</small></div>{renderJkLink(item.sourceJob, 'Truck Records + Finance', item.age)}<span>{item.location}</span><strong>{moneyValue(item.expectedValue)}</strong><span className={`finance-recovery-status ${item.status.toLowerCase().replaceAll(' ', '-')}`}>{item.status}</span><div><strong>{item.owner}</strong><small>{item.note}</small></div>{item.status === 'Sold' ? <small className="finance-recovery-complete"><Check size={12} />{moneyValue(item.realizedValue)}</small> : <Button variant="outline" size="sm" onClick={() => progressFinanceRecoveryItem(item.id)}>{item.status === 'Listed' ? 'Record Sale' : 'List Item'}</Button>}</article>)}</div>
                </section>
                <section className="finance-recovery-ledger">
                  <div className="section-title"><div><span className="section-kicker">Resale activity only</span><h2>Resale Value Ledger</h2></div><Badge variant="outline">{financeResaleItems.length} records</Badge></div>
                  <div className="finance-recovery-ledger-summary"><article><span>Expected Value</span><strong>{moneyValue(financeResaleItems.reduce((sum, item) => sum + item.expectedValue, 0))}</strong></article><article><span>Realized Value</span><strong>{moneyValue(financeResaleRevenue)}</strong></article><article><span>Open Expected Value</span><strong>{moneyValue(financeResaleOnHandValue)}</strong></article><article><span>Sold Records</span><strong>{financeResaleItems.filter((item) => item.status === 'Sold').length}</strong></article></div>
                  <footer><ShieldCheck size={14} />Truck Records capture the source item. Finance owns custody, listing, disposition, and realized sale value.</footer>
                </section>
              </>}

              {financeView === 'recycling' && <>
                <div className="finance-recovery-kpis" aria-label="Recycling summary">
                  <article className={financeRecyclingAttention ? 'attention' : ''}><span>Needs Action</span><strong>{financeRecyclingAttention}</strong><small>Yard or ticket action required</small></article>
                  <article><span>Open Runs</span><strong>{financeRecyclingItems.filter((item) => item.status !== 'Paid').length}</strong><small>Awaiting ticket or payment</small></article>
                  <article><span>Paid Runs</span><strong>{financeRecyclingItems.filter((item) => item.status === 'Paid').length}</strong><small>Fully reconciled records</small></article>
                  <article><span>Realized Revenue</span><strong>{moneyValue(financeRecyclingRevenue)}</strong><small>Recorded yard payments</small></article>
                  <article><span>Source Coverage</span><strong>{financeRecyclingItems.length}</strong><small>Every load retains its JK source</small></article>
                </div>
                <section className="finance-recycling-shell">
                  <div className="section-title"><div><span className="section-kicker">Yard ticket + payment</span><h2>Recycling Runs</h2><p>Material, weight, yard custody, ticket state, and realized payment remain auditable.</p></div><Button variant="outline" size="sm" onClick={() => completeFinanceCloseStep('recycling')}>{financeCloseSteps.includes('recycling') ? 'Reopen Daily Review' : 'Mark Reviewed Today'}</Button></div>
                  <div className="finance-recycling-head"><span>Material</span><span>Source Job</span><span>Location / Yard</span><span>Quantity</span><span>Expected</span><span>Realized</span><span>Status</span><span /></div>
                  <div className="finance-recycling-list">{financeRecyclingItems.map((item) => <article className={item.status === 'Paid' ? 'complete' : item.status === 'Ticket missing' ? 'attention' : ''} key={item.id}><div><strong>{item.item}</strong><small>{item.age} old · {item.owner}</small></div>{renderJkLink(item.sourceJob, 'Truck Records + Finance', item.age)}<span>{item.location}</span><span>{item.quantity}</span><strong>{moneyValue(item.expectedValue)}</strong><strong>{moneyValue(item.realizedValue)}</strong><span className={`finance-recovery-status ${item.status.toLowerCase().replaceAll(' ', '-')}`}>{item.status}</span>{item.status === 'Paid' ? <small className="finance-recovery-complete"><Check size={12} />Reconciled</small> : <Button variant="outline" size="sm" onClick={() => progressFinanceRecoveryItem(item.id)}>{item.status === 'Submitted' ? 'Mark Paid' : 'Record Ticket'}</Button>}</article>)}</div>
                </section>
                <section className="finance-recovery-ledger">
                  <div className="section-title"><div><span className="section-kicker">Recycling activity only</span><h2>Recycling Value Ledger</h2></div><Badge variant="outline">{financeRecyclingItems.length} records</Badge></div>
                  <div className="finance-recovery-ledger-summary"><article><span>Expected Value</span><strong>{moneyValue(financeRecyclingItems.reduce((sum, item) => sum + item.expectedValue, 0))}</strong></article><article><span>Realized Value</span><strong>{moneyValue(financeRecyclingRevenue)}</strong></article><article><span>Open Expected Value</span><strong>{moneyValue(financeRecyclingItems.filter((item) => item.status !== 'Paid').reduce((sum, item) => sum + item.expectedValue, 0))}</strong></article><article><span>Paid Records</span><strong>{financeRecyclingItems.filter((item) => item.status === 'Paid').length}</strong></article></div>
                  <footer><ShieldCheck size={14} />Truck Records capture the material source. Finance owns yard tickets, payment confirmation, and realized recycling value.</footer>
                </section>
              </>}

              {financeView === 'trends' && <section className="finance-trends-shell">
                <div className="section-title"><div><span className="section-kicker">Exact calendar comparison</span><h2>Finance Trends</h2><p>Monthly and year-to-date changes pair percentages with the underlying amounts.</p></div><Badge variant="outline">January–August 2026</Badge></div>
                <div className="finance-trend-cards"><article><span>Revenue</span><strong>{moneyValue(financeMonth.revenue)}</strong><b>+{(((financeMonth.revenue - financePriorMonth.revenue) / financePriorMonth.revenue) * 100).toFixed(1)}%</b><small>vs July · YTD {moneyValue(financeMonthlyTrend.reduce((sum, month) => sum + month.revenue, 0))}</small></article><article><span>Jobs Completed</span><strong>{financeMonth.jobs}</strong><b>+{(((financeMonth.jobs - financePriorMonth.jobs) / financePriorMonth.jobs) * 100).toFixed(1)}%</b><small>vs July · YTD {financeMonthlyTrend.reduce((sum, month) => sum + month.jobs, 0).toLocaleString()}</small></article><article><span>Average Job</span><strong>{moneyValue(financeMonth.revenue / financeMonth.jobs)}</strong><b>+{((((financeMonth.revenue / financeMonth.jobs) - (financePriorMonth.revenue / financePriorMonth.jobs)) / (financePriorMonth.revenue / financePriorMonth.jobs)) * 100).toFixed(1)}%</b><small>vs July average</small></article><article><span>Total Costs</span><strong>{moneyValue(financeCostTotal)}</strong><b>+{(((financeCostTotal - financePriorCostTotal) / financePriorCostTotal) * 100).toFixed(1)}%</b><small>vs July published costs</small></article><article><span>Operating Profit</span><strong>{moneyValue(financeMonth.profit)}</strong><b>+{(((financeMonth.profit - financePriorMonth.profit) / financePriorMonth.profit) * 100).toFixed(1)}%</b><small>vs July · YTD {moneyValue(financeMonthlyTrend.reduce((sum, month) => sum + month.profit, 0))}</small></article></div>
                <div className="finance-trend-head"><span>Month</span><span>Revenue</span><span>Jobs</span><span>Average Job</span><span>Total Costs</span><span>Operating Profit</span><span>Margin</span></div>
                <div className="finance-trend-table">{financeMonthlyTrend.map((month, index) => { const prior = financeMonthlyTrend[index - 1]; return <article className={month.month === 'Aug' ? 'current' : ''} key={month.month}><strong>{month.month} 2026</strong><div><strong>{moneyValue(month.revenue)}</strong><small>{prior ? `${month.revenue >= prior.revenue ? '+' : ''}${(((month.revenue - prior.revenue) / prior.revenue) * 100).toFixed(1)}%` : 'Baseline'}</small></div><strong>{month.jobs}</strong><span>{moneyValue(month.revenue / month.jobs)}</span><span>{moneyValue(month.costs)}</span><div><strong>{moneyValue(month.profit)}</strong><small>{prior ? `${month.profit >= prior.profit ? '+' : ''}${(((month.profit - prior.profit) / prior.profit) * 100).toFixed(1)}%` : 'Baseline'}</small></div><strong>{((month.profit / month.revenue) * 100).toFixed(1)}%</strong></article>; })}</div>
              </section>}
            </section>
          )}

          <footer className="command-footer"><span><ShieldCheck size={15} /> {live ? `${activeNav} · Source timestamps and unavailable inputs are shown in each view` : activeNav === 'Schedule' ? 'JunkWare schedule and LinxUp locations connected' : activeNav === 'Krewe' ? 'JunkWare attendance and schedule assignments connected' : activeNav === 'Fleet' ? 'LinxUp telemetry, Fleet maintenance, and Schedule assignments connected' : activeNav === 'Marketing' ? 'SearchKings calls, JunkWare appointments, and Podium reviews connected' : activeNav === 'Finance' ? 'Truck Records, JunkWare closeouts, and QBO reconciliation connected' : live ? 'Source-backed Command · Live integration preview' : 'JunkWare, LinxUp, QBO, and SearchKings connected'}</span><button onClick={openSourceHealth}>View Source Health {sourceAttentionCount > 0 && <b>{sourceAttentionCount}</b>}<ArrowRight size={14} /></button></footer>
        </div>
      </section>
      {sourceHealthOpen && (
        <>
          <button className="source-health-backdrop" aria-label="Close source health" onClick={() => setSourceHealthOpen(false)} />
          <aside className="source-health-drawer" role="dialog" aria-modal="true" aria-labelledby="source-health-title">
            <header className="source-health-header"><div><span>Tertiary System Status</span><h2 id="source-health-title">Source Health</h2><p>Freshness, affected workspace, and last successful update.</p></div><Button variant="ghost" size="icon" aria-label="Close" onClick={() => setSourceHealthOpen(false)}><X /></Button></header>
            <div className="source-health-body">
              <section className="source-health-summary"><div><span>Connected Sources</span><strong>{connectedSources.length}</strong></div><div><span>{live ? 'Available' : 'Healthy'}</span><strong>{connectedSources.length - sourceAttentionCount}</strong></div><div className={sourceAttentionCount ? 'attention' : ''}><span>Need Attention</span><strong>{sourceAttentionCount}</strong></div></section>
              <div className="source-health-list">{connectedSources.map((source) => <article className={source.tone} key={source.name}><header><i /><div><strong>{source.name}</strong><span>{source.area}</span></div><em>{source.state}</em></header><div><span><b>Affected Workspace</b>{source.workspace}</span><span><b>Last Successful Update</b>{source.freshness}</span></div><button onClick={() => { if ('href' in source && typeof source.href === 'string' && source.href) window.location.assign(source.href); else openSourceWorkspace(source.name); }}>{source.action}<ArrowRight size={13} /></button></article>)}</div>
              <section className="source-health-note"><ShieldCheck size={14} /><div><strong>Freshness does not replace record truth.</strong><p>A healthy collector can still contain an individual stale truck or unresolved source record.</p></div></section>
            </div>
            <footer className="source-health-actions"><Button variant="outline" onClick={() => setSourceHealthOpen(false)}>Close</Button><Button onClick={() => { setSourceHealthOpen(false); setActiveNav('Command'); setView('monitor'); }}>Open Monitor <ArrowRight size={14} /></Button></footer>
          </aside>
        </>
      )}
      {newAppointmentOpen && (
        <>
          <button className="record-drawer-backdrop" aria-label="Close new appointment" onClick={() => { if (!junkWareCreationBusy) closeNewAppointment(); }} />
          <aside className="record-drawer appointment-create-drawer" role="dialog" aria-modal="true" aria-labelledby="new-appointment-title">
            <header className="record-drawer-header">
              <div><span>{scheduleDay === 'today' ? 'Today · Aug 31' : 'Tomorrow · Sep 1'}</span><h2 id="new-appointment-title">New Appointment</h2><p>Prepare a JunkWare booking for {scheduleDay === 'today' ? 'today’s live plan' : 'tomorrow’s planning board'}.</p></div>
              <Button variant="ghost" size="icon" aria-label="Close" disabled={junkWareCreationBusy} onClick={closeNewAppointment}><X /></Button>
            </header>
            <div className="record-drawer-body">
              <section className="appointment-customer-lookup" aria-labelledby="existing-customer-lookup-title">
                <header><span>Customer</span><strong id="existing-customer-lookup-title">Find an existing customer</strong><small>Check before creating a duplicate record</small></header>
                <div className="appointment-customer-search">
                  <Search size={14} />
                  <Input
                    value={newAppointmentCustomerQuery}
                    onChange={(event) => updateExistingCustomerQuery(event.target.value)}
                    placeholder="Search name, phone, or service address"
                    aria-label="Search existing customers"
                  />
                  {selectedNewAppointmentCustomer && <button type="button" onClick={clearExistingCustomerForAppointment}>Change</button>}
                </div>
                {selectedNewAppointmentCustomer && selectedNewAppointmentCustomerLatest ? (
                  <div className="appointment-customer-selected">
                    <header><span><Check size={12} /> Existing Customer Selected</span><strong>{selectedNewAppointmentCustomer.name}</strong><small><PhoneContact phone={selectedNewAppointmentCustomer.phone} /></small></header>
                    <div>
                      <span><b>Service Addresses</b>{selectedNewAppointmentCustomerAddressCount}</span>
                      <span><b>Prior Appointments</b>{selectedNewAppointmentCustomer.appointments.length}</span>
                      <span><b>Latest Appointment</b><button type="button" className="jk-record-link" onClick={() => { const appointment = selectedNewAppointmentCustomerLatest; closeNewAppointment(); openUnifiedJobRecord(appointment.jk, 'Customer Record + JunkWare', appointment.day === 'today' ? 'Today' : 'Tomorrow plan'); }}>{selectedNewAppointmentCustomerLatest.jk}</button></span>
                    </div>
                    <p><GoogleMapsAddress address={selectedNewAppointmentCustomerLatest.details.address} /><small>{selectedNewAppointmentCustomerLatest.details.scope} · {selectedNewAppointmentCustomerLatest.area}</small></p>
                    <footer>Contact information, service address, territory, and latest customer notes were applied. Appointment work and value remain blank for this visit.</footer>
                  </div>
                ) : newAppointmentCustomerQuery.trim().length >= 2 ? (
                  newAppointmentCustomerMatches.length ? <div className="appointment-customer-results">
                    {newAppointmentCustomerMatches.map((customer) => {
                      const latestAppointment = customer.appointments[customer.appointments.length - 1];
                      const addressCount = new Set(customer.appointments.map((appointment) => appointment.details.address)).size;
                      return <article key={customer.id}>
                        <div><strong>{customer.name}</strong><span><PhoneContact phone={customer.phone} /></span><small><GoogleMapsAddress address={latestAppointment?.details.address || 'No service address'} /></small></div>
                        <span><b>{customer.appointments.length}</b> appointment{customer.appointments.length === 1 ? '' : 's'}<small>{addressCount} address{addressCount === 1 ? '' : 'es'} · Existing customer</small></span>
                        <button type="button" onClick={() => selectExistingCustomerForAppointment(customer)}>Use Customer <ArrowRight size={12} /></button>
                      </article>;
                    })}
                  </div> : <div className="appointment-customer-empty"><strong>No existing customer found</strong><span>Continue below to create this appointment for a new customer.</span></div>
                ) : <p className="appointment-customer-prompt">Search the reconciled customer history, or continue below for a new customer.</p>}
              </section>
              <section className="appointment-location-section" aria-labelledby="new-appointment-location-title">
                <header>
                  <div><span>Service Location</span><strong id="new-appointment-location-title">Verify address and coverage</strong></div>
                  <small className={newAppointmentAddressVerification?.status || 'idle'}>{newAppointmentAddressVerification?.status === 'verified' ? 'Verified' : newAppointmentAddressVerification?.status === 'outside' ? 'Outside Coverage' : newAppointmentAddressVerification ? 'Needs Review' : 'Not Checked'}</small>
                </header>
                <div className="appointment-location-fields">
                  <label className="address"><span>Service address</span><Input value={newAppointment.address} onChange={(event) => updateNewAppointmentAddress(event.target.value)} placeholder="Street, city, state, ZIP" /></label>
                  <label><span>Territory and area</span><select value={newAppointment.area} onChange={(event) => updateNewAppointmentArea(event.target.value)}>{newAppointmentAreaOptions.map((area) => { const territory = appointmentTerritoryForArea(area); const areaCode = areaDesignatorForArea(area).code; return <option value={area} key={area}>{territoryDesignators[territory]} · {areaCode} — {area}</option>; })}</select></label>
                  <Button variant="outline" size="sm" onClick={verifyNewAppointmentAddress}>Verify Address <MapPin size={13} /></Button>
                </div>
                {newAppointmentAddressVerification ? newAppointmentAddressVerification.status === 'verified' && newAppointmentAddressVerification.mapSrc ? (
                  <div className="appointment-location-verified">
                    <div className="appointment-location-map"><iframe title="Verified service location" src={newAppointmentAddressVerification.mapSrc} /></div>
                    <div className="appointment-location-summary">
                      <header><span><Check size={12} /> {newAppointmentAddressVerification.manual ? 'Area Confirmed Manually' : 'Service Location Verified'}</span><GoogleMapsAddress address={newAppointmentAddressVerification.input} /></header>
                      <div><span><b>Territory</b>{territoryDesignators[newAppointmentAddressVerification.territory!]} · {newAppointmentAddressVerification.territory}</span><span><b>Area</b>{newAppointmentAddressVerification.areaCode} · {newAppointmentAddressVerification.matchedArea}</span><span><b>Map Pin</b>{newAppointmentAddressVerification.latitude?.toFixed(4)}, {newAppointmentAddressVerification.longitude?.toFixed(4)}</span></div>
                      {newAppointmentAddressVerification.linkedAppointments.length > 0 && <p><b>Known Service Address</b>Linked to {newAppointmentAddressVerification.linkedAppointments.join(' · ')}. Review before creating a duplicate visit.</p>}
                      <footer>{newAppointmentAddressVerification.message}<small>Prototype geocode · Production must read back the verified source address.</small></footer>
                    </div>
                  </div>
                ) : (
                  <div className={`appointment-location-result ${newAppointmentAddressVerification.status}`}>
                    <MapPin size={15} />
                    <div><strong>{newAppointmentAddressVerification.status === 'outside' ? 'Address Is Outside Coverage' : newAppointmentAddressVerification.status === 'incomplete' ? 'Address Is Incomplete' : 'Confirm the Service Area'}</strong><span>{newAppointmentAddressVerification.message}</span>{newAppointmentAddressVerification.linkedAppointments.length > 0 && <small>Known address · {newAppointmentAddressVerification.linkedAppointments.join(' · ')}</small>}</div>
                    {newAppointmentAddressVerification.status === 'review' && <Button variant="outline" size="sm" onClick={confirmNewAppointmentSelectedArea}>Confirm {areaDesignatorForArea(newAppointment.area).code}</Button>}
                  </div>
                ) : <p className="appointment-location-prompt">Enter the complete service address. Verification assigns the territory, checks service coverage, and unlocks truck recommendations.</p>}
              </section>
              <section className="appointment-create-section" aria-labelledby="new-appointment-plan">
                <header><span>Schedule</span><strong id="new-appointment-plan">Place the appointment</strong></header>
                <div className="appointment-create-grid">
                  <label><span>JK Number</span><div className="appointment-jk-authority"><strong>Assigned by JunkWare</strong><small>Returned after the booking is saved</small></div></label>
                  <label><span>Type</span><select value={newAppointment.kind} onChange={(event) => setNewAppointment((form) => ({ ...form, kind: event.target.value as 'Job' | 'Estimate' }))}><option>Job</option><option>Estimate</option></select></label>
                  <label><span>Estimated volume</span><select value={newAppointment.loadPickups} onChange={(event) => setNewAppointment((form) => ({ ...form, loadPickups: Number(event.target.value) }))}>{[1, 2, 3, 4, 5, 6].map((pickups) => <option value={pickups} key={pickups}>{pickups} pickup equivalent{pickups === 1 ? '' : 's'} · {Math.round((pickups / 6) * 100)}%</option>)}</select></label>
                  <label><span>Load type</span><select value={newAppointment.loadStream} onChange={(event) => setNewAppointment((form) => ({ ...form, loadStream: event.target.value as AppointmentLoadStream }))}><option value="mixed">Mixed material</option><option value="metal">Metal-heavy</option><option value="donation">Donation / resale</option></select></label>
                  <label><span>Appointment window</span><select value={newAppointment.window} onChange={(event) => setNewAppointment((form) => ({ ...form, window: event.target.value }))}>{scheduleWindowOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}</select></label>
                  <label><span>Truck assignment</span><select value={newAppointment.truck} onChange={(event) => { setNewAppointment((form) => ({ ...form, truck: event.target.value })); setNewAppointmentError(''); }}>{scheduleRows.map((row) => { const truck = fleetTruckRows.find((item) => item.label === row.truck); return <option value={row.truck} key={row.truck}>{row.truck} · {row.crew}{truck ? ` · ${truck.loadPercent}% loaded` : ''}</option>; })}</select></label>
                </div>
                <div className="appointment-placement-assist">
                  <header>
                    <div><span>Recommended Placement</span><strong>Best route and capacity fit</strong></div>
                    <small>{newAppointment.loadPickups} pickup equivalent{newAppointment.loadPickups === 1 ? '' : 's'} · {Math.round((newAppointment.loadPickups / 6) * 100)}% · {newAppointment.loadStream === 'metal' ? 'Metal-heavy' : newAppointment.loadStream === 'donation' ? 'Donation / resale' : 'Mixed'}</small>
                  </header>
                  {newAppointmentAddressVerification?.status !== 'verified' ? <div className="appointment-placement-empty awaiting"><strong>Verify the service address first</strong><span>Truck and time recommendations require a confirmed service area and map location.</span></div> : newAppointmentPlacements.length ? (
                    <div className="appointment-placement-list">
                      {newAppointmentPlacements.map((placement, index) => {
                        const selected = selectedNewAppointmentPlacement?.truck === placement.truck && selectedNewAppointmentPlacement.window === placement.window;
                        return (
                          <button
                            type="button"
                            className={`${placement.tone} ${placement.capacityStatus}${selected ? ' selected' : ''}`}
                            aria-pressed={selected}
                            disabled={placement.capacityStatus === 'insufficient'}
                            onClick={() => applyNewAppointmentPlacement(placement)}
                            key={`${placement.truck}-${placement.window}`}
                          >
                            <i>{index === 0 ? 'Best Fit' : `Option ${index + 1}`}</i>
                            <div><strong>{placement.truck} · {placement.windowLabel}</strong><span>{placement.crew} · {placement.reason}</span></div>
                            <div><strong>{placement.minutes} min · {placement.miles} mi</strong><span>{placement.buffer < 0 ? `${Math.abs(placement.buffer)} min route shortfall` : `${placement.buffer} min route buffer`} · {placement.sameTerritory ? 'Same territory' : 'Cross-territory'}</span></div>
                            <div className="appointment-placement-load"><strong>{placement.currentLoad}% → {placement.projectedLoad}%</strong><span className="appointment-load-track"><b style={{ width: `${Math.min(100, placement.projectedLoad)}%` }} /></span><small>{placement.jobLoad}% job · {placement.capacityMessage}</small></div>
                            <em>{placement.capacityStatus === 'insufficient' ? 'No Fit' : selected ? <><Check size={11} /> Selected</> : 'Use'}</em>
                          </button>
                        );
                      })}
                    </div>
                  ) : <div className="appointment-placement-empty"><strong>No conflict-free placement found</strong><span>Choose another appointment-window length or leave the appointment unassigned.</span></div>}
                  <footer>Recommendations compare route travel, Truck Load Status, territory fit, and readiness. Scheduling does not add physical load; verified closeouts and explicit dump or yard resets update Truck Load Status.</footer>
                </div>
              </section>
              <section className="appointment-create-section" aria-labelledby="new-appointment-details">
                <header><span>Appointment details</span><strong id="new-appointment-details">Customer and work</strong></header>
                <div className="appointment-create-grid">
                  <label><span>Customer</span><Input value={newAppointment.customer} onChange={(event) => setNewAppointment((form) => ({ ...form, customer: event.target.value }))} placeholder="Customer name" /></label>
                  <label><span>Phone</span><Input value={newAppointment.phone} onChange={(event) => setNewAppointment((form) => ({ ...form, phone: event.target.value }))} placeholder="(504) 555-0123" /></label>
                  <label><span>Work</span><Input value={newAppointment.scope} onChange={(event) => setNewAppointment((form) => ({ ...form, scope: event.target.value }))} placeholder="Removal or estimate scope" /></label>
                  <label><span>Value</span><Input value={newAppointment.value} onChange={(event) => setNewAppointment((form) => ({ ...form, value: event.target.value }))} placeholder="$0 or quoted value" /></label>
                  <label className="wide"><span>Notes</span><Textarea value={newAppointment.notes} onChange={(event) => setNewAppointment((form) => ({ ...form, notes: event.target.value }))} placeholder="Access, call-ahead, items, or customer instructions" /></label>
                </div>
              </section>
              <section className={`appointment-duplicate-check ${exactDuplicateBookings.length ? 'blocked' : possibleDuplicateBookings.length ? 'review' : duplicateCheckReady ? 'clear' : 'pending'}`} aria-labelledby="appointment-duplicate-check-title">
                <header>
                  <div><span>Duplicate Check</span><strong id="appointment-duplicate-check-title">{exactDuplicateBookings.length ? 'Existing Appointment Found' : possibleDuplicateBookings.length ? 'Possible Match Requires Review' : duplicateCheckReady ? 'No Duplicate Match Found' : 'Complete Booking Identity'}</strong></div>
                  <small>{exactDuplicateBookings.length ? 'Blocked' : possibleDuplicateBookings.length ? 'Reason Required' : duplicateCheckReady ? 'Clear' : 'Pending'}</small>
                </header>
                {newAppointmentDuplicateMatches.length > 0 ? (
                  <div className="appointment-duplicate-list">
                    {newAppointmentDuplicateMatches.map((match) => (
                      <article className={match.level} key={match.appointment.jk}>
                        <div><span>{match.level === 'exact' ? 'Exact Match' : 'Possible Match'}</span><strong><button type="button" className="jk-record-link" onClick={() => { closeNewAppointment(); openUnifiedJobRecord(match.appointment.jk, 'JunkWare duplicate check', match.appointment.day === 'today' ? 'Today' : 'Tomorrow plan'); }}>{match.appointment.jk}</button> · {match.appointment.customer}</strong><small>{match.appointment.day === 'today' ? 'Today' : 'Tomorrow'} · {match.appointment.time} · {match.appointment.area}</small></div>
                        <p><b>Matched</b>{match.signals.join(' · ')}</p>
                        <button type="button" onClick={() => { closeNewAppointment(); openUnifiedJobRecord(match.appointment.jk, 'JunkWare', 'Existing appointment'); }}>Open Existing Appointment <ArrowRight size={12} /></button>
                      </article>
                    ))}
                  </div>
                ) : duplicateCheckReady ? (
                  <div className="appointment-duplicate-clear"><Check size={14} /><div><strong>No matching appointment on this operating date</strong><span>Phone, service address, and appointment window were checked against the current schedule.</span></div></div>
                ) : <div className="appointment-duplicate-pending"><Search size={14} /><div><strong>Waiting for phone and service address</strong><span>The check runs automatically as the booking identity becomes complete.</span></div></div>}
                {exactDuplicateBookings.length > 0 && <footer className="blocked"><strong>Create Anyway is unavailable.</strong><span>Open the existing JK record and update or reschedule it instead.</span></footer>}
                {exactDuplicateBookings.length === 0 && possibleDuplicateBookings.length > 0 && (
                  <div className="appointment-duplicate-override">
                    <label><span>Reason for another appointment</span><Textarea value={duplicateOverrideReason} onChange={(event) => setDuplicateOverrideReason(event.target.value)} placeholder="Explain why this is a separate visit or booking…" /></label>
                    <small className={duplicateOverrideSatisfied ? 'complete' : ''}>{duplicateOverrideSatisfied ? <><Check size={11} /> Reason recorded for the booking audit</> : 'At least 12 characters required before review'}</small>
                  </div>
                )}
              </section>
              {newAppointmentReviewReady && (
                <section className="appointment-booking-review" aria-labelledby="booking-review-title">
                  <header>
                    <div><span>Final Review</span><strong id="booking-review-title">Ready to Create Appointment</strong></div>
                    <small>JunkWare-Governed Booking</small>
                  </header>
                  <div className="appointment-booking-review-grid">
                    <article>
                      <span>Customer</span>
                      <strong>{newAppointment.customer}</strong>
                      <small><PhoneContact phone={newAppointment.phone} /></small>
                    </article>
                    <article className="wide">
                      <span>Verified Service Location</span>
                      <GoogleMapsAddress address={newAppointment.address} />
                      <small>{territoryDesignators[appointmentTerritoryForArea(newAppointment.area)]} · {areaDesignatorForArea(newAppointment.area).code} · {newAppointment.area}</small>
                    </article>
                    <article>
                      <span>Appointment</span>
                      <strong>{newAppointment.kind} · {newAppointment.window}</strong>
                      <small>JK number assigned after JunkWare saves · {newAppointment.loadPickups} pickup equivalent{newAppointment.loadPickups === 1 ? '' : 's'} · {newAppointment.loadStream === 'metal' ? 'Metal-heavy' : newAppointment.loadStream === 'donation' ? 'Donation / resale' : 'Mixed material'}</small>
                    </article>
                    <article>
                      <span>Assignment</span>
                      <strong>{newAppointment.truck} · {newAppointmentAssignedRow?.crew || 'Crew Pending'}</strong>
                      <small>{selectedNewAppointmentPlacement
                        ? `${selectedNewAppointmentPlacement.minutes} min · ${selectedNewAppointmentPlacement.miles} mi · ${selectedNewAppointmentPlacement.buffer} min buffer`
                        : newAppointmentDirectEstimate
                          ? `Approx. ${newAppointmentDirectEstimate.minutes} min · ${newAppointmentDirectEstimate.miles} mi from current location`
                          : 'No route estimate'}</small>
                    </article>
                    <article>
                      <span>Truck Load</span>
                      <strong>{newAppointmentAssignedTruck && newAppointmentProjectedLoad !== null ? `${newAppointmentAssignedTruck.loadPercent}% → ${newAppointmentProjectedLoad}%` : 'Pending Assignment'}</strong>
                      <small>{newAppointmentLoadAction}</small>
                    </article>
                  </div>
                  {newAppointmentReviewWarnings.length ? (
                    <div className="appointment-booking-warnings">
                      <span>{newAppointmentReviewWarnings.length} Item{newAppointmentReviewWarnings.length === 1 ? '' : 's'} to Keep Visible</span>
                      {newAppointmentReviewWarnings.map((warning) => <p key={warning}>{warning}</p>)}
                    </div>
                  ) : <div className="appointment-booking-clear"><Check size={13} /> No Remaining Booking Warnings</div>}
                  {possibleDuplicateBookings.length > 0 && (
                    <div className="appointment-booking-duplicate-override">
                      <span>Duplicate Exception</span>
                      <strong>{possibleDuplicateBookings.map((match) => match.appointment.jk).join(' · ')} reviewed as possible {possibleDuplicateBookings.length === 1 ? 'match' : 'matches'}</strong>
                      <p>{duplicateOverrideReason.trim()}</p>
                    </div>
                  )}
                  <div className="appointment-booking-source">
                    <div><span>JunkWare Authority</span><strong>Creates the appointment and assigns the JK number</strong></div>
                    <div><span>Required Read-Back</span><strong>OpsCenter verifies the JK number, date, time, customer, and service address before showing it on the board</strong></div>
                  </div>
                  <footer>
                    <small>Prototype preview: this simulates the JunkWare response. No external write or message is sent.</small>
                    <Button variant="outline" size="sm" disabled={junkWareCreationBusy || junkWareCreationNeedsAttention} onClick={editReviewedBooking}>Edit Details</Button>
                  </footer>
                </section>
              )}
              {junkWareCreationState !== 'idle' && (
                <section className={`junkware-creation-status ${junkWareCreationState}`} aria-live="polite" aria-labelledby="junkware-creation-status-title">
                  <header>
                    <div><span>JunkWare Creation Status</span><strong id="junkware-creation-status-title">{junkWareCreationState === 'creating' ? 'Creating Appointment' : junkWareCreationState === 'verifying' ? 'Verifying JK Number' : junkWareCreationState === 'uncertain' ? 'Needs Attention' : junkWareCreationState === 'searching' ? 'Searching JunkWare' : junkWareCreationState === 'safe-retry' ? 'Safe to Retry' : 'Created and Confirmed'}</strong></div>
                    <em>{junkWareCreationState === 'created' ? junkWareCreationJk : junkWareCreationState === 'safe-retry' ? 'Retry Unlocked' : junkWareCreationNeedsAttention ? 'Retry Locked' : 'In Progress'}</em>
                  </header>
                  <div className="junkware-creation-steps">
                    <article className={junkWareCreationState === 'creating' ? 'active' : junkWareCreateStepComplete ? 'complete' : ''}><i>1</i><div><strong>Create</strong><span>Submit reviewed booking</span></div></article>
                    <article className={junkWareCreationState === 'verifying' || junkWareCreationState === 'searching' ? 'active' : junkWareCreationState === 'created' ? 'complete' : junkWareCreationNeedsAttention ? 'warning' : ''}><i>2</i><div><strong>Verify</strong><span>Read back JunkWare record</span></div></article>
                    <article className={junkWareCreationState === 'created' ? 'complete' : ''}><i>3</i><div><strong>Confirm</strong><span>Match JK number and booking</span></div></article>
                    <article className={junkWareCreationNeedsAttention ? 'warning active' : ''}><i>!</i><div><strong>Attention</strong><span>Exception path only</span></div></article>
                  </div>
                  <div className="junkware-creation-detail">
                    {junkWareCreationState === 'creating' && <><strong>Creating the reviewed booking</strong><p>Waiting for JunkWare to accept the appointment. Closing and retry controls remain unavailable during this request.</p></>}
                    {junkWareCreationState === 'verifying' && <><strong>Reading back the saved appointment</strong><p>OpsCenter is checking the returned JK number, operating date, window, customer, and service address.</p></>}
                    {junkWareCreationState === 'uncertain' && <><strong>JunkWare did not return a conclusive result</strong><p>Do not retry yet. Search JunkWare for the same date, phone, service address, and appointment window first.</p></>}
                    {junkWareCreationState === 'searching' && <><strong>Checking for an existing appointment</strong><p>The duplicate-prevention search is running against the reviewed booking identity.</p></>}
                    {junkWareCreationState === 'safe-retry' && <><strong>No matching appointment was found</strong><p>The search completed without a matching JunkWare record. One controlled retry is now available.</p></>}
                    {junkWareCreationState === 'created' && <><strong>{junkWareCreationJk} was returned and verified</strong><p>The read-back matches the reviewed booking. OpsCenter is adding the confirmed appointment to the board.</p></>}
                  </div>
                  <footer>Prototype state simulation only · No JunkWare write, customer message, or crew message is sent.</footer>
                </section>
              )}
              {newAppointmentError && <p className="appointment-create-error" role="alert">{newAppointmentError}</p>}
            </div>
            <footer className="record-drawer-actions">
              <Button variant="outline" disabled={junkWareCreationBusy} onClick={closeNewAppointment}>{junkWareCreationNeedsAttention ? 'Close' : 'Cancel'}</Button>
              {junkWareCreationState === 'uncertain' ? <Button onClick={searchJunkWareBeforeRetry}>Search JunkWare <Search /></Button>
                : junkWareCreationState === 'safe-retry' ? <Button onClick={() => beginJunkWareCreation(false)}>Retry Creation <ArrowRight /></Button>
                  : junkWareCreationBusy ? <Button disabled>{junkWareCreationState === 'creating' ? 'Creating…' : junkWareCreationState === 'verifying' ? 'Verifying…' : junkWareCreationState === 'searching' ? 'Searching…' : 'Confirmed'} </Button>
                    : exactDuplicateBookings.length > 0 ? <Button disabled>Duplicate Blocked</Button>
                      : possibleDuplicateBookings.length > 0 && !duplicateOverrideSatisfied ? <Button disabled>Reason Required</Button>
                        : newAppointmentReviewReady
                          ? <><Button variant="outline" onClick={() => beginJunkWareCreation(true)}>Preview Needs Attention</Button><Button onClick={() => beginJunkWareCreation(false)}>{possibleDuplicateBookings.length ? 'Create Anyway with Reason' : 'Create in JunkWare'} <Check /></Button></>
                          : <Button onClick={reviewNewAppointment}>Review Appointment <ArrowRight /></Button>}
            </footer>
          </aside>
        </>
      )}
      {drawer && (
        <>
          <button className="record-drawer-backdrop" aria-label="Close record" onClick={closeRecordDrawer} />
          <aside className={`record-drawer${activeAppointment || activeJobReference ? ' job-record-drawer' : activeCustomer ? ' customer-record-drawer' : activeArea ? ' area-record-drawer' : activeTerritory ? ' territory-record-drawer' : activeFleetTruck ? ' truck-record-drawer' : ''}`} role="dialog" aria-modal="true" aria-labelledby="record-drawer-title" key={drawer.customerId || (drawer.areaId ? `${drawer.territoryId}-${drawer.areaId}` : drawer.territoryId) || drawer.actionQueueId || drawer.appointmentId || drawer.jobReferenceId || drawer.kreweId || drawer.fleetIssueId || drawer.fleetTruckId || drawer.title}>
            <header className="record-drawer-header">
              <div>
                <div className="record-drawer-context-line">
                  {recordNavigation.length > 0 && <button type="button" className="record-drawer-back" onClick={returnToPreviousRecord} title={`Return to ${recordNavigation[recordNavigation.length - 1].label}`}><ArrowLeft size={12} />Back to {recordNavigation[recordNavigation.length - 1].label}</button>}
                  <span>{activeAppointment ? `${activeAppointment.kind} Record · ${activeAppointment.state}` : drawer.kicker}</span>
                </div>
                <h2 id="record-drawer-title">{drawer.title}</h2>
                {activeAppointment && <p>{activeAppointment.customer} · {activeAppointment.area}</p>}
                {activeKrewe && <p>{activeKrewe.role} · {activeKrewe.truck}</p>}
                {activeFleetTruck && <p>{activeFleetIssue ? `${activeFleetTruck.label} · ${activeFleetIssue.status}` : `${activeFleetTruck.vehicle} · ${activeFleetTruck.operatingStatus}`}</p>}
                {activeActionQueueItem && <p>{activeActionQueueItem.workspace} · {renderLinkedJkText(activeActionQueueItem.record, activeActionQueueItem.source, activeActionQueueItem.due)}</p>}
                {activeCustomer && <p><PhoneContact phone={activeCustomer.phone} /> · {activeCustomer.appointments.length} linked appointment{activeCustomer.appointments.length === 1 ? '' : 's'}</p>}
                {activeArea && <p>{activeArea.territory} · {activeAreaTodayAppointments.length} today · {activeAreaTomorrowAppointments.length} tomorrow</p>}
                {activeTerritory && !activeArea && <p>{activeTerritoryCode} · {activeTerritoryTodayAppointments.length} today · {activeTerritoryTomorrowAppointments.length} tomorrow</p>}
              </div>
              <div className="record-drawer-header-actions">
                {(activeAppointment || activeJobReference) && <Button variant="outline" size="sm" className={copiedJk === drawer.title ? 'drawer-jk-copy copied' : 'drawer-jk-copy'} onClick={() => copyJkNumber(drawer.title)}>{copiedJk === drawer.title ? <Check /> : <Copy />}{copiedJk === drawer.title ? 'Copied' : 'Copy JK'}</Button>}
                <Button variant="ghost" size="icon" aria-label="Close" onClick={closeRecordDrawer}><X /></Button>
              </div>
            </header>
            <div className="record-drawer-body">
              {activeCustomer ? (
                <>
                  <section className="customer-record-overview" aria-label="Customer summary">
                    <div><span>Phone</span><strong><PhoneContact phone={activeCustomer.phone} copy /></strong><small>Primary contact</small></div>
                    <div><span>Appointments</span><strong>{activeCustomer.appointments.length}</strong><small>{activeCustomer.appointments.filter((appointment) => appointment.state === 'Completed').length} completed</small></div>
                    <div><span>Recorded Revenue</span><strong>{moneyValue(activeCustomerRevenue)}</strong><small>{activeCustomerPayments.length} payment record{activeCustomerPayments.length === 1 ? '' : 's'}</small></div>
                    <div><span>Open Work</span><strong>{activeCustomerAlerts.filter(alertNeedsControl).length + activeCustomerActions.length}</strong><small>Alerts and action items</small></div>
                  </section>
                  <section className="customer-record-section">
                    <header><div><span>Contact and Service</span><strong>Addresses and access instructions</strong></div><a href={`tel:+1${activeCustomer.id}`}><PhoneCall size={13} />Call Customer</a></header>
                    <div className="customer-address-list">{activeCustomerAddresses.map((address) => <article key={address}><MapPin size={13} /><div><GoogleMapsAddress address={address} /><span>{activeCustomer.appointments.filter((appointment) => appointment.details.address === address).map((appointment, index) => <span className="inline-jk-reference" key={appointment.jk}>{index > 0 && ' · '}{renderJkLink(appointment.jk, 'Customer Record + JunkWare', appointment.day === 'today' ? 'Today' : 'Tomorrow plan')}</span>)}</span></div></article>)}</div>
                    <div className="customer-instruction-list">{activeCustomer.appointments.map((appointment) => <div key={`note-${appointment.jk}`}><span>{renderJkLink(appointment.jk, 'Customer Record + JunkWare', appointment.day === 'today' ? 'Today' : 'Tomorrow plan')}</span><strong>{appointment.details.notes}</strong></div>)}</div>
                  </section>
                  <section className="customer-record-section">
                    <header><div><span>Jobs and Estimates</span><strong>Current and historical appointments</strong></div><Badge variant="outline">JunkWare</Badge></header>
                    <div className="customer-appointment-list">{activeCustomer.appointments.map((appointment) => <button onClick={() => openUnifiedJobRecord(appointment.jk, 'Customer Record + JunkWare', appointment.day === 'today' ? 'Today' : 'Tomorrow plan')} key={appointment.jk}><div><strong>{appointment.jk} · {appointment.kind}</strong><span>{appointment.day === 'today' ? 'Today' : 'Tomorrow'} · {appointment.time} · {appointment.area}</span></div><div><strong>{appointment.state}</strong><span>{appointment.details.value}</span></div><ArrowRight size={14} /></button>)}</div>
                  </section>
                  <section className="customer-record-section">
                    <header><div><span>Calls and Reviews</span><strong>Demand, follow-up, and feedback</strong></div><Badge variant="outline">{activeCustomerLeads.length + activeCustomerReviews.length} linked</Badge></header>
                    <div className="customer-interaction-list">
                      {activeCustomerLeads.map((lead) => <article key={lead.id}><i className="call"><PhoneCall size={12} /></i><div><strong>{lead.intent}</strong><span>{lead.id} · {lead.source} · {lead.callDuration}</span><small>{lead.reason}</small></div><div><strong>{lead.status}</strong><span>{lead.phone.replace(/\D/g, '').slice(-10) === activeCustomer.id ? 'Phone match' : 'Name match · confirm'}</span></div></article>)}
                      {activeCustomerReviews.map((review) => <article key={review.id}><i className="review"><Star size={12} fill="currentColor" /></i><div><strong>{review.stars} stars · {review.customer}</strong><span>{review.id} · {review.location} · {renderJkLink(review.selectedAppointment, 'Podium + JunkWare', review.age)}</span><small>{review.excerpt}</small></div><div><strong>{review.status}</strong><span>{activeCustomerAppointmentIds.includes(review.selectedAppointment) ? 'JK-linked' : 'Name match · confirm'}</span></div></article>)}
                      {!activeCustomerLeads.length && !activeCustomerReviews.length && <div className="customer-empty-row">No calls or reviews are conservatively linked to this customer.</div>}
                    </div>
                  </section>
                  <section className="customer-record-section">
                    <header><div><span>Payments</span><strong>Job totals and reconciliation</strong></div><Badge variant="outline">QBO + JunkWare</Badge></header>
                    <div className="customer-payment-list">
                      {activeCustomerPayments.map((payment) => <button onClick={() => openUnifiedJobRecord(payment.id, 'Customer Record + QBO', 'Current closeout')} key={payment.id}><div><strong>{payment.id}</strong><span>{payment.method} · {payment.reference}</span></div><strong>{moneyValue(payment.jobTotal)}</strong><span className={`finance-payment-status ${payment.status.toLowerCase().replaceAll(' ', '-')}`}>{payment.status}</span><ArrowRight size={13} /></button>)}
                      {!activeCustomerPayments.length && <div className="customer-empty-row">No payment records are attached to the customer’s known appointments.</div>}
                    </div>
                  </section>
                  <section className="customer-record-section">
                    <header><div><span>Open Work</span><strong>Alerts and action ownership</strong></div><Badge variant="outline">{activeCustomerAlerts.filter(alertNeedsControl).length + activeCustomerActions.length} active</Badge></header>
                    <div className="customer-work-list">
                      {activeCustomerAlerts.map((item) => <article key={`customer-alert-${item.id}`}><span className={`job-record-link-mark ${item.priority}`} /><div><strong>{item.label} · {renderLinkedJkText(item.title, item.source, item.detected)}</strong><small>{item.context}</small></div><em>{alertWorkflowStatus(item)}</em></article>)}
                      {activeCustomerActions.map((item) => <article key={`customer-action-${item.id}`}><span className={`job-record-link-mark ${item.priority}`} /><div><strong>{item.title}</strong><small>{item.owner} · {item.due}</small></div><button onClick={() => manageActionQueueItem(item)}>{item.status} <ArrowRight size={12} /></button></article>)}
                      {!activeCustomerAlerts.length && !activeCustomerActions.length && <div className="customer-empty-row">No alerts or actions are attached to this customer.</div>}
                    </div>
                  </section>
                  <section className="customer-record-section customer-note-section">
                    <header><div><span>Customer Note</span><strong>Shared operating context</strong></div><Badge variant="outline">OpsCenter</Badge></header>
                    <Textarea value={customerNoteDraft} onChange={(event) => setCustomerNoteDraft(event.target.value)} placeholder="Preferences, access details, relationship context, or follow-up instructions" />
                    <div><span>Source appointment instructions remain unchanged above.</span><Button size="sm" onClick={saveCustomerNote}>Save Note <Check /></Button></div>
                  </section>
                  {actionFeedback && <p className="drawer-action-feedback" role="status">{actionFeedback}</p>}
                </>
              ) : activeArea ? (
                <>
                  <section className="territory-record-overview area-record-overview" aria-label="Area summary">
                    <div><span>Today</span><strong>{activeAreaTodayAppointments.length}</strong><small>Appointments</small></div>
                    <div><span>Tomorrow</span><strong>{activeAreaTomorrowAppointments.length}</strong><small>Planned appointments</small></div>
                    <div><span>Completed Today</span><strong>{activeAreaTodayAppointments.filter((appointment) => appointment.state === 'Completed').length}</strong><small>JunkWare status</small></div>
                    <div><span>Recorded Revenue</span><strong>{moneyValue(activeAreaRecordedRevenue)}</strong><small>{activeAreaPayments.length} linked payment{activeAreaPayments.length === 1 ? '' : 's'}</small></div>
                    <div><span>Open Capacity</span><strong>{activeAreaOpenCapacity}</strong><small>Today’s available windows</small></div>
                    <div><span>Exceptions</span><strong>{activeAreaNeedsAssignment + activeAreaNeedsVerification + activeAreaAlerts.filter(alertNeedsControl).length + activeAreaActions.length}</strong><small>Assignment, address, and work</small></div>
                  </section>
                  <div className="territory-record-actions area-record-actions">
                    <Button variant="outline" size="sm" onClick={() => openAreaSchedule('today')}>Open Today <CalendarDays /></Button>
                    <Button variant="outline" size="sm" onClick={() => openAreaSchedule('tomorrow')}>Open Tomorrow <ArrowRight /></Button>
                    <Button variant="outline" size="sm" onClick={() => openTerritoryRecord(activeArea.territory)}>Open Territory <ArrowRight /></Button>
                  </div>
                  <section className="job-record-section area-record-section" aria-label="Area map and coverage">
                    <header><div><span>Service Footprint</span><strong>Map and covered localities</strong></div><Badge variant="outline">{activeArea.territoryCode} / {activeArea.code}</Badge></header>
                    <div className="territory-record-footprint area-record-footprint">
                      <div className="territory-record-map area-record-map"><iframe title={`${activeArea.label} service area map`} src={activeAreaMapSrc} loading="lazy" /><span><MapPin size={12} />{activeArea.label}</span></div>
                      <div className="area-record-locality-list">
                        {activeArea.localities.map((locality) => <article key={locality}><b>{areaDesignatorForArea(locality).code}</b><div><strong>{locality}</strong><span>{activeAreaAppointments.filter((appointment) => appointment.area === locality && appointment.day === 'today').length} today · {activeAreaAppointments.filter((appointment) => appointment.area === locality && appointment.day === 'tomorrow').length} tomorrow</span></div></article>)}
                      </div>
                    </div>
                  </section>
                  <section className="job-record-section area-record-section" aria-label="Area dispatch readiness">
                    <header><div><span>Dispatch Readiness</span><strong>Exceptions and available capacity</strong></div><Badge variant="outline">Today</Badge></header>
                    <div className="area-record-readiness">
                      <button onClick={() => openAreaSchedule('today', 'unassigned')}><span>Needs Assignment</span><strong>{activeAreaNeedsAssignment}</strong><small>{activeAreaNeedsAssignment ? 'Open unassigned appointments' : 'All appointments assigned'}</small><ArrowRight size={13} /></button>
                      <button onClick={() => openAreaSchedule('today', 'verify')}><span>Verify Address</span><strong>{activeAreaNeedsVerification}</strong><small>{activeAreaNeedsVerification ? 'Open address exceptions' : 'All known addresses verified'}</small><ArrowRight size={13} /></button>
                      <button onClick={() => openAreaSchedule('today', 'open')}><span>Open Capacity</span><strong>{activeAreaOpenCapacity}</strong><small>{activeAreaOpenCapacity ? 'Review available windows' : 'No open window recorded'}</small><ArrowRight size={13} /></button>
                    </div>
                  </section>
                  <section className="job-record-section area-record-section" aria-label="Area appointments">
                    <header><div><span>Schedule</span><strong>Today and Tomorrow</strong></div><Badge variant="outline">{activeAreaAppointments.length} appointment{activeAreaAppointments.length === 1 ? '' : 's'}</Badge></header>
                    <div className="territory-record-appointment-list area-record-appointment-list">
                      {activeAreaAppointments.map((appointment) => <button onClick={() => openUnifiedJobRecord(appointment.jk, 'Area Record + JunkWare', appointment.day === 'today' ? 'Today · Live' : 'Tomorrow plan')} key={`${appointment.day}-${appointment.jk}`}><time><strong>{appointment.day === 'today' ? 'Today' : 'Tomorrow'}</strong><span>{appointment.time}</span></time><div><strong>{appointment.jk} · {appointment.customer}</strong><span>{appointment.area} · {appointment.truck} · {appointment.details.scope}</span></div><em className={appointment.state.toLowerCase().replaceAll(' ', '-')}>{appointment.state}</em><ArrowRight size={14} /></button>)}
                      {!activeAreaAppointments.length && <div className="job-record-empty-row">No appointments are currently linked to this area.</div>}
                    </div>
                  </section>
                  <div className="territory-record-assets area-record-assets">
                    <section className="job-record-section area-record-section" aria-label="Area trucks">
                      <header><div><span>Fleet</span><strong>Serving this area</strong></div><Badge variant="outline">{activeAreaTrucks.length}</Badge></header>
                      <div className="territory-record-asset-list area-record-asset-list">
                        {activeAreaTrucks.map((truck) => <button className="truck" onClick={() => openFleetTruck(truck)} key={truck.id}><div><strong>{truck.label}</strong><span>{truck.operatingStatus} · {truck.location}</span></div><em className={truck.readiness === 'Ready' ? 'healthy' : 'attention'}>{truck.loadPercent}% full</em><ArrowRight size={13} /></button>)}
                        {!activeAreaTrucks.length && <div className="job-record-empty-row">No truck record is currently linked to this area.</div>}
                      </div>
                    </section>
                    <section className="job-record-section area-record-section" aria-label="Area Krewe">
                      <header><div><span>Krewe</span><strong>Working this area</strong></div><Badge variant="outline">{activeAreaKrewe.length}</Badge></header>
                      <div className="territory-record-asset-list area-record-asset-list">
                        {activeAreaKrewe.map((member) => <button className="krewe" onClick={() => { setActiveNav('Krewe'); setKreweView('today'); openKreweMember(member); }} key={member.id}><i>{member.initials}</i><div><strong>{member.name}</strong><span>{member.role} · {member.truck}</span></div><em className={member.issue ? 'attention' : 'healthy'}>{member.status}</em><ArrowRight size={13} /></button>)}
                        {!activeAreaKrewe.length && <div className="job-record-empty-row">No active Krewe record is linked to this area.</div>}
                      </div>
                    </section>
                  </div>
                  <section className="job-record-section area-record-section" aria-label="Area open work">
                    <header><div><span>Open Work</span><strong>Alerts and action ownership</strong></div><Badge variant="outline">{activeAreaAlerts.filter(alertNeedsControl).length + activeAreaActions.length} active</Badge></header>
                    <div className="job-record-related-list">
                      {activeAreaAlerts.map((item) => <article key={`area-alert-${item.id}`}><span className={`job-record-link-mark ${item.priority}`} /><div><strong>{item.label} · {renderLinkedJkText(item.title, item.source, item.detected)}</strong><small>{item.context}</small></div><button onClick={() => openAlertRecord(item)}>{alertWorkflowStatus(item)} <ArrowRight size={12} /></button></article>)}
                      {activeAreaActions.map((item) => <article key={`area-action-${item.id}`}><span className={`job-record-link-mark ${item.priority}`} /><div><strong>{item.title}</strong><small>{item.owner} · {item.due}</small></div><button onClick={() => manageActionQueueItem(item)}>{item.status} <ArrowRight size={12} /></button></article>)}
                      {!activeAreaAlerts.length && !activeAreaActions.length && <div className="job-record-empty-row">No alerts or action items are attached to this area.</div>}
                    </div>
                  </section>
                  <section className="job-record-section area-record-section" aria-label="Area activity">
                    <header><div><span>Activity</span><strong>Schedule and manager actions</strong></div><Badge variant="outline">{activeAreaScheduleHistory.length + activeAreaAuditHistory.length} events</Badge></header>
                    <div className="job-record-timeline">
                      {activeAreaScheduleHistory.map((item, index) => <article key={`area-schedule-${item.type}-${item.time}-${index}`}><i /><time>{item.time}</time><div><strong>{item.type} · {renderJkLink(item.jk, item.source, item.time)}</strong><span>{item.change}</span><small>{item.by} · {item.source}</small></div></article>)}
                      {activeAreaAuditHistory.map((item) => <article key={`area-audit-${item.id}`}><i className={item.result === 'Needs review' ? 'attention' : ''} /><time>{item.time}</time><div><strong>{item.action}</strong><span>{item.summary}</span><small>{item.actor} · {item.source} · {item.result}</small></div></article>)}
                      {!activeAreaScheduleHistory.length && !activeAreaAuditHistory.length && <div className="job-record-empty-row">No linked area activity has been recorded.</div>}
                    </div>
                  </section>
                </>
              ) : activeTerritory ? (
                <>
                  <section className="territory-record-overview" aria-label="Territory summary">
                    <div><span>Today</span><strong>{activeTerritoryTodayAppointments.length}</strong><small>Appointments</small></div>
                    <div><span>Tomorrow</span><strong>{activeTerritoryTomorrowAppointments.length}</strong><small>Planned appointments</small></div>
                    <div><span>Completed Today</span><strong>{activeTerritoryTodayAppointments.filter((appointment) => appointment.state === 'Completed').length}</strong><small>JunkWare status</small></div>
                    <div><span>Recorded Revenue</span><strong>{moneyValue(activeTerritoryRecordedRevenue)}</strong><small>{activeTerritoryPayments.length} linked payment{activeTerritoryPayments.length === 1 ? '' : 's'}</small></div>
                    <div><span>Open Capacity</span><strong>{activeTerritoryOpenCapacity}</strong><small>Today’s available windows</small></div>
                    <div><span>Open Work</span><strong>{activeTerritoryAlerts.filter(alertNeedsControl).length + activeTerritoryActions.length}</strong><small>Alerts and actions</small></div>
                  </section>
                  <div className="territory-record-actions">
                    <Button variant="outline" size="sm" onClick={() => openTerritorySchedule('today')}>Open Today <CalendarDays /></Button>
                    <Button variant="outline" size="sm" onClick={() => openTerritorySchedule('tomorrow')}>Open Tomorrow <ArrowRight /></Button>
                  </div>
                  <section className="job-record-section territory-record-section" aria-label="Territory map and areas">
                    <header><div><span>Operating Footprint</span><strong>Map and area workload</strong></div><Badge variant="outline">{activeTerritoryCode}</Badge></header>
                    <div className="territory-record-footprint">
                      <div className="territory-record-map"><iframe title={`${activeTerritory} territory map`} src={activeTerritoryMapSrc} loading="lazy" /><span><MapPin size={12} />Focused on {activeTerritory}</span></div>
                      <div className="territory-record-area-list">
                        {activeTerritoryAreas.map((area) => <button onClick={() => openAreaRecord(activeTerritory, area.code)} key={area.code}><b>{area.code}</b><div><strong>{area.label}</strong><span>{area.appointments.filter((appointment) => appointment.day === 'today').length} today · {area.appointments.filter((appointment) => appointment.day === 'tomorrow').length} tomorrow</span></div><ArrowRight size={13} /></button>)}
                        {!activeTerritoryAreas.length && <div className="job-record-empty-row">No area workload is linked to this territory.</div>}
                      </div>
                    </div>
                  </section>
                  <section className="job-record-section territory-record-section" aria-label="Territory appointments">
                    <header><div><span>Schedule</span><strong>Today and Tomorrow</strong></div><Badge variant="outline">{activeTerritoryAppointments.length} appointment{activeTerritoryAppointments.length === 1 ? '' : 's'}</Badge></header>
                    <div className="territory-record-appointment-list">
                      {activeTerritoryAppointments.map((appointment) => <button onClick={() => openUnifiedJobRecord(appointment.jk, 'Territory Record + JunkWare', appointment.day === 'today' ? 'Today · Live' : 'Tomorrow plan')} key={`${appointment.day}-${appointment.jk}`}><time><strong>{appointment.day === 'today' ? 'Today' : 'Tomorrow'}</strong><span>{appointment.time}</span></time><div><strong>{appointment.jk} · {appointment.customer}</strong><span>{appointment.areaDesignator.code} · {appointment.area} · {appointment.truck}</span></div><em className={appointment.state.toLowerCase().replaceAll(' ', '-')}>{appointment.state}</em><ArrowRight size={14} /></button>)}
                      {!activeTerritoryAppointments.length && <div className="job-record-empty-row">No appointments are currently linked to this territory.</div>}
                    </div>
                  </section>
                  <div className="territory-record-assets">
                    <section className="job-record-section territory-record-section" aria-label="Territory trucks">
                      <header><div><span>Fleet</span><strong>Territory trucks</strong></div><Badge variant="outline">{activeTerritoryTrucks.length}</Badge></header>
                      <div className="territory-record-asset-list">
                        {activeTerritoryTrucks.map((truck) => <button className="truck" onClick={() => openFleetTruck(truck)} key={truck.id}><div><strong>{truck.label}</strong><span>{truck.operatingStatus} · {truck.location}</span></div><em className={truck.readiness === 'Ready' ? 'healthy' : 'attention'}>{truck.loadPercent}% full</em><ArrowRight size={13} /></button>)}
                        {!activeTerritoryTrucks.length && <div className="job-record-empty-row">No trucks are assigned to this territory.</div>}
                      </div>
                    </section>
                    <section className="job-record-section territory-record-section" aria-label="Territory Krewe">
                      <header><div><span>Krewe</span><strong>Working in territory</strong></div><Badge variant="outline">{activeTerritoryKrewe.length}</Badge></header>
                      <div className="territory-record-asset-list">
                        {activeTerritoryKrewe.map((member) => <button className="krewe" onClick={() => { setActiveNav('Krewe'); setKreweView('today'); openKreweMember(member); }} key={member.id}><i>{member.initials}</i><div><strong>{member.name}</strong><span>{member.role} · {member.truck}</span></div><em className={member.issue ? 'attention' : 'healthy'}>{member.status}</em><ArrowRight size={13} /></button>)}
                        {!activeTerritoryKrewe.length && <div className="job-record-empty-row">No active Krewe records are linked to this territory.</div>}
                      </div>
                    </section>
                  </div>
                  <section className="job-record-section territory-record-section" aria-label="Territory open work">
                    <header><div><span>Open Work</span><strong>Alerts and action ownership</strong></div><Badge variant="outline">{activeTerritoryAlerts.filter(alertNeedsControl).length + activeTerritoryActions.length} active</Badge></header>
                    <div className="job-record-related-list">
                      {activeTerritoryAlerts.map((item) => <article key={`territory-alert-${item.id}`}><span className={`job-record-link-mark ${item.priority}`} /><div><strong>{item.label} · {renderLinkedJkText(item.title, item.source, item.detected)}</strong><small>{item.context}</small></div><button onClick={() => openAlertRecord(item)}>{alertWorkflowStatus(item)} <ArrowRight size={12} /></button></article>)}
                      {activeTerritoryActions.map((item) => <article key={`territory-action-${item.id}`}><span className={`job-record-link-mark ${item.priority}`} /><div><strong>{item.title}</strong><small>{item.owner} · {item.due}</small></div><button onClick={() => manageActionQueueItem(item)}>{item.status} <ArrowRight size={12} /></button></article>)}
                      {!activeTerritoryAlerts.length && !activeTerritoryActions.length && <div className="job-record-empty-row">No alerts or action items are attached to this territory.</div>}
                    </div>
                  </section>
                  <section className="job-record-section territory-record-section" aria-label="Territory activity">
                    <header><div><span>Activity</span><strong>Schedule and manager actions</strong></div><Badge variant="outline">{activeTerritoryScheduleHistory.length + activeTerritoryAuditHistory.length} events</Badge></header>
                    <div className="job-record-timeline">
                      {activeTerritoryScheduleHistory.map((item, index) => <article key={`territory-schedule-${item.type}-${item.time}-${index}`}><i /><time>{item.time}</time><div><strong>{item.type} · {renderJkLink(item.jk, item.source, item.time)}</strong><span>{item.change}</span><small>{item.by} · {item.source}</small></div></article>)}
                      {activeTerritoryAuditHistory.map((item) => <article key={`territory-audit-${item.id}`}><i className={item.result === 'Needs review' ? 'attention' : ''} /><time>{item.time}</time><div><strong>{item.action}</strong><span>{item.summary}</span><small>{item.actor} · {item.source} · {item.result}</small></div></article>)}
                      {!activeTerritoryScheduleHistory.length && !activeTerritoryAuditHistory.length && <div className="job-record-empty-row">No linked territory activity has been recorded.</div>}
                    </div>
                  </section>
                </>
              ) : activeActionQueueItem ? (
                <>
                  <section className="action-drawer-overview" aria-label="Action summary">
                    <div><span>Status</span><strong className={`action-status ${activeActionQueueItem.status.toLowerCase().replaceAll(' ', '-')}`}>{activeActionQueueItem.status}</strong><small>{activeActionQueueItem.escalated ? 'Escalated' : 'Standard handling'}</small></div>
                    <div><span>Owner</span><strong>{activeActionQueueItem.owner}</strong><small>Responsible party</small></div>
                    <div><span>Deadline</span><strong>{activeActionQueueItem.due}</strong><small>{activeActionQueueItem.priority === 'critical' ? 'Urgent' : activeActionQueueItem.priority === 'warning' ? 'Needs attention' : 'Monitor'}</small></div>
                    <div><span>Source Record</span><strong>{renderLinkedJkText(activeActionQueueItem.record, activeActionQueueItem.source, activeActionQueueItem.due)}</strong><small>{activeActionQueueItem.source}</small></div>
                  </section>
                  <section className="control-approval-card" aria-label="Recommendation approval">
                    <header><div><span>OpsBot Recommendation</span><strong>Review before operational action</strong></div><em className={activeActionQueueItem.approval === 'Not required' ? 'not-required' : activeActionQueueItem.approval.toLowerCase().replaceAll(' ', '-')}>{activeActionQueueItem.approval}</em></header>
                    <div className="control-decision-lifecycle" aria-label="Decision lifecycle"><span className="complete">Event</span><span className="complete">Rule</span><span className="complete">Recommendation</span><span className={activeActionQueueItem.approval === 'Pending approval' ? 'current' : 'complete'}>Approval</span><span className={activeActionQueueItem.status === 'Awaiting Verification' ? 'complete' : activeActionQueueItem.status === 'In Progress' ? 'current' : ''}>Action</span><span className={activeActionQueueItem.status === 'Awaiting Verification' ? 'current' : activeActionQueueItem.verificationCheckedAt ? 'failed' : ''}>Verification</span></div>
                    <div className="control-recommendation-detail"><span>Recommended Next Move</span><strong>{activeActionQueueItem.recommendation}</strong><small><ShieldCheck size={12} />Verification required · {activeActionQueueItem.verification}</small></div>
                    {activeActionQueueItem.approval === 'Pending approval' && <footer><span>Use the operational note below when rejecting.</span><div><Button variant="outline" size="sm" onClick={rejectActionQueueItem}>Reject with Note</Button><Button size="sm" onClick={approveActionQueueItem}>Approve Recommendation <Check /></Button></div></footer>}
                    {activeActionQueueItem.approval === 'Approved' && <footer className="decision-recorded"><span><Check size={12} />Approved. Action remains open until verification is recorded.</span></footer>}
                    {activeActionQueueItem.approval === 'Rejected' && <footer className="decision-recorded rejected"><span>Rejected. Record an alternate plan in the operational note.</span></footer>}
                  </section>
                  <section className="action-drawer-controls" aria-label="Action handoff controls">
                    <div className="drawer-control-heading"><span>Handoff Controls</span><strong>Assign and move the work</strong><small>Owner, deadline, status, and notes update the shared queue together.</small></div>
                    <div className="action-drawer-form">
                      <label><span>Owner</span><select value={actionQueueDraft.owner} onChange={(event) => setActionQueueDraft((draft) => ({ ...draft, owner: event.target.value }))}><option>Mission Control</option><option>Dispatch</option><option>Ops Manager</option><option>Fleet</option><option>Finance</option><option>Marketing</option></select></label>
                      <label><span>Deadline</span><Input value={actionQueueDraft.due} onChange={(event) => setActionQueueDraft((draft) => ({ ...draft, due: event.target.value }))} placeholder="Required deadline" /></label>
                      <label className="wide"><span>Working Status</span><select value={actionQueueDraft.status} disabled={activeActionQueueItem.status === 'Awaiting Verification'} onChange={(event) => setActionQueueDraft((draft) => ({ ...draft, status: event.target.value as ActionQueueStatus }))}><option>Open</option><option>In Progress</option><option disabled>Awaiting Verification</option><option>Waiting</option><option>Blocked</option></select></label>
                      <label className="wide"><span>Operational Note {['Waiting', 'Blocked'].includes(actionQueueDraft.status) ? '· Required' : ''}</span><Textarea value={actionQueueDraft.note} onChange={(event) => setActionQueueDraft((draft) => ({ ...draft, note: event.target.value }))} placeholder="What changed, what is needed, or what is blocking progress" /></label>
                    </div>
                    <div className="action-drawer-buttons"><Button variant="outline" size="sm" onClick={() => openActionSource(activeActionQueueItem)}>Open Source Record <ArrowRight /></Button><Button variant="outline" size="sm" onClick={escalateActionQueueItem} disabled={activeActionQueueItem.escalated}>Escalate</Button><Button size="sm" onClick={saveActionQueueItem}>Save Handoff <Check /></Button></div>
                  </section>
                  <section className={`action-verification-section${activeActionQueueItem.status === 'Awaiting Verification' ? ' pending' : ''}`}>
                    <div className="drawer-control-heading"><span>{activeActionQueueItem.status === 'Awaiting Verification' ? 'Verification' : 'Claimed Outcome'}</span><strong>{activeActionQueueItem.status === 'Awaiting Verification' ? 'Confirm against the source' : 'Submit for an independent source check'}</strong><small>A resolution note alone cannot close operational work.</small></div>
                    <div className="verification-requirement-grid"><div><span>Verification Source</span><strong>{verificationSourceForAction(activeActionQueueItem)}</strong></div><div><span>Required Result</span><strong>{activeActionQueueItem.verification}</strong></div></div>
                    {activeActionQueueItem.verificationCheckedAt && activeActionQueueItem.status !== 'Awaiting Verification' && <div className="verification-failure-receipt"><span>Last Check Failed · {activeActionQueueItem.verificationCheckedAt}</span><strong>{activeActionQueueItem.verificationEvidence}</strong></div>}
                    <label><span>Outcome to Verify</span><Textarea readOnly={activeActionQueueItem.status === 'Awaiting Verification'} value={actionQueueDraft.resolution} onChange={(event) => setActionQueueDraft((draft) => ({ ...draft, resolution: event.target.value }))} placeholder="Record the actual operating outcome that should now exist." /></label>
                    {activeActionQueueItem.status === 'Awaiting Verification' && <><label><span>Verification Evidence · Required</span><Textarea value={actionQueueDraft.verificationEvidence} onChange={(event) => setActionQueueDraft((draft) => ({ ...draft, verificationEvidence: event.target.value }))} placeholder={`What did ${verificationSourceForAction(activeActionQueueItem)} confirm?`} /></label><footer><span>Failed checks return the action to In Progress and retain the evidence.</span><Button variant="destructive" size="sm" onClick={failActionVerification}>Verification Failed</Button></footer></>}
                  </section>
                  {actionFeedback && <p className="drawer-action-feedback" role="status">{actionFeedback}</p>}
                </>
              ) : activeAppointment ? (
                <>
                  {activeCreationReceipt && (
                    <section className="appointment-creation-receipt" aria-label="Created appointment receipt">
                      <header>
                        <div><span>Creation Receipt</span><strong>{activeAppointment.jk} Created and Verified</strong></div>
                        <small><Check size={11} /> JunkWare Read-Back</small>
                      </header>
                      <div className="appointment-creation-proof">
                        <article><span>JK Record</span><strong>{activeAppointment.jk}</strong><small>Exact identifier returned</small></article>
                        <article><span>Schedule Position</span><strong>{activeAppointment.time} · {activeAppointment.truck}</strong><small>{activeAppointment.crew}</small></article>
                        <article><span>Service Location</span><strong>{activeAppointment.areaDesignator.code} · {activeAppointment.area}</strong><small>{activeAppointment.addressVerified ? 'Address verified' : 'Address review required'}</small></article>
                        <article><span>Call Ahead</span><strong>{activeCreationReceipt.callAheadRequired ? 'Required' : 'Not requested'}</strong><small>{activeCreationReceipt.callAheadRequired ? 'Included in message context' : 'No call-ahead note found'}</small></article>
                      </div>
                      <div className="appointment-creation-deliveries">
                        <article className={activeCreationReceipt.customerDelivery}>
                          <div><span>Customer Confirmation</span><strong>{activeCreationReceipt.customerDelivery === 'delivered' ? 'Delivered' : activeCreationReceipt.customerDelivery === 'sending' ? 'Sending…' : 'Not Sent'}</strong><small><PhoneContact phone={activeAppointment.details.phone} /></small></div>
                          <Button variant="outline" size="sm" disabled={activeCreationReceipt.customerDelivery !== 'not-sent'} onClick={() => sendCreatedAppointmentMessage('customer')}>
                            {activeCreationReceipt.customerDelivery === 'delivered' ? <><Check /> Delivered</> : activeCreationReceipt.customerDelivery === 'sending' ? 'Sending…' : 'Send Confirmation'}
                          </Button>
                        </article>
                        <article className={activeCreationReceipt.crewDelivery}>
                          <div><span>Crew Notification</span><strong>{activeAppointment.truck === 'Unassigned' ? 'Assignment Required' : activeCreationReceipt.crewDelivery === 'delivered' ? 'Delivered' : activeCreationReceipt.crewDelivery === 'sending' ? 'Sending…' : 'Not Sent'}</strong><small>{activeAppointment.truck} · {activeAppointment.crew}</small></div>
                          <Button variant="outline" size="sm" disabled={activeAppointment.truck === 'Unassigned' || activeCreationReceipt.crewDelivery !== 'not-sent'} onClick={() => sendCreatedAppointmentMessage('crew')}>
                            {activeCreationReceipt.crewDelivery === 'delivered' ? <><Check /> Delivered</> : activeCreationReceipt.crewDelivery === 'sending' ? 'Sending…' : 'Notify Crew'}
                          </Button>
                        </article>
                      </div>
                      <footer>
                        <small>Prototype delivery simulation only. Creating the appointment does not contact the customer or Krewe.</small>
                        <Button variant="outline" size="sm" onClick={showCreatedAppointmentOnSchedule}>Show on Schedule <ArrowRight /></Button>
                      </footer>
                    </section>
                  )}
                  <section className="drawer-appointment-overview" aria-label="Appointment summary">
                    <div><span>Window</span><strong>{activeAppointment.time}</strong><small>{activeAppointment.kind}</small></div>
                    <div><span>Assignment</span><strong>{activeAppointment.truck}</strong><small>{activeAppointment.crew}</small></div>
                    <div><span>Territory / Area</span><button className="job-area-link" onClick={() => openAreaRecord(activeAppointment.territory, activeAppointment.areaDesignator.code)}>{territoryDesignators[activeAppointment.territory]} · {activeAppointment.areaDesignator.code}<ArrowRight size={11} /></button><small>{activeAppointment.territory} · {activeAppointment.areaDesignator.label}</small></div>
                    <div><span>Status</span><strong className={`drawer-status ${activeAppointment.state.toLowerCase().replaceAll(' ', '-')}`}>{activeAppointment.state}</strong><small>{activeAppointment.addressVerified ? 'Address verified' : 'Verify address'}</small></div>
                  </section>
                  <section className="drawer-detail-section" aria-label="Appointment details">
                    <header><span>Appointment details</span></header>
                    <div className="drawer-detail-grid">
                      <div><span>Customer</span>{activeJobCustomer ? <button className="job-customer-link" onClick={() => openCustomerRecord(activeJobCustomer.id)}>{activeAppointment.customer} <ArrowRight size={12} /></button> : <strong>{activeAppointment.customer}</strong>}</div>
                      <div><span>Phone</span><PhoneContact phone={activeAppointment.details.phone} copy /></div>
                      <div className="wide"><span>Service address</span><GoogleMapsAddress address={activeAppointment.details.address} /><small className={activeAppointment.addressVerified ? 'verified' : 'attention'}>{activeAppointment.addressVerified ? 'Verified' : 'Needs verification'}</small></div>
                      <div><span>Work</span><strong>{activeAppointment.details.scope}</strong></div>
                      <div><span>Value</span><strong>{activeAppointment.details.value}</strong></div>
                      <div className="wide"><span>Notes</span><strong>{activeAppointment.cancellationReason ? `Canceled · ${activeAppointment.cancellationReason}` : activeAppointment.details.notes}</strong></div>
                    </div>
                  </section>
                  <section className={`appointment-closeout-panel ${activeAppointment.kind.toLowerCase()}`} aria-label="Appointment closeout">
                    <header>
                      <div><span>Close Appointment</span><strong>{activeAppointment.kind === 'Estimate' ? 'Estimate Outcome' : 'Job Completion'}</strong></div>
                      <Badge variant="outline">{activeCloseoutReceipt ? activeCloseoutReceipt.finalState : activeAppointment.kind}</Badge>
                    </header>
                    {activeCloseoutReceipt ? (
                      <div className="appointment-closeout-receipt">
                        <i><Check size={15} /></i>
                        <div>
                          <strong>{activeCloseoutReceipt.finalState}</strong>
                          <span>{activeCloseoutReceipt.originalCategory !== activeCloseoutReceipt.finalCategory ? `${activeCloseoutReceipt.originalCategory} explicitly changed to ${activeCloseoutReceipt.finalCategory}. ` : ''}{activeCloseoutReceipt.finalCategory === 'Job' ? 'Included in completed-job counts; Finance waits for source reconciliation.' : 'Closed schedule work; excluded from completed-job and revenue totals.'}</span>
                          <small>{moneyValue(activeCloseoutReceipt.amount)} · {activeCloseoutReceipt.finalCategory === 'Job' ? activeCloseoutReceipt.paymentMethod : activeCloseoutReceipt.estimateOutcome}{activeCloseoutReceipt.followUpDate ? ` · Follow up ${activeCloseoutReceipt.followUpDate}` : ''} · {activeCloseoutReceipt.recordedAt}</small>
                        </div>
                        <em>Prototype Only</em>
                      </div>
                    ) : isFinalAppointmentState(activeAppointment.state) ? (
                      <div className="appointment-closeout-existing">
                        <strong>{activeAppointment.state}</strong>
                        <span>{activeAppointment.state === 'Estimate Closed' ? 'This remains an Estimate and does not count as completed-job revenue.' : activeAppointment.state === 'Completed' ? 'This Job is already in a completed source state.' : 'Canceled appointments cannot be closed.'}</span>
                      </div>
                    ) : appointmentCloseoutOpen ? (
                      <div className="appointment-closeout-form">
                        {activeAppointment.kind === 'Estimate' ? (
                          <div className="appointment-category-picker" role="group" aria-label="Final appointment category">
                            <button className={appointmentCloseoutDraft.category === 'Estimate' ? 'active' : ''} onClick={() => { setAppointmentCloseoutDraft((draft) => ({ ...draft, category: 'Estimate', paymentMethod: '' })); setAppointmentCloseoutError(''); }}><strong>Close as Estimate</strong><span>Schedule closeout only</span></button>
                            <button className={appointmentCloseoutDraft.category === 'Job' ? 'active conversion' : ''} onClick={() => { setAppointmentCloseoutDraft((draft) => ({ ...draft, category: 'Job' })); setAppointmentCloseoutError(''); }}><strong>Convert to Job</strong><span>Counts as completed revenue work</span></button>
                          </div>
                        ) : (
                          <div className="appointment-closeout-rule job"><strong>Job Appointment</strong><span>Completing this record adds one completed Job. Finance remains pending until the JunkWare and QBO source records reconcile.</span></div>
                        )}
                        <div className="appointment-closeout-fields">
                          <label>
                            <span>{appointmentCloseoutDraft.category === 'Job' ? 'Final Job Total' : 'Quoted Amount'}</span>
                            <Input value={appointmentCloseoutDraft.amount} onChange={(event) => setAppointmentCloseoutDraft((draft) => ({ ...draft, amount: event.target.value }))} placeholder="$0.00" />
                          </label>
                          {appointmentCloseoutDraft.category === 'Job' ? (
                            <label>
                              <span>Payment Recorded As</span>
                              <select value={appointmentCloseoutDraft.paymentMethod} onChange={(event) => setAppointmentCloseoutDraft((draft) => ({ ...draft, paymentMethod: event.target.value }))}>
                                <option value="">Select payment method</option>
                                <option>Card</option><option>Cash</option><option>Check</option><option>Other</option>
                              </select>
                            </label>
                          ) : (
                            <label>
                              <span>Estimate Outcome</span>
                              <select value={appointmentCloseoutDraft.estimateOutcome} onChange={(event) => setAppointmentCloseoutDraft((draft) => ({ ...draft, estimateOutcome: event.target.value as EstimateCloseoutOutcome }))}>
                                <option>Follow-Up Required</option><option>Not Booked</option>
                              </select>
                            </label>
                          )}
                          {appointmentCloseoutDraft.category === 'Estimate' && appointmentCloseoutDraft.estimateOutcome === 'Follow-Up Required' && (
                            <label>
                              <span>Follow-Up Date</span>
                              <input type="date" value={appointmentCloseoutDraft.followUpDate} onChange={(event) => setAppointmentCloseoutDraft((draft) => ({ ...draft, followUpDate: event.target.value }))} />
                            </label>
                          )}
                          <label className="wide">
                            <span>Closeout Notes · Required</span>
                            <Textarea value={appointmentCloseoutDraft.notes} onChange={(event) => setAppointmentCloseoutDraft((draft) => ({ ...draft, notes: event.target.value }))} placeholder={appointmentCloseoutDraft.category === 'Job' ? 'What was completed and what still needs source reconciliation?' : 'Record the estimate result and next customer action.'} />
                          </label>
                        </div>
                        <div className={`appointment-closeout-impact ${appointmentCloseoutDraft.category.toLowerCase()}`}>
                          <strong>{appointmentCloseoutDraft.category === 'Job' ? 'Completed Job' : 'Closed Estimate'}</strong>
                          <span>{appointmentCloseoutDraft.category === 'Job' ? 'Adds to completed-job counts. Revenue is not claimed reconciled until JunkWare and QBO confirm it.' : 'Closes the appointment on Schedule. It does not add a completed Job or completed revenue.'}</span>
                        </div>
                        {appointmentCloseoutError && <p className="appointment-closeout-error" role="alert">{appointmentCloseoutError}</p>}
                        <footer><button onClick={() => { setAppointmentCloseoutOpen(false); setAppointmentCloseoutError(''); }}>Cancel Closeout</button><span>Prototype only · no JunkWare write</span></footer>
                      </div>
                    ) : (
                      <div className="appointment-closeout-rules">
                        <article><strong>Job</strong><span>Completion contributes to completed-job totals and then enters Finance reconciliation.</span></article>
                        <article><strong>Estimate</strong><span>Closure records the outcome without counting a completed Job or revenue.</span></article>
                      </div>
                    )}
                  </section>
                  <section className="job-record-section" aria-label="Operating connections">
                    <header><div><span>Operating Connections</span><strong>Truck, Krewe, photos, and appointment closeout</strong></div><Badge variant="outline">Reconciled by JK number</Badge></header>
                    <div className="job-record-connection-grid">
                      <div><span>Truck</span>{activeJobTruck ? <button className="job-record-linked-record" onClick={() => openFleetTruck(activeJobTruck)}><strong>{activeJobTruck.label}</strong><ArrowRight size={12} /></button> : <strong>{activeAppointment.truck}</strong>}<small>{activeJobTruck ? `${activeJobTruck.operatingStatus} · ${activeJobTruck.location}` : 'No Fleet record linked'}</small><em className={activeJobTruck?.gpsFresh ? 'healthy' : 'attention'}>{activeJobTruck ? (activeJobTruck.gpsFresh ? `LinxUp · ${activeJobTruck.gpsAge} ago` : `Position stale · ${activeJobTruck.gpsAge}`) : 'Schedule assignment only'}</em></div>
                      <div><span>Krewe</span><strong>{activeJobKrewe.length ? activeJobKrewe.map((member) => member.name).join(' · ') : activeAppointment.crew}</strong><small>{activeJobKrewe.length ? activeJobKrewe.map((member) => member.role).join(' · ') : 'No attendance rows linked'}</small><em className={activeJobKrewe.some((member) => Boolean(member.issue)) ? 'attention' : 'healthy'}>{activeJobKrewe.some((member) => Boolean(member.issue)) ? 'Attendance needs review' : 'Assignment connected'}</em></div>
                      <div><span>Photos</span><strong>{activeJobPhotoAlert?.facts.find((fact) => fact.label === 'Photos')?.value || 'No verified batch'}</strong><small>{activeJobPhotoAlert?.detail || 'JunkWare photo status unavailable'}</small><em className={activeJobPhotoAlert ? 'healthy' : 'attention'}>{activeJobPhotoAlert ? 'Verified in JunkWare' : 'Verification pending'}</em></div>
                      <div><span>Closeout</span><strong>{activeAppointment.kind === 'Estimate' ? activeAppointment.state : activeJobPayment?.status || (activeAppointment.state === 'Completed' ? 'Payment not linked' : 'Not due')}</strong><small>{activeAppointment.kind === 'Estimate' ? (activeAppointment.state === 'Estimate Closed' ? 'Schedule work closed · no job revenue' : 'Estimate outcome is still open') : activeJobPayment ? `${moneyValue(activeJobPayment.jobTotal)} job total` : 'No QBO reconciliation record'}</small><em className={activeAppointment.kind === 'Estimate' ? 'estimate' : activeJobPayment?.status === 'Matched' ? 'healthy' : activeJobPayment ? 'attention' : ''}>{activeAppointment.kind === 'Estimate' ? 'Estimate · no payment closeout' : activeJobPayment ? `${activeJobPayment.method} · ${activeJobPayment.reference}` : 'JunkWare + QBO'}</em></div>
                    </div>
                  </section>
                  {activeAppointment.kind === 'Job' ? <section className="job-record-section" aria-label="Financial and recovery details">
                    <header><div><span>Closeout and Recovery</span><strong>Payment, resale, and recycling</strong></div><Badge variant="outline">{activeJobPayment ? activeJobPayment.status : 'No closeout'}</Badge></header>
                    <div className="job-record-finance-grid">
                      <div><span>Job Total</span><strong>{activeJobPayment ? moneyValue(activeJobPayment.jobTotal) : activeAppointment.details.value}</strong></div>
                      <div><span>Captured Payment</span><strong>{activeJobPayment ? moneyValue(activeJobPayment.paymentAmount) : '—'}</strong></div>
                      <div><span>Tips</span><strong>{activeJobCloseoutAlert?.facts.find((fact) => fact.label === 'Tips')?.value || '—'}</strong></div>
                      <div><span>Adjustment</span><strong>{activeJobPayment ? moneyValue(activeJobPayment.adjustment) : '—'}</strong></div>
                      <div className={activeJobPayment && activeJobPayment.jobTotal - activeJobPayment.paymentAmount - activeJobPayment.adjustment !== 0 ? 'attention' : ''}><span>Difference</span><strong>{activeJobPayment ? moneyValue(Math.abs(activeJobPayment.jobTotal - activeJobPayment.paymentAmount - activeJobPayment.adjustment)) : '—'}</strong></div>
                    </div>
                    {activeJobPayment && <p className="job-record-finance-note">{activeJobPayment.note}</p>}
                    {activeJobPayment && activeJobPayment.status !== 'Matched' && <div className="job-record-inline-actions"><Button variant="outline" size="sm" onClick={() => confirmFinanceAdjustment(activeJobPayment.id)}>Confirm Payment Adjustment <Check /></Button></div>}
                    <div className="job-record-recovery-list">
                      {activeJobRecoveryItems.length ? activeJobRecoveryItems.map((item) => <article key={item.id}><Badge variant="outline">{item.kind}</Badge><div><strong>{item.item}</strong><span>{item.id} · {item.location} · {item.quantity}</span></div><div><strong>{item.status}</strong><span>{moneyValue(item.realizedValue ?? item.expectedValue)} {item.realizedValue == null ? 'expected' : 'realized'}</span></div></article>) : <div className="job-record-empty-row">No resale or recycling records are attached to this job.</div>}
                    </div>
                  </section> : <section className="job-record-section" aria-label="Estimate disposition details">
                    <header><div><span>Estimate Record</span><strong>Outcome, quote, and follow-up</strong></div><Badge variant="outline">No Job Revenue</Badge></header>
                    <div className="estimate-record-grid">
                      <div><span>Quoted Amount</span><strong>{activeAppointment.details.value}</strong></div>
                      <div><span>Outcome</span><strong>{activeCloseoutReceipt?.estimateOutcome || (activeAppointment.state === 'Estimate Closed' ? 'Closed' : 'Pending')}</strong></div>
                      <div><span>Follow-Up</span><strong>{activeCloseoutReceipt?.followUpDate || (activeAppointment.state === 'Estimate Closed' ? 'None' : 'Not scheduled')}</strong></div>
                    </div>
                    <p className="job-record-finance-note">Estimate activity stays separate from completed Jobs, payments, resale, and recycling.</p>
                  </section>}
                  <section className="job-record-section" aria-label="Related operating work">
                    <header><div><span>Related Work</span><strong>Alerts and open actions</strong></div><Badge variant="outline">{activeJobAlerts.length + activeJobActions.length} linked</Badge></header>
                    <div className="job-record-related-list">
                      {activeJobAlerts.map((item) => <article key={`alert-${item.id}`}><span className={`job-record-link-mark ${item.priority}`} /><div><strong>{item.label} · {renderLinkedJkText(item.title, item.source, item.detected)}</strong><small>{item.context}</small></div><em>{alertWorkflowStatus(item)}</em></article>)}
                      {activeJobActions.map((item) => <article key={`action-${item.id}`}><span className={`job-record-link-mark ${item.priority}`} /><div><strong>{item.title}</strong><small>{item.owner} · {item.due}</small></div><button onClick={() => manageActionQueueItem(item)}>{item.status} <ArrowRight size={12} /></button></article>)}
                      {!activeJobAlerts.length && !activeJobActions.length && <div className="job-record-empty-row">No alerts or action items are attached to this appointment.</div>}
                    </div>
                  </section>
                  <section className="job-record-section" aria-label="Complete appointment activity">
                    <header><div><span>Activity</span><strong>Complete appointment history</strong></div><Badge variant="outline">{activeJobScheduleHistory.length + activeJobAuditHistory.length} events</Badge></header>
                    <div className="job-record-timeline">
                      {activeJobScheduleHistory.map((item, index) => <article key={`schedule-${item.type}-${item.time}-${index}`}><i /><time>{item.time}</time><div><strong>{item.type}</strong><span>{item.change}</span><small>{item.by} · {item.source}</small></div></article>)}
                      {activeJobAuditHistory.map((item) => <article key={`audit-${item.id}`}><i className={item.result === 'Needs review' ? 'attention' : ''} /><time>{item.time}</time><div><strong>{item.action}</strong><span>{item.summary}</span><small>{item.actor} · {item.source} · {item.result}</small></div></article>)}
                      {!activeJobScheduleHistory.length && !activeJobAuditHistory.length && <div className="job-record-empty-row">No linked activity has been recorded.</div>}
                    </div>
                  </section>
                  <section className="drawer-dispatch-controls" aria-label="Dispatch controls">
                    <div className="drawer-control-heading"><span>Appointment Change</span><strong>Review Before Applying</strong><small>Every edit uses one JunkWare write, exact read-back, and change-specific follow-up.</small></div>
                    {scheduleChangeBlocking && <div className="appointment-change-lock"><strong>{scheduleChangeReceipt?.appointmentId} Is Still Open</strong><span>Resolve its source verification and required communications before starting another change.</span></div>}
                    {isFinalAppointmentState(activeAppointment.state) && <div className="appointment-change-lock final"><strong>{activeAppointment.state} Appointment</strong><span>This record is in a final state. Review its activity instead of changing the live plan.</span></div>}
                    <div className="drawer-control-fields">
                      <label>
                        <span>Truck Assignment</span>
                        <select value={appointmentChangeDraft.truck} onChange={(event) => setAppointmentChangeDraft((draft) => ({ ...draft, truck: event.target.value }))} disabled={appointmentChangeLocked || appointmentChangeDraft.cancel}>
                          {scheduleRows.map((row) => <option value={row.truck} key={row.truck}>{row.truck} · {row.crew}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Appointment Window</span>
                        <select value={appointmentChangeDraft.time} onChange={(event) => setAppointmentChangeDraft((draft) => ({ ...draft, time: event.target.value }))} disabled={appointmentChangeLocked || appointmentChangeDraft.cancel}>
                          {scheduleWindowOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="drawer-quick-actions appointment-change-actions">
                      <Button className={appointmentChangeDraft.callAhead ? 'selected' : ''} variant="outline" size="sm" onClick={() => setAppointmentChangeDraft((draft) => ({ ...draft, callAhead: !draft.callAhead }))} disabled={appointmentChangeLocked || appointmentChangeDraft.cancel}>{appointmentChangeDraft.callAhead ? 'Call Ahead Included' : 'Add Call Ahead'}</Button>
                      <Button className={appointmentChangeDraft.addressVerified ? 'selected' : ''} variant="outline" size="sm" onClick={() => setAppointmentChangeDraft((draft) => ({ ...draft, addressVerified: true }))} disabled={appointmentChangeLocked || appointmentChangeDraft.cancel || appointmentChangeDraft.addressVerified}>{appointmentChangeDraft.addressVerified ? 'Address Verified' : 'Verify Address'}</Button>
                      <Button className={appointmentChangeDraft.cancel ? 'selected destructive' : ''} variant="outline" size="sm" onClick={() => setAppointmentChangeDraft((draft) => ({ ...draft, cancel: !draft.cancel }))} disabled={appointmentChangeLocked}>{appointmentChangeDraft.cancel ? 'Cancellation Included' : 'Cancel Appointment'}</Button>
                    </div>
                    {appointmentChangeDraft.cancel && (
                      <label className="drawer-cancel-field appointment-change-cancel">
                        <span>Cancellation Reason · Required</span>
                        <Input value={appointmentChangeDraft.cancellationReason} onChange={(event) => setAppointmentChangeDraft((draft) => ({ ...draft, cancellationReason: event.target.value }))} placeholder="Specific customer or operating reason" disabled={appointmentChangeLocked} />
                        <small>{appointmentChangeDraft.cancellationReason.trim().length}/8 minimum characters</small>
                      </label>
                    )}
                    {appointmentChangeDraftChanges.length > 0 && (
                      <section className="appointment-change-review" aria-label="Proposed appointment changes">
                        <header><span>Changes to Verify</span><strong>{appointmentChangeDraftChanges.length} Proposed</strong></header>
                        <div>{appointmentChangeDraftChanges.map((change) => <p key={change}>{change}</p>)}</div>
                        {appointmentChangeConflicts.length > 0 && !appointmentChangeDraft.cancel && <aside><strong>Schedule Conflict</strong><span>Overlaps {appointmentChangeConflicts.map((job) => job.jk).join(', ')}. Applying this change intentionally double-books the window.</span></aside>}
                        <footer>
                          <span>Customer · {appointmentChangeDraft.cancel || appointmentChangeDraft.time !== activeAppointment.time || appointmentChangeDraft.callAhead !== (activeAppointment.state === 'Call ahead') ? 'Confirmation required' : 'No follow-up'}</span>
                          <span>Krewe · {appointmentChangeDraft.cancel || appointmentChangeDraft.truck !== activeAppointment.truck || appointmentChangeDraft.time !== activeAppointment.time || appointmentChangeDraft.callAhead !== (activeAppointment.state === 'Call ahead') ? 'Notification required' : 'No follow-up'}</span>
                        </footer>
                      </section>
                    )}
                    <div className="appointment-change-submit">
                      <Button variant="outline" size="sm" onClick={() => applyAppointmentChangeDraft(true)} disabled={appointmentChangeLocked || !appointmentChangeDraftChanges.length || (appointmentChangeDraft.cancel && appointmentChangeDraft.cancellationReason.trim().length < 8)}>Preview Sync Issue</Button>
                      <Button size="sm" onClick={() => applyAppointmentChangeDraft(false)} disabled={appointmentChangeLocked || !appointmentChangeDraftChanges.length || (appointmentChangeDraft.cancel && appointmentChangeDraft.cancellationReason.trim().length < 8)}>{appointmentChangeConflicts.length ? 'Apply Despite Conflict' : 'Apply Changes'} <ArrowRight /></Button>
                    </div>
                    {actionFeedback && <p className="drawer-action-feedback" role="status">{actionFeedback}</p>}
                  </section>
                </>
              ) : activeFleetTruck ? (
                <>
                  {activeFleetIssue ? (
                    <>
                      <section className="fleet-drawer-overview"><div><span>Truck</span><strong>{activeFleetTruck.label}</strong><small>{activeFleetTruck.vehicle}</small></div><div><span>Severity</span><strong className={`repair-severity ${activeFleetIssue.severity.toLowerCase().replaceAll(' ', '-')}`}>{activeFleetIssue.severity}</strong><small>{activeFleetIssue.status}</small></div><div><span>Owner</span><strong>{activeFleetIssue.owner || 'Unassigned'}</strong><small>Due {activeFleetIssue.due || 'not set'}</small></div><div><span>Impact</span><strong>{metricValue(activeFleetIssue.downtime, ' hrs')}</strong><small>{moneyValue(activeFleetIssue.cost)} recorded cost</small></div></section>
                      <section className="fleet-drawer-section"><header><span>Repair work order</span></header><div className="fleet-issue-copy"><strong>{activeFleetIssue.title}</strong><p>{activeFleetIssue.description}</p>{activeFleetIssue.resolution && <small>Resolution · {activeFleetIssue.resolution}</small>}</div></section>
                      <section className="fleet-drawer-controls"><div className="drawer-control-heading"><span>Repair controls</span><strong>Update the work order</strong><small>A resolution note is required before a repair can be closed.</small></div><div className="fleet-form-grid"><label><span>Status</span><select value={fleetIssueDraft.status} onChange={(event) => setFleetIssueDraft((draft) => ({ ...draft, status: event.target.value as FleetIssueStatus }))}><option>Open</option><option>In progress</option><option>Resolved</option></select></label><label><span>Owner</span><Input value={fleetIssueDraft.owner} onChange={(event) => setFleetIssueDraft((draft) => ({ ...draft, owner: event.target.value }))} placeholder="Responsible shop or person" /></label><label><span>Due date</span><Input value={fleetIssueDraft.due} onChange={(event) => setFleetIssueDraft((draft) => ({ ...draft, due: event.target.value }))} placeholder="Sep 3" /></label><label><span>Repair cost</span><Input type="number" min="0" value={fleetIssueDraft.cost} onChange={(event) => setFleetIssueDraft((draft) => ({ ...draft, cost: event.target.value }))} placeholder="$0" /></label><label><span>Downtime hours</span><Input type="number" min="0" step="0.25" value={fleetIssueDraft.downtime} onChange={(event) => setFleetIssueDraft((draft) => ({ ...draft, downtime: event.target.value }))} /></label><label className="wide"><span>Resolution {fleetIssueDraft.status === 'Resolved' ? '· Required' : ''}</span><Textarea value={fleetIssueDraft.resolution} onChange={(event) => setFleetIssueDraft((draft) => ({ ...draft, resolution: event.target.value }))} placeholder="Work completed, parts replaced, and return-to-service verification" /></label></div>{actionFeedback && <p className="drawer-action-feedback" role="status">{actionFeedback}</p>}</section>
                    </>
                  ) : (
                    <>
                      <section className="fleet-drawer-overview"><div><span>Readiness</span><strong className={`fleet-readiness ${activeFleetTruck.readiness.toLowerCase().replaceAll(' ', '-')}`}>{activeFleetTruck.readiness}</strong><small>{activeFleetTruck.operatingStatus}</small></div><div><span>Assignment</span><strong>{renderLinkedJkText(activeFleetTruck.assignment, 'Fleet + JunkWare', activeFleetTruck.gpsFresh ? `Updated ${activeFleetTruck.gpsAge} ago` : `Stale · ${activeFleetTruck.gpsAge}`)}</strong><small>{activeFleetTruck.driver} · {activeFleetTruck.navigator}</small></div><div><span>Location</span><strong>{activeFleetTruck.location}</strong><small className={activeFleetTruck.gpsFresh ? 'fresh' : 'stale'}>{activeFleetTruck.gpsFresh ? `Updated ${activeFleetTruck.gpsAge} ago` : `Stale · ${activeFleetTruck.gpsAge}`}</small></div><div><span>Vehicle</span><strong>{activeFleetTruck.vehicle}</strong><small>{activeFleetTruck.odometer.toLocaleString()} mi</small></div><div><span>Inspection</span><strong>{activeFleetTruck.checklist}</strong><small>Daily readiness checklist</small></div><div><span>Next service</span><strong>{activeFleetTruck.nextService}</strong><small className={`service-${activeFleetTruck.serviceTone}`}>{activeFleetTruck.serviceTone === 'due' ? 'Due now' : activeFleetTruck.serviceTone === 'soon' ? 'Due soon' : 'Current'}</small></div><div><span>Driver score</span><strong>{activeFleetTruck.driverScore ?? '—'}</strong><small>{activeFleetTruck.driverScore == null ? 'No driving activity' : 'Current reporting period'}</small></div><div><span>Production</span><strong>{activeFleetTruck.jobs} jobs · {moneyValue(activeFleetTruck.revenue)}</strong><small>{activeFleetTruck.miles.toLocaleString()} miles driven</small></div></section>
                      <div className="truck-record-actions"><Button variant="outline" size="sm" onClick={openTruckSchedule}>Open Today’s Schedule <CalendarDays /></Button><Button variant="outline" size="sm" onClick={openTruckMaintenance}>Open Maintenance <Wrench /></Button></div>
                      <section className="job-record-section truck-record-section" aria-label="Truck appointments">
                        <header><div><span>Schedule</span><strong>Today and Tomorrow</strong></div><Badge variant="outline">{activeTruckAppointments.length} appointment{activeTruckAppointments.length === 1 ? '' : 's'}</Badge></header>
                        <div className="truck-record-appointment-list">
                          {activeTruckAppointments.map((appointment) => <button onClick={() => openUnifiedJobRecord(appointment.jk, 'Truck Record + JunkWare', appointment.day === 'today' ? 'Today · Live' : 'Tomorrow plan')} key={`${appointment.day}-${appointment.jk}`}><time><strong>{appointment.day === 'today' ? 'Today' : 'Tomorrow'}</strong><span>{appointment.time}</span></time><div><strong>{appointment.jk} · {appointment.customer}</strong><span>{appointment.area} · {appointment.details.scope}</span></div><em className={appointment.state.toLowerCase().replaceAll(' ', '-')}>{appointment.state}</em><ArrowRight size={14} /></button>)}
                          {!activeTruckAppointments.length && <div className="job-record-empty-row">No appointments are currently linked to this truck.</div>}
                        </div>
                      </section>
                      <section className="job-record-section truck-record-section" aria-label="Assigned Krewe">
                        <header><div><span>Krewe</span><strong>Current truck assignment</strong></div><Badge variant="outline">{activeTruckKrewe.length} assigned</Badge></header>
                        <div className="truck-record-krewe-list">
                          {activeTruckKrewe.map((member) => <button onClick={() => { setActiveNav('Krewe'); setKreweView('today'); openKreweMember(member); }} key={member.id}><i>{member.initials}</i><div><strong>{member.name}</strong><span>{member.role} · {member.status}</span></div>{member.issue ? <em>Needs attention</em> : <em className="healthy">Connected</em>}<ArrowRight size={13} /></button>)}
                          {!activeTruckKrewe.length && <div className="job-record-empty-row">No active Krewe assignment is linked to this truck.</div>}
                        </div>
                      </section>
                      <section className="fleet-drawer-controls"><div className="drawer-control-heading"><span>Truck load ledger</span><strong>Update verified load status</strong><small>GPS presence at a dump or recycler never resets this value automatically.</small></div><div className="fleet-load-form"><label><span>Load percent</span><Input type="number" min="0" max="100" value={fleetLoadDraft.percent} onChange={(event) => setFleetLoadDraft((draft) => ({ ...draft, percent: event.target.value }))} /></label><label className="wide"><span>Load or reset note</span><Input value={fleetLoadDraft.note} onChange={(event) => setFleetLoadDraft((draft) => ({ ...draft, note: event.target.value }))} placeholder="Load contents or verified reset source" /></label><label className="wide"><span>Metal status</span><Input value={fleetLoadDraft.metal} onChange={(event) => setFleetLoadDraft((draft) => ({ ...draft, metal: event.target.value }))} placeholder="Metal fraction or yard status" /></label></div><div className="fleet-load-actions"><Button variant="outline" size="sm" onClick={resetFleetLoad}>Record dump / yard reset</Button><Button size="sm" onClick={saveFleetLoad}>Save load status</Button></div>{actionFeedback && <p className="drawer-action-feedback" role="status">{actionFeedback}</p>}</section>
                      <section className="job-record-section truck-record-section" aria-label="Maintenance and repairs">
                        <header><div><span>Maintenance</span><strong>Service and repair history</strong></div><Badge variant="outline">{activeTruckIssues.filter((issue) => issue.status !== 'Resolved').length} active</Badge></header>
                        <div className="truck-record-maintenance-summary"><div><span>Next Service</span><strong>{activeFleetTruck.nextService}</strong><small className={`service-${activeFleetTruck.serviceTone}`}>{activeFleetTruck.serviceTone === 'due' ? 'Due now' : activeFleetTruck.serviceTone === 'soon' ? 'Due soon' : 'Current'}</small></div><div><span>Open Repairs</span><strong>{activeTruckIssues.filter((issue) => issue.status !== 'Resolved').length}</strong><small>{activeTruckIssues.filter((issue) => issue.status === 'In progress').length} in progress</small></div><div><span>Recorded Downtime</span><strong>{metricValue(activeTruckIssues.reduce((sum, issue) => sum + issue.downtime, 0), ' hrs')}</strong><small>{moneyValue(activeTruckIssues.reduce((sum, issue) => sum + (issue.cost || 0), 0))} repair cost</small></div></div>
                        <div className="fleet-drawer-issue-list">{activeTruckIssues.map((issue) => <button onClick={() => openFleetIssue(issue)} key={issue.id}><span><strong>{issue.title}</strong><small>{issue.severity} · {issue.status} · {issue.owner || 'Unassigned'}</small></span><ArrowRight size={14} /></button>)}{!activeTruckIssues.length && <div className="job-record-empty-row">No repair history is linked to this truck.</div>}</div>
                      </section>
                      <section className="job-record-section truck-record-section" aria-label="Truck operating work">
                        <header><div><span>Open Work</span><strong>Alerts and action ownership</strong></div><Badge variant="outline">{activeTruckAlerts.filter(alertNeedsControl).length + activeTruckActions.length} active</Badge></header>
                        <div className="job-record-related-list">
                          {activeTruckAlerts.map((item) => <article key={`truck-alert-${item.id}`}><span className={`job-record-link-mark ${item.priority}`} /><div><strong>{item.label} · {renderLinkedJkText(item.title, item.source, item.detected)}</strong><small>{item.context}</small></div><button onClick={() => openAlertRecord(item)}>{alertWorkflowStatus(item)} <ArrowRight size={12} /></button></article>)}
                          {activeTruckActions.map((item) => <article key={`truck-action-${item.id}`}><span className={`job-record-link-mark ${item.priority}`} /><div><strong>{item.title}</strong><small>{item.owner} · {item.due}</small></div><button onClick={() => manageActionQueueItem(item)}>{item.status} <ArrowRight size={12} /></button></article>)}
                          {!activeTruckAlerts.length && !activeTruckActions.length && <div className="job-record-empty-row">No alerts or action items are attached to this truck.</div>}
                        </div>
                      </section>
                      <section className="job-record-section truck-record-section" aria-label="Truck activity">
                        <header><div><span>Activity</span><strong>Schedule, Fleet, and manager actions</strong></div><Badge variant="outline">{activeTruckScheduleHistory.length + activeTruckAuditHistory.length} events</Badge></header>
                        <div className="job-record-timeline">
                          {activeTruckScheduleHistory.map((item, index) => <article key={`truck-schedule-${item.type}-${item.time}-${index}`}><i /><time>{item.time}</time><div><strong>{item.type} · {renderJkLink(item.jk, item.source, item.time)}</strong><span>{item.change}</span><small>{item.by} · {item.source}</small></div></article>)}
                          {activeTruckAuditHistory.map((item) => <article key={`truck-audit-${item.id}`}><i className={item.result === 'Needs review' ? 'attention' : ''} /><time>{item.time}</time><div><strong>{item.action}</strong><span>{item.summary}</span><small>{item.actor} · {item.source} · {item.result}</small></div></article>)}
                          {!activeTruckScheduleHistory.length && !activeTruckAuditHistory.length && <div className="job-record-empty-row">No linked truck activity has been recorded.</div>}
                        </div>
                      </section>
                    </>
                  )}
                </>
              ) : (
                <>
                  <p className="drawer-summary">{drawer.summary}</p>
                  {activeKrewe ? (
                    <div className="krewe-drawer-details">
                      {kreweView === 'payperiod' && <section><header>Current pay period · Aug 18–31</header><div><span><small>Regular hours</small><strong>{metricValue(activeKrewe.period.regularHours, ' hrs')}</strong></span><span><small>Overtime hours</small><strong>{metricValue(activeKrewe.period.overtimeHours, ' hrs')}</strong></span><span><small>Jobs</small><strong>{activeKrewe.period.jobs}</strong></span><span><small>Credited revenue</small><strong>{moneyValue(activeKrewe.period.revenue)}</strong></span><span><small>Hourly labor</small><strong>{moneyValue(activeKrewe.period.labor)}</strong></span><span><small>Tips</small><strong>{moneyValue(activeKrewe.period.tips)}</strong></span><span><small>Bonuses</small><strong>{moneyValue(activeKrewe.period.bonuses)}</strong></span><span className="total"><small>Total pay</small><strong>{moneyValue(activeKrewe.period.totalPay)}</strong></span></div></section>}
                      {kreweView === 'monthly' && <section><header>{kreweMonth === 'august' ? 'August 2026' : 'July 2026'} totals</header><div><span><small>Total hours</small><strong>{metricValue((activeKrewe.month.regularHours + activeKrewe.month.overtimeHours) * monthFactor, ' hrs')}</strong></span><span><small>Overtime hours</small><strong>{metricValue(activeKrewe.month.overtimeHours * monthFactor, ' hrs')}</strong></span><span><small>Jobs</small><strong>{Math.round(activeKrewe.month.jobs * monthFactor)}</strong></span><span><small>Credited revenue</small><strong>{moneyValue(activeKrewe.month.revenue * monthFactor)}</strong></span><span><small>Hourly labor</small><strong>{moneyValue(activeKrewe.month.labor * monthFactor)}</strong></span><span><small>Tips</small><strong>{moneyValue(activeKrewe.month.tips * monthFactor)}</strong></span><span><small>Bonuses</small><strong>{moneyValue(activeKrewe.month.bonuses * monthFactor)}</strong></span><span className="total"><small>Total pay</small><strong>{moneyValue(activeKrewe.month.totalPay * monthFactor)}</strong></span></div></section>}
                      <section><header>Attendance</header><div><span><small>Clock in</small><strong>{activeKrewe.clockIn}</strong></span><span><small>Clock out</small><strong>{activeKrewe.clockOut === '—' && activeKrewe.status === 'Clocked in' ? 'On shift' : activeKrewe.clockOut}</strong></span><span><small>Hours</small><strong>{metricValue(activeKrewe.hours, ' hrs')}</strong></span><span><small>Shift status</small><strong>{activeKrewe.status}</strong></span><span><small>Assignment confidence</small><strong>{activeKrewe.assignmentConfidence}</strong></span></div></section>
                      <section><header>Production</header><div><span><small>Jobs</small><strong>{activeKrewe.jobs ?? '—'}</strong></span><span><small>Job revenue worked</small><strong>{moneyValue(activeKrewe.jobRevenue)}</strong></span><span><small>Credited revenue</small><strong>{moneyValue(activeKrewe.revenue)}</strong></span><span><small>Estimates closed as jobs</small><strong>{activeKrewe.estimatesClosed ?? '—'}</strong><em>{activeKrewe.closeRate == null ? 'Close rate unavailable' : `${activeKrewe.closeRate}% close rate`}</em></span><span><small>Revenue / hr</small><strong>{moneyValue(activeKrewe.rph)}</strong></span><span><small>Average job size</small><strong>{moneyValue(activeKrewe.averageJob)}</strong></span></div></section>
                      <section><header>Earnings</header><div><span><small>Revenue bonus</small><strong>{moneyValue(activeKrewe.revenueBonus)}</strong></span><span><small>Manual bonus</small><strong>{moneyValue(activeKrewe.manualBonus)}</strong></span><span><small>Other bonus</small><strong>{activeKrewe.totalPay == null ? '—' : moneyValue(activeKrewe.otherBonus || 0)}</strong></span><span><small>Total bonuses</small><strong>{activeKrewe.totalPay == null ? '—' : moneyValue((activeKrewe.revenueBonus || 0) + (activeKrewe.manualBonus || 0) + (activeKrewe.otherBonus || 0))}</strong></span><span><small>Hourly rate</small><strong>{moneyValue(activeKrewe.hourlyRate)}</strong></span><span><small>Hourly labor cost</small><strong>{moneyValue(activeKrewe.regularPay == null ? null : activeKrewe.regularPay + (activeKrewe.overtimeAdditional || 0))}</strong><em>{activeKrewe.regularPay == null ? 'Unavailable' : `${moneyValue(activeKrewe.regularPay)} regular + ${moneyValue(activeKrewe.overtimeAdditional)} OT additional`}</em></span><span><small>Tips</small><strong>{moneyValue(activeKrewe.tips)}</strong></span><span><small>Supplemental pay</small><strong>{moneyValue(activeKrewe.supplementalPay)}</strong></span><span className="total"><small>Total pay</small><strong>{moneyValue(activeKrewe.totalPay)}</strong></span></div></section>
                      <section><header>Driving</header><div><span><small>Driver score</small><strong>{activeKrewe.driverScore ?? '—'}</strong><em>{activeKrewe.driverStatus}</em></span></div></section>
                    </div>
                  ) : (
                    <>
                      <section className="drawer-facts" aria-label="Record details">
                        {drawerFacts.map((fact) => (
                          <div key={fact.label}><span>{fact.label}</span>{fact.label.toLowerCase().includes('address') ? <GoogleMapsAddress address={fact.value} /> : fact.label.toLowerCase().includes('phone') ? <PhoneContact phone={fact.value} copy /> : /^JK\d{7}$/.test(fact.value) ? renderJkLink(fact.value, drawer.source, drawer.updated) : fact.href ? <a href={fact.href}>{fact.value}</a> : <strong>{renderLinkedJkText(fact.value, drawer.source, drawer.updated)}</strong>}</div>
                        ))}
                      </section>
                      {actionFeedback && <p className="drawer-action-feedback" role="status">{actionFeedback}</p>}
                    </>
                  )}
                  {activeKrewe && (
                    <section className="krewe-drawer-controls" aria-label="Krewe controls">
                      <div className="drawer-control-heading"><span>Manager controls</span><strong>Assignment, time, and bonus</strong><small>Every correction keeps its manager reason. Time corrections override OpsCenter calculations without altering the JunkWare source record in this prototype.</small></div>
                      <label className="krewe-drawer-assignment"><span>Truck assignment</span><select value={activeKrewe.truck} disabled={activeKrewe.status === 'Off today'} onChange={(event) => assignKreweMember(activeKrewe.id, event.target.value)}>{activeKrewe.status === 'Off today' && <option>Not scheduled</option>}{kreweTruckOptions.map((truck) => <option value={truck} key={truck}>{truck}</option>)}</select></label>
                      <div className="krewe-time-fields">
                        <label><span>Corrected clock-in</span><Input type="time" value={timeCorrection.clockIn} onChange={(event) => setTimeCorrection((correction) => ({ ...correction, clockIn: event.target.value }))} /></label>
                        <label><span>Corrected clock-out</span><Input type="time" value={timeCorrection.clockOut} onChange={(event) => setTimeCorrection((correction) => ({ ...correction, clockOut: event.target.value }))} /></label>
                      </div>
                      <label className="krewe-correction-reason"><span>Correction reason</span><Input value={timeCorrection.reason} onChange={(event) => setTimeCorrection((correction) => ({ ...correction, reason: event.target.value }))} placeholder="Required manager reason" /></label>
                      <div className="krewe-bonus-control">
                        <div><span>Manual bonus</span><strong>Add an attributable adjustment</strong></div>
                        <div><label><span>Amount</span><Input type="number" min="0" step="1" value={bonusEntry.amount} onChange={(event) => setBonusEntry((entry) => ({ ...entry, amount: event.target.value }))} placeholder="$0" /></label><label><span>Reason</span><Input value={bonusEntry.reason} onChange={(event) => setBonusEntry((entry) => ({ ...entry, reason: event.target.value }))} placeholder="Required manager reason" /></label></div>
                        <Button variant="outline" size="sm" onClick={addKreweBonus}>Add bonus</Button>
                      </div>
                      {actionFeedback && <p className="drawer-action-feedback" role="status">{actionFeedback}</p>}
                    </section>
                  )}
                </>
              )}
              <section className="drawer-audit">
                <div><span>Source</span><strong>{drawer.source}</strong></div>
                <div><span>Last update</span><strong>{drawer.updated}</strong></div>
              </section>
            </div>
            <footer className="record-drawer-actions">
              <Button variant="outline" onClick={closeRecordDrawer}>Close</Button>
              {activeCustomer
                ? <Button onClick={openNewAppointmentForCustomer}>New Appointment <CalendarDays /></Button>
                : activeArea
                ? <Button onClick={openNewAppointmentForArea}>New Appointment in Area <CalendarDays /></Button>
                : activeTerritory
                ? <Button onClick={() => openTerritorySchedule('today')}>Focus Live Schedule <ArrowRight /></Button>
                : activeActionQueueItem
                ? activeActionQueueItem.status === 'Awaiting Verification'
                  ? <Button onClick={completeActionQueueItem}>Verify and Resolve <ShieldCheck /></Button>
                  : <Button onClick={submitActionForVerification}>Submit for Verification <ArrowRight /></Button>
                : activeAppointment
                ? isFinalAppointmentState(activeAppointment.state)
                  ? <Button onClick={() => setActionFeedback('JunkWare handoff is ready. The production record link will open here when this prototype is connected.')}>Review in JunkWare <ArrowRight /></Button>
                  : appointmentCloseoutOpen
                    ? <Button onClick={completeAppointmentCloseout}>{appointmentCloseoutDraft.category === 'Job' ? 'Complete Job' : 'Close Estimate'} <Check /></Button>
                    : <Button onClick={() => { setAppointmentCloseoutOpen(true); setAppointmentCloseoutError(''); }}>Close Appointment <ArrowRight /></Button>
                : activeJobReference
                ? <Button onClick={() => setActionFeedback('JunkWare handoff is ready. The production record link will open here when this prototype is connected.')}>Open in JunkWare <ArrowRight /></Button>
                : activeFleetIssue
                  ? <Button onClick={saveFleetIssue}>Save work order <Check /></Button>
                  : activeFleetTruck
                    ? <Button onClick={saveFleetLoad}>Save truck status <Check /></Button>
                : activeKrewe
                  ? <Button onClick={saveKreweCorrection}>Save correction <Check /></Button>
                  : activeFollowup
                  ? <Button onClick={() => markFollowupHandled(activeFollowup.jk)}>Mark handled <Check /></Button>
                : <Button onClick={closeRecordDrawer}>{drawer.action} <ArrowRight /></Button>}
            </footer>
          </aside>
        </>
      )}
    </main>
  );
}
