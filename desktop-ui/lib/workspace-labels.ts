// Display names are separate from persisted workspace keys and deep links.
const workspaceLabels: Record<string, string> = {
  Command: 'Dashboard',
  Schedule: 'Command',
  Krewe: 'Krewe',
  Fleet: 'Fleet',
  Finance: 'Finance',
  Marketing: 'Marketing',
};

export function workspaceLabel(workspace: string): string {
  return workspaceLabels[workspace] ?? workspace;
}
