import { CrewPhoneError } from './crew-phone';

export const WAYPOINT_MANAGER_RESOURCES = {
 operations:{path:'/api/desktop/schedule/operations',methods:['GET','POST']},
 creation:{path:'/api/desktop/schedule/creation',methods:['GET','POST']},
 'creation-check':{path:'/api/desktop/schedule/creation/check',methods:['POST']},
 customers:{path:'/api/desktop/schedule/customers',methods:['POST']},
 order:{path:'/api/desktop/schedule/order',methods:['POST']},
 edit:{path:'/api/desktop/schedule/closeout',methods:['GET']},
 phones:{path:'/api/crew-phones',methods:['GET','POST']},
 dispatch:{path:'/api/crew-dispatch',methods:['GET','POST']},
} as const;
export type WaypointManagerResource=keyof typeof WAYPOINT_MANAGER_RESOURCES;
export function validateManagerResource(resource:string,method:string,body?:Record<string,unknown>):WaypointManagerResource {
 if(!Object.hasOwn(WAYPOINT_MANAGER_RESOURCES,resource))throw new CrewPhoneError('Unknown Waypoint manager action.',404);
 const key=resource as WaypointManagerResource;
 if(!(WAYPOINT_MANAGER_RESOURCES[key].methods as readonly string[]).includes(method))throw new CrewPhoneError('Method not allowed.',405);
 if(method==='POST'){
  if(!body)throw new CrewPhoneError('Review the manager action first.');
  if(key==='operations'){
   if(!['move','reschedule','restore','call_ahead','cancel','note','classify','closeout'].includes(String(body.action)))throw new CrewPhoneError('Use the photo-protected crew workflow for closeout and collected payments.',403);
   if(body.action==='closeout'){const values=body.values as Record<string,unknown>|undefined;if(!values || values.targetStatus!=='1' || values.addPayment!=null || values.application!==undefined || values.requirePhotos!==undefined)throw new CrewPhoneError('Use the photo-protected crew workflow for closeout and collected payments.',403);}
   if(body.action==='classify' && (body.values as Record<string,unknown>)?.completeEstimate)throw new CrewPhoneError('Complete estimates through the photo-protected crew workflow.',403);
  }
  if(key==='phones' && !['enroll','authorize-live','revoke'].includes(String(body.action)))throw new CrewPhoneError('Use the existing phone setup screen to request a code.',403);
  // Manual order changes are local; route suggestions retain their separate
  // provider/spending boundaries and are not added by this manager grant.
  if(key==='order' && body.action!=='save')throw new CrewPhoneError('Review and save a manual stop order.',403);
 }
 return key;
}
