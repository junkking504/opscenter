const key = 'opscenter-workspace-preferences-v1';
export const openingWorkspaces = ['Command', 'Schedule', 'Krewe', 'Fleet', 'Finance', 'Marketing'] as const;
export function readOpeningWorkspace(canFinance: boolean): string {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}').openingWorkspace;
    return openingWorkspaces.includes(value) && (value !== 'Finance' || canFinance) ? value : 'Command';
  } catch { return 'Command'; }
}
export function saveOpeningWorkspace(value: string): boolean {
  if (!openingWorkspaces.includes(value as typeof openingWorkspaces[number])) return false;
  try { localStorage.setItem(key, JSON.stringify({ openingWorkspace: value })); return true; }
  catch { return false; }
}
