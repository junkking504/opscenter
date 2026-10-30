/** Recognize only source states and the known schedule duration suffix. Arbitrary
 * trailing notes (including negation/reopening) never become completion evidence. */
export function truckSwitchStatus(value: unknown): 'confirmed' | 'completed' | 'cancelled' | null {
 if(typeof value!=='string')return null;
 const match=/^(confirmed|completed|cancelled|canceled)(?: Duration: \d+(?:\.\d+)? min\(s\))?$/i.exec(value.trim().replace(/\s+/g,' '));
 if(!match)return null;
 const status=match[1].toLowerCase();
 return status==='canceled'?'cancelled':status as 'confirmed'|'completed'|'cancelled';
}
