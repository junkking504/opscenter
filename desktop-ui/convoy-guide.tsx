import { BookOpen, ArrowRight } from 'lucide-react';
import type { FleetView } from './lib/people-fleet-contract';
const steps: Array<{view:FleetView;title:string;description:string}> = [
  {view:'overview',title:'1. Check the fleet',description:'Start with out-of-service trucks and items needing attention. Open a truck for its details.'},
  {view:'maintenance',title:'2. Handle problems',description:'Review today’s inspections. Report a problem, update repair progress, then record the resolution.'},
  {view:'service',title:'3. Plan maintenance',description:'Check what is due, set recurring intervals, and schedule a shop visit. Record service only when work is done.'},
  {view:'reports',title:'4. Find past work',description:'Search all repairs, service records, and invoices. Open a record to see the work and original photos.'},
  {view:'scores',title:'5. Review driving',description:'Choose a truck to see the selected day’s score and the events behind it.'},
];
const guidance: Record<FleetView,string> = {
  overview:'Start here each day: check truck availability, open repairs, and maintenance priorities.',
  maintenance:'Review inspections for the viewing day and manage repairs until they are resolved.',
  service:'Plan upcoming work. A scheduled visit stays pending until its completion is recorded.',
  reports:'Find work already recorded. The list starts with all dates, regardless of the viewing day above.',
  scores:'Review driving for the viewing day. Open a truck to see its score, events, and available coverage.',
};
export function ConvoyGuide({view,date,onView}: {view:FleetView;date:string;onView?: (view:FleetView)=>void}) {
  return <div className="convoy-orientation"><p>{guidance[view]}</p><details className="convoy-guide"><summary><BookOpen size={16}/>How to use Convoy</summary><div className="convoy-guide-steps">{steps.map(step=><button key={step.view} onClick={()=>onView?.(step.view)}><strong>{step.title}<ArrowRight size={15}/></strong><span>{step.description}</span></button>)}</div><p><strong>Viewing day: {date}.</strong> It controls inspections, driving, and the maintenance plan. Records & invoices has its own date filters. Mileage always shows the latest available reading; “Needs verification” means check the truck’s odometer before relying on it.</p><p><strong>After saving:</strong> wait for the saved confirmation. Use Check Saved Result if a save cannot be confirmed.</p></details></div>;
}
