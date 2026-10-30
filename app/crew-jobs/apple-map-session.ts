import type {MapKit} from '../../desktop-ui/lib/apple-mapkit';
import type {WaypointMapAppointment} from '@/lib/waypoint-map';

/** Build the Apple map for located appointments. Returns a cleanup that is safe at every point of
 * setup: whatever was created is torn down even if a later step throws, and the map is always
 * destroyed. A setup failure tears down first, then reports so the caller can fall back. */
export function startAppleMap(kit:MapKit,host:HTMLElement,located:WaypointMapAppointment[],options:{makeElement:(group:WaypointMapAppointment[])=>HTMLElement;onFailure:()=>void}):()=>void {
 let instance:InstanceType<MapKit['Map']>|undefined,observer:ResizeObserver|undefined,done=false;
 const items:unknown[]=[];
 const fail=()=>{cleanup();options.onFailure();};
 function cleanup(){
  if(done)return;done=true;
  try{kit.removeEventListener('error',fail);}catch{/* Listener already gone. */}
  try{observer?.disconnect();}catch{/* Observer already gone. */}
  for(const item of items){try{instance?.removeAnnotation(item as never);}catch{/* Keep tearing down. */}}
  try{instance?.destroy();}catch{/* Nothing left to release. */}
 }
 try{
  instance=new kit.Map(host,{showsZoomControl:true,showsMapTypeControl:false,showsUserLocationControl:false,isRotationEnabled:false,isZoomEnabled:true,isScrollEnabled:true});
  kit.addEventListener('error',fail);
  const groups=new Map<string,WaypointMapAppointment[]>();
  for(const stop of located){const p=stop.location!;const key=`${p.latitude},${p.longitude}`;groups.set(key,[...(groups.get(key)||[]),stop]);}
  for(const group of groups.values()){
   const p=group[0].location!,element=options.makeElement(group);
   const annotation=new kit.Annotation(new kit.Coordinate(p.latitude,p.longitude),()=>element,{animates:false,enabled:true,calloutEnabled:false,displayPriority:1000});
   items.push(annotation);instance.addAnnotation(annotation);
  }
  const lat=located.map(stop=>stop.location!.latitude),lon=located.map(stop=>stop.location!.longitude);
  const south=Math.min(...lat),north=Math.max(...lat),west=Math.min(...lon),east=Math.max(...lon);
  const fit=()=>{
   if(done||!instance)return;
   instance.region=new kit.CoordinateRegion(new kit.Coordinate((south+north)/2,(west+east)/2),new kit.CoordinateSpan(Math.max((north-south)*1.4,0.01),Math.max((east-west)*1.4,0.01)));
  };
  fit();
  observer=new ResizeObserver(()=>{try{fit();}catch{fail();}});observer.observe(host);
 }catch{fail();}
 return cleanup;
}
