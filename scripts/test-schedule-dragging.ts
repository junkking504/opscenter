import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveJunkwareAssignedTruck } from "@/lib/junkware-truck-label";
import { canDragScheduleAppointment, scheduleDragScrollDelta } from "@/lib/schedule-drag";

assert.equal(canDragScheduleAppointment({ statusBucket: "Open" }), true);
assert.equal(canDragScheduleAppointment({ statusBucket: "Completed" }), true);
assert.equal(canDragScheduleAppointment({ statusBucket: "Estimate" }), true);
assert.equal(canDragScheduleAppointment({ statusBucket: "Canceled" }), false);

assert.equal(scheduleDragScrollDelta(36, 0, 800), -9);
assert.equal(scheduleDragScrollDelta(400, 0, 800), 0);
assert.equal(scheduleDragScrollDelta(764, 0, 800), 9);
assert.equal(scheduleDragScrollDelta(80, 100, 700), -18);
assert.equal(scheduleDragScrollDelta(720, 100, 700), 18);
assert.equal(scheduleDragScrollDelta(10, 10, 10), 0);

assert.equal(resolveJunkwareAssignedTruck({
  selectedOption: "Truck# 3",
  assignedLabel: "",
}), "Truck 3");
assert.equal(resolveJunkwareAssignedTruck({
  selectedOption: "",
  assignedLabel: "Truck# 4",
}), "Truck 4");

const jobsMapSource = readFileSync(new URL("../components/JobsMap.tsx", import.meta.url), "utf8");
assert.ok(!jobsMapSource.includes("draggable={"), "Schedule blocks must not mix native drag events with pointer dragging.");
assert.ok(jobsMapSource.includes("setPointerCapture"), "Schedule dragging must keep pointer control while moving between trucks.");
assert.ok(jobsMapSource.includes('source.closest<HTMLElement>(".ops-jobs-map-schedule")'), "Schedule dragging must locate its scroll container.");
assert.ok(jobsMapSource.includes("scheduleScroller?.scrollBy"), "Schedule dragging must auto-scroll to off-screen trucks and times.");

const jobsMapCss = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
assert.ok(jobsMapCss.includes(".ops-jobs-map-board-block.is-draggable"), "Movable schedule blocks must expose a drag cursor without styling locked blocks as movable.");
