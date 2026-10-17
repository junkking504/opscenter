/** An estimate exception belongs to the actual reviewed closeout outcome, never
 * a client skip-photo flag or the appointment's previous category alone. */
export function isEstimateCloseoutOutcome(values:Record<string,unknown>):boolean {
 if(values.targetStatus!=='8' || values.appointmentType!=='Estimate')return false;
 const outcome=values.estimateOutcome as Record<string,unknown>|undefined;
 if(!outcome || typeof outcome!=='object' || Array.isArray(outcome)
  || !['Price/Budget','Date/Time','Other'].includes(String(outcome.reason))
  || typeof outcome.explanation!=='string' || !outcome.explanation.trim() || outcome.explanation.length>2000)return false;
 const discounted=Number(String(values.discount ?? '').replace(/[$,\s]/g,''))>0;
 return discounted || (typeof outcome.noDiscountReason==='string' && Boolean(outcome.noDiscountReason.trim()) && outcome.noDiscountReason.length<=2000);
}
