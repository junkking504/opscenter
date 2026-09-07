import {readDesktopKrewe} from './desktop-krewe';
import {payrollCorrectionsForDate} from './payroll-corrections';
import {normalizeInteractiveOpsRole,opsRoleCan} from './ops-roles';

export function readCommandCrewCorrections(date:string, actorRole:unknown) {
  const role=normalizeInteractiveOpsRole(/^administrator$/i.test(String(actorRole))?'admin':actorRole);
  if (!opsRoleCan(role,'finance.read') || !Object.keys(payrollCorrectionsForDate(date)).length) return undefined;
  return {date,members:readDesktopKrewe(date,'today',role).members};
}
