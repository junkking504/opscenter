'use client';

import './layers.css';
import './astryx.css';
import { useSyncExternalStore, type ReactNode } from 'react';
import { Theme } from '@astryxdesign/core/theme';
import { opscenterBrandTheme } from '../../themes/opscenter/opscenter-brand.js';

function subscribe(onChange: () => void) {
  window.addEventListener('ops-theme-change', onChange);
  return () => window.removeEventListener('ops-theme-change', onChange);
}
function currentMode(): 'light' | 'dark' {
  return document.documentElement.dataset.opsTheme === 'dark' ? 'dark' : 'light';
}
const serverMode = () => 'light' as const;

/** Use the application's theme setting; Waypoint intentionally remains light. */
export function BrandTheme({ children, waypoint = false }: { children: ReactNode; waypoint?: boolean }) {
  const mode = useSyncExternalStore(subscribe, currentMode, serverMode);
  return <Theme theme={opscenterBrandTheme} mode={waypoint ? 'light' : mode}>{children}</Theme>;
}
