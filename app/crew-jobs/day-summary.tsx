import { truckDisplayText } from '../../lib/junkware-trucks';
import type {WaypointDaySummary} from '@/lib/waypoint-day-summary';
import {mapsDirections} from '@/lib/waypoint-day-summary';
import styles from './phone-access.module.css';
const money=(value:number|null)=>value===null?'Pending':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value);
export function AddressLink({address}:{address:string}){const href=mapsDirections(address);return href?<a className={styles.mapLink} href={href} target="_blank" rel="noopener noreferrer">{address}<small>Open Google Maps ↗</small></a>:<span>{address || 'Address unavailable'}</span>;}
export default function DaySummary({summary:s}:{summary:WaypointDaySummary}){
 const bonus=s.crew.length && s.crew.every(person=>person.bonus!==null)?s.crew.reduce((sum,person)=>sum+person.bonus!,0):null;
 return <section aria-label="Today’s performance" className={styles.card}>
  <h2>{truckDisplayText(s.truck)} · Today{ s.test?' · Test':''}</h2>
  <div className={styles.stats}><div><span>Truck revenue</span><strong>{money(s.revenue)}</strong></div><div><span>Truck tips</span><strong>{money(s.tips)}</strong></div><div><span>Crew revenue bonuses</span><strong>{money(bonus)}</strong></div><div><span>Closed in totals</span><strong>{s.completed?.length ?? 'Pending'}</strong></div></div>
  <p className={styles.muted}>{s.message} {s.observedAt && <>As of {new Date(s.observedAt).toLocaleTimeString('en-US',{timeZone:'America/Chicago',hour:'numeric',minute:'2-digit'})} Central.</>}</p>
  <h2>Next bonus tier</h2>
  <p className={styles.muted}>Based on each person’s credited revenue today, including work on other trucks. Highest tier earned; bonuses do not stack.</p>
  {s.crew.map(person=><div className={styles.bonusPerson} key={person.name}><h3>{person.name}</h3><p>{money(person.revenue)} credited · {money(person.tips)} tips · {money(person.bonus)} revenue bonus</p>{person.progress?.next?<><strong>{money(person.progress.next.remaining)} to your next tier</strong><p>Reach {money(person.progress.next.revenue)} credited revenue for a {money(person.progress.next.bonus)} bonus.</p><progress aria-label={`${person.name} bonus progress`} value={Math.max(0,person.revenue || 0)} max={person.progress.next.revenue}/></>:person.progress?<strong>Top tier reached · {money(person.progress.bonus)} bonus</strong>:<p className={styles.muted}>Bonus progress pending office confirmation.</p>}</div>)}
  <h2>Closeouts included in totals</h2>
  {!s.test && <p className={styles.muted}>Totals can update after assignment status. Check the assignment’s saved closeout for its latest result.</p>}
  {s.completed===null?<p>Reported closeouts are unavailable.</p>:s.completed.length?<ul className={styles.list}>{s.completed.map(job=><li key={job.id}><strong>{job.customer}</strong><span>{job.reference} · {job.type}{job.time?` · ${job.time}`:''}</span><AddressLink address={job.address}/><span>{money(job.revenue)} revenue · {money(job.tips)} tips</span></li>)}</ul>:<p>No closeouts are included in these totals yet.</p>}
 </section>;
}
