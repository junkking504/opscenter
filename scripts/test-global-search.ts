import assert from "node:assert/strict";
import { searchGlobalIndex, type GlobalSearchResult } from "../lib/global-search";

const index: GlobalSearchResult[] = [
  { id: "job:1", type: "job", title: "Ada Customer · JK4069000", subtitle: "Today", source: "JunkWare appointment", href: "/jobs?q=JK4069000", searchText: "Ada Customer JK4069000 5045550100 Truck 9" },
  { id: "job:2", type: "job", title: "Other Customer · JK4099999", subtitle: "Today", source: "JunkWare appointment", href: "/jobs?q=JK4099999", searchText: "Other Customer JK4099999 5045550101 Truck 1" },
  { id: "crew:1", type: "crew", title: "Devin Operator", subtitle: "Clocked in · Truck 9", source: "OpsCenter Krewe snapshot", href: "/crew", searchText: "Devin Operator Truck 9 clocked in" },
  { id: "truck:9", type: "truck", title: "Truck# 9", subtitle: "Live GPS · Devin Operator", source: "Linxup fleet", href: "/fleet?view=daily&section=map&truck=9", searchText: "Truck 9 Devin Operator Louisiana Plate" },
];

assert.deepEqual(searchGlobalIndex(index, "JK4069000").map((result) => result.id), ["job:1"]);
assert.deepEqual(searchGlobalIndex(index, "Devin").map((result) => result.id), ["crew:1", "truck:9"]);
assert.deepEqual(searchGlobalIndex(index, "truck 9").map((result) => result.id), ["truck:9", "job:1", "crew:1"]);
assert.ok(!searchGlobalIndex(index, "truck 9").some((result) => result.id === "job:2"));
assert.equal(searchGlobalIndex(index, "truck 9")[0]?.href, "/fleet?view=daily&section=map&truck=9");
assert.deepEqual(searchGlobalIndex(index, "missing"), []);
assert.deepEqual(searchGlobalIndex(index, "x"), []);

console.log("Global cross-entity search contracts passed.");
