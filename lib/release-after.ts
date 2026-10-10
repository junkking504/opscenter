import { after } from 'next/server';
import { registerBackground } from './release-background';

/** Preserve Next request context and error handling; count from registration. */
export function trackedAfter(callback: () => unknown) {
  registerBackground(after, callback);
}
