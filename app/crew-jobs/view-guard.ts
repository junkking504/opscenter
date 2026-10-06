/** Async list/session responses cannot replace an active editor or newer view. */
export function createWaypointViewGuard() {
  const flags={details:false,busy:false,switching:false,editingCrew:false};
  let generation=0,deferred=false,appointmentId:string|null=null;
  const blocked=()=>Object.values(flags).some(Boolean);
  return {
    blocked,
    set(kind:keyof typeof flags,value:boolean){if(flags[kind]!==value){flags[kind]=value;generation++;}},
    select(value:string|null){appointmentId=value;generation++;},
    selected:()=>appointmentId,
    version:()=>generation,
    current:(version:number)=>version===generation && !blocked(),
    defer(){deferred=true;},
    takeRefresh(){if(!deferred || blocked())return false;deferred=false;return true;},
  };
}
