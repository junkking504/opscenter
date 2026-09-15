// Display names are separate from persisted workspace keys and deep links.
const workspaceLabels: Record<string, string> = {
  Command: 'Command',
  Schedule: 'Control',
  Krewe: 'Crew',
  Fleet: 'Convoy',
  Finance: 'Capital',
  Marketing: 'Campaign',
};

export function workspaceLabel(workspace: string): string {
  return workspaceLabels[workspace] ?? workspace;
}
