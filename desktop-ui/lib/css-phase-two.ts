// Add only a reviewed workspace; each activation is a separate commit/deploy.
export const cssPhaseTwoWorkspaces = new Set<string>(['Command', 'Schedule', 'Fleet']);
