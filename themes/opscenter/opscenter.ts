import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral/built';

// Preserve the product's system typography and red brand across both clients.
export const opscenterTheme = defineTheme({
  name: 'opscenter-brand',
  extends: neutralTheme,
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: { family: '-apple-system', fallbacks: 'BlinkMacSystemFont, "SF Pro Text", "Segoe UI", sans-serif' },
    heading: { family: '-apple-system', fallbacks: 'BlinkMacSystemFont, "SF Pro Display", "Segoe UI", sans-serif' },
  },
  tokens: {
    '--color-accent': '#b51935',
    '--color-on-accent': '#ffffff',
    '--color-accent-muted': ['#fbecef', '#3b2029'],
    '--color-text-accent': ['#b51935', '#ff91a4'],
    '--color-icon-accent': ['#b51935', '#ff91a4'],
  },
  components: { button: { base: { borderRadius: '7px' } } },
  adaptations: { rules: [{ when: { pointer: 'coarse' }, value: { tokens: {
    '--size-element-sm': '44px', '--size-element-md': '44px', '--size-element-lg': '48px',
  } } }] },
});
