# OpsCenter

OpsCenter is evolving from an operations dashboard into the operating control
plane for Junk King Operations: one place to understand current state, own
work, execute policy-controlled actions, and verify outcomes.

Start at **[OpsCenter Home](docs/Home.md)** for the complete source,
documentation, integration, runtime, editing, and sharing map.

The current application includes dashboard, Jobs, Krewe, Fleet, Marketing, and
Finance surfaces plus selected operational write workflows. The original daily
metrics file remains the primary read projection while the platform kernel is
built underneath the existing application.

## Product direction

- [OpsCenter Home](docs/Home.md)
- [Asset Register](docs/ASSET_REGISTER.md)
- [Editing and Releases](docs/EDITING_AND_RELEASES.md)
- [Sharing and Access](docs/SHARING_AND_ACCESS.md)
- [OpsCenter OS Constitution](docs/OPSCENTER_OS_CONSTITUTION.md)
- [Platform Kernel Architecture](docs/PLATFORM_KERNEL_ARCHITECTURE.md)
- [Operating Inbox: First Vertical Slice](docs/OPERATING_INBOX_VERTICAL_SLICE.md)

## Data Source

The primary dashboard projection is read from:

```text
../opsbot/data/processed/daily_metrics.json
```

Several operational workflows also use narrowly scoped integrations documented
under `docs/`. Consult the platform architecture before adding a new write path.

## Start

```sh
cd opscenter
npm install
npm run dev
```

Then open:

```text
http://localhost:3000
```

## Pages

- Dashboard
- Fleet
- Finance
- Jobs
- Appointment Search

## Notes

- Rule #1: OpsCenter must maintain current data. The collector refreshes at
  service startup, retries failed publishes after 15 seconds, and interrupts
  its normal wait as soon as network connectivity returns. Open current-data
  pages automatically advance when a newer daily snapshot is published;
  historical dates remain fixed only when an operator selects them explicitly.
- Missing data is handled with empty states.
- Dark mode follows the system color scheme.
- All data is read locally from `daily_metrics.json`.
