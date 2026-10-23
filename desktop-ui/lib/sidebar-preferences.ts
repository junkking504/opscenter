const key = 'opscenter-sidebar-collapsed-v1';
export function readSidebarCollapsed(): boolean {
  try { return localStorage.getItem(key) === 'true'; } catch { return false; }
}
export function saveSidebarCollapsed(collapsed: boolean): void {
  try { localStorage.setItem(key, String(collapsed)); } catch { /* Current-session toggle still works. */ }
}
