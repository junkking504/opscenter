export function operationalUpdateGaps(slack:{status:string;complete?:boolean;detail?:string},geofence:{available:boolean;complete:boolean;sourceHealth?:{alerts:string}}):string[] {
  const reasons:string[]=[];
  if(slack.status!=='ready') reasons.push(slack.detail?`Slack: ${slack.detail}`:'Slack history is unavailable; coverage is unknown.');
  else if(slack.complete!==true) reasons.push(slack.detail?`Slack: ${slack.detail}`:slack.complete===false?'Slack history is incomplete; the reason is unavailable.':'Slack history completeness is unknown.');
  if(!geofence.complete) {
    const state=geofence.sourceHealth?.alerts;
    reasons.push(!geofence.available?'LinxUp alert history is missing; coverage is unknown.':state==='failed'?'LinxUp alert collection or validation failed.':state==='stale'?'LinxUp alert history is stale.':'LinxUp alert history completeness is unverified.');
  }
  return reasons;
}
