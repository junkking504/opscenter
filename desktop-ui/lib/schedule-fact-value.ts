import type {ReactNode} from 'react';
import {truckDisplayText} from '../../lib/junkware-trucks';

/** Preserve contact links and other React nodes; only format textual facts. */
export function scheduleFactValue<T extends ReactNode>(value: T): T | string {
  if (value == null || value === '' || typeof value === 'boolean') return 'Unavailable';
  return typeof value === 'string' ? truckDisplayText(value) : value;
}
