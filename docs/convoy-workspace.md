# Convoy workspace

The desktop Convoy uses truck cards and direct record controls. Its tabs are
Trucks, Inspections & Repairs, Service, Driving, and History & Costs. Existing
`fleetView` route values remain unchanged. A truck selected in the filter or
opened in a record stays selected when switching tabs; All trucks clears the
filter. The filter never silently falls back to a different truck.

Trucks combines recorded condition, inspection status, physical load and GPS
activity. Uncertain load is labeled as needing confirmation and has no capacity
bar. Its original estimate and evidence remain available in the load detail.
Ready describes inspection/repair evidence; it does not establish current GPS.
Load notes are expandable and do not repeat above unrelated tabs. Missing repair
or GPS sources remain explicitly visible.

Inspections links to original phone reports and photos. Repairs offers direct
updates without requiring an owner or decision workflow. Existing shop/contact
and planned-date values remain available in optional details and are preserved
when other repair fields are saved. Similar active records are flagged for review,
never merged or deleted automatically. Existing repairs offer Delete repair with
an explicit confirmation naming the repair and truck. A verified deletion removes
the record from repair lists, history, readiness and repair-cost totals; original
inspection evidence remains unchanged. The store retains a private deleted copy
with actor/time and source links, preventing checklist replay from recreating it.
Deleted copies cannot be edited or have attachments changed. The delete action
uses the same permissions, record version, write lock and receipt as repair saves.

Service separates Schedule service from Record completed service. Each action
opens the same versioned record form with the appropriate status. Missing history,
odometer and targets are labeled explicitly. Completed service targets are shown
by service type; a past scheduled date is not proof that service occurred.

Driving keeps scores and event deductions in expandable truck rows, including
coverage and attribution limitations. History & Costs keeps monthly observed
production/driving, repair costs from records updated that month, completed service
costs, and all recorded repair/service history distinct. These are recorded costs,
not a reconciliation against accounting. Missing cost or downtime is not zero.

Writes retain the existing desktop action API, permissions, expected versions,
request IDs, saved receipts and read-back controls. This redesign adds no provider,
metered requests, collector, dispatch change or automatic repair action.

Validation: `scripts/test-convoy-presentation.ts`, fleet action and desktop
receipt tests, inspection/score regressions, CSS architecture, both TypeScript
projects, full production build, synthetic browser saves, and authenticated
acceptance of every live tab. The isolated UI fixture is
`desktop-ui/tests/convoy.html`; its mocked writes never touch runtime records.
