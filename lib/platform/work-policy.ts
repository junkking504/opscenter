import type { WorkItem } from "@/lib/platform/contracts";

export type InboxAttentionBucket = "act_now" | "today" | "waiting" | "resolved";

export type InboxRulePolicy = {
  dueMinutes: number;
  recommendedAction: string;
};

export const INBOX_RULE_POLICIES: Readonly<Record<string, InboxRulePolicy>> = Object.freeze({
  completed_job_with_no_driver: {
    dueMinutes: 30,
    recommendedAction: "Confirm the Krewe and assign the verified driver in JunkWare.",
  },
  completed_job_with_no_navigator: {
    dueMinutes: 60,
    recommendedAction: "Confirm the Krewe assignment or document that this was a one-person job.",
  },
  completed_job_assigned_to_virtual_truck: {
    dueMinutes: 30,
    recommendedAction: "Move the completed job to the physical truck, then verify the JunkWare assignment.",
  },
  job_with_revenue_but_no_credited_crew: {
    dueMinutes: 60,
    recommendedAction: "Verify the working Krewe and correct the job credit before payroll review.",
  },
  payment_amount_present_but_payment_type_missing: {
    dueMinutes: 30,
    recommendedAction: "Set the payment method in the closeout and verify it from fresh JunkWare data.",
  },
  completed_job_with_no_closeout_photos: {
    dueMinutes: 120,
    recommendedAction: "Attach the correct closeout photos or record why the photo requirement does not apply.",
  },
  whatsapp_job_photo_needs_review: {
    dueMinutes: 60,
    recommendedAction: "Review the WhatsApp photo and match it to the correct job before publishing it.",
  },
  employee_clocked_in_but_not_assigned_to_truck: {
    dueMinutes: 30,
    recommendedAction: "Assign the employee to the correct physical truck or correct the clock status.",
  },
  employee_assigned_to_job_but_missing_from_attendance: {
    dueMinutes: 60,
    recommendedAction: "Reconcile the verified job Krewe with attendance before relying on Krewe credit or payroll.",
  },
  open_appointment_past_scheduled_window: {
    dueMinutes: 15,
    recommendedAction: "Contact the assigned Krewe and update the appointment status or operating plan.",
  },
  missing_customer_information: {
    dueMinutes: 60,
    recommendedAction: "Complete the missing contact, address, or appointment-window information in JunkWare.",
  },
  truck_assigned_to_jobs_but_missing_gps_data: {
    dueMinutes: 15,
    recommendedAction: "Verify the tracker mapping and connectivity, then record an auditable GPS-gap confirmation.",
  },
  active_truck_with_no_linxup_location: {
    dueMinutes: 15,
    recommendedAction: "Check the current LinxUp tracker state and record the verified reason for the missing location.",
  },
  gps_timestamp_older_than_20_minutes: {
    dueMinutes: 20,
    recommendedAction: "Refresh LinxUp and verify tracker connectivity without inferring unobserved movement.",
  },
  missing_or_stale_expense_source_data: {
    dueMinutes: 120,
    recommendedAction: "Refresh the expense source and reconcile the totals before relying on the finance view.",
  },
});

export const INBOX_RULES = new Set(Object.keys(INBOX_RULE_POLICIES));

export function inboxRulePolicy(rule: string): InboxRulePolicy {
  return INBOX_RULE_POLICIES[rule] || {
    dueMinutes: 120,
    recommendedAction: "Open the related record, complete the follow-up, and record how the result was verified.",
  };
}

export function dueAtForRule(rule: string, now: Date = new Date()): string {
  return new Date(now.getTime() + inboxRulePolicy(rule).dueMinutes * 60_000).toISOString();
}

export function attentionBucketForWorkItem(
  item: Pick<WorkItem, "status" | "severity" | "dueAt" | "operatingDate">,
  selectedOperatingDate?: string,
  now: Date = new Date(),
): InboxAttentionBucket {
  if (item.status === "resolved" || item.status === "dismissed") return "resolved";
  if (item.status === "snoozed") return "waiting";
  if (selectedOperatingDate && item.operatingDate < selectedOperatingDate) return "act_now";
  const due = item.dueAt ? new Date(item.dueAt) : null;
  const overdue = Boolean(due && !Number.isNaN(due.getTime()) && due.getTime() <= now.getTime());
  return overdue || item.severity === "critical" ? "act_now" : "today";
}

export type ManualWorkItemRequest = {
  title: string;
  description: string;
  category: WorkItem["category"];
  severity: WorkItem["severity"];
  relatedRecord: string;
  dueAt?: string;
  assignToSelf: boolean;
};

function boundedText(value: unknown, label: string, minimum: number, maximum: number): string {
  const text = String(value || "").trim();
  if (text.length < minimum) throw new Error(`${label} must be at least ${minimum} characters.`);
  if (text.length > maximum) throw new Error(`${label} must be ${maximum} characters or fewer.`);
  return text;
}

export function parseManualWorkItemRequest(value: unknown, now: Date = new Date()): ManualWorkItemRequest {
  if (!value || typeof value !== "object") throw new Error("Work-item details are required.");
  const body = value as Record<string, unknown>;
  const categories: WorkItem["category"][] = ["Jobs", "Crew", "Fleet", "Finance"];
  const severities: WorkItem["severity"][] = ["critical", "warning", "info"];
  const category = String(body.category || "") as WorkItem["category"];
  const severity = String(body.severity || "") as WorkItem["severity"];
  if (!categories.includes(category)) throw new Error("A valid work-item category is required.");
  if (!severities.includes(severity)) throw new Error("A valid work-item severity is required.");

  const dueValue = String(body.dueAt || "").trim();
  let dueAt: string | undefined;
  if (dueValue) {
    const due = new Date(dueValue);
    if (Number.isNaN(due.getTime()) || due.getTime() <= now.getTime()) {
      throw new Error("The due time must be in the future.");
    }
    if (due.getTime() > now.getTime() + 31 * 24 * 60 * 60_000) {
      throw new Error("The due time must be within 31 days.");
    }
    dueAt = due.toISOString();
  }

  const relatedRecord = String(body.relatedRecord || "").trim().slice(0, 160);
  if (relatedRecord.includes("|")) throw new Error("Related record must not contain a vertical bar.");

  return {
    title: boundedText(body.title, "Title", 3, 160),
    description: boundedText(body.description, "Description", 3, 1_000),
    category,
    severity,
    relatedRecord,
    dueAt,
    assignToSelf: body.assignToSelf !== false,
  };
}
