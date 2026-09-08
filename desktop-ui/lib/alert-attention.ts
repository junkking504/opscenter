export function requiresAlertAttention(alert?: {needsAction?: boolean; workflowState?: string}): boolean {
  return Boolean(alert && !['acknowledged','resolved'].includes(alert.workflowState || '') && (alert.needsAction || alert.workflowState === 'in-control'));
}
