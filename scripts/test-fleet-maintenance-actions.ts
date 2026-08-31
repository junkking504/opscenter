import assert from "node:assert/strict";
import { buildFleetMaintenanceActions } from "@/lib/fleet-maintenance-actions";

const actions = buildFleetMaintenanceActions({
  today: "2026-08-28",
  truckOptions: ["Truck# 2", "Truck# 4"],
  entries: [],
  customizations: [],
  issues: [{ issueId: "issue-1", truck: "Truck# 2", title: "Rear door hinge", description: "", severity: "out_of_service", status: "open", owner: "", dueDate: "", resolution: "", cost: null, downtimeHours: null, photos: [], attachments: [], sourceChecklistEntryId: "", sourceChecklistItemId: "", sourceInspectionDate: "", sourceInspector: "", createdAt: "", updatedAt: "", resolvedAt: "" }],
  fleetMap: { date: "2026-08-28", isToday: true, viewMode: "daily", gpsDataStatus: "Partial GPS", lastUpdatedAt: null, staleThresholdMinutes: 120, trucksWithCoordinates: 1, trucksWithoutCoordinates: ["Truck# 4"], routeHistoryAvailable: true, selectedTruck: null, selectedTruckRecord: null, mappingWarnings: [], trucks: [{ truck: "Truck# 2", freshnessLabel: "Offline", lastGpsUpdate: "2026-08-28T12:00:00Z" }] } as never,
});

assert.equal(actions[0]?.priority, "stop");
assert.equal(actions[0]?.issueId, "issue-1");
assert.ok(actions.some((action) => action.kind === "checklist" && action.truck === "Truck# 4"));
assert.ok(actions.some((action) => action.kind === "telemetry" && action.priority === "urgent"));
assert.ok(actions.some((action) => action.kind === "mapping" && action.truck === "Truck# 4"));

console.log("fleet maintenance action tests passed");
