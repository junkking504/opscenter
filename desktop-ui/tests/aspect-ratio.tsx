import {createRoot} from 'react-dom/client';
import Home from '../app/page';
import {fixtureSnapshot, job} from '../../scripts/fixtures/crew-progress';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
const date='2026-09-12', stamp=new Date().toISOString();
const command=fixtureSnapshot();command.date=date;command.actor={displayName:'Synthetic operator',role:'Administrator'};
const loads=Array.from({length:9},(_,i)=>({truck:`Truck ${i+1}`,label:i===8?'Empty · provisional':i===6?'Load unknown':i===0?'Full truck':'1/3 full',percent:33,note:'Synthetic load',needsVerification:i===8}));
const scheduleJobs=Array.from({length:18},(_,i)=>{const truck=i<3?'Truck 4':i<7?'Truck 6':i<11?'Truck 9':'Unassigned';const start=i<11?480+(i%3)*60:660;return {...job(),recordId:`${date}:appointment:${1001+i}`,appointmentId:String(1001+i),jkNumber:`JK100${1001+i}`,version:'a'.repeat(64),truck,status:i===1||i===5||i===9?'On Site':'Confirmed',customerName:`Synthetic customer ${i+1}`,appointmentStartMinutes:start,appointmentEndMinutes:start+60,appointmentTime:'9 AM–10 AM',location:null,appointmentNotes:[]};});
const legs=['Truck 4','Truck 6','Truck 9'].flatMap(truck=>{const rows=scheduleJobs.filter(j=>j.truck===truck);return rows.slice(1).map((row,i)=>({truck,fromAppointmentId:rows[i].recordId,toAppointmentId:row.recordId,fromJk:rows[i].jkNumber,toJk:row.jkNumber,fromEndMinutes:rows[i].appointmentEndMinutes,toStartMinutes:row.appointmentStartMinutes,gapMinutes:0,travelMinutes:18,miles:7,status:'available'}));});
const amounts={hours:4,regularHours:4,overtimeHours:0,jobs:2,revenue:640,labor:80,tips:10,bonuses:5,supplemental:0,totalPay:95};
const members=Array.from({length:8},(_,i)=>({...amounts,id:`crew-${i}`,name:`Synthetic Crew Member ${i+1}`,initials:'SC',role:'Driver',truck:`Truck ${i+1}`,working:true,clockIn:'8:00 AM',clockOut:'',hourlyRate:20,status:'Clocked in',issue:'',version:'a',correction:null,days:[{...amounts,date,clockIn:'8:00 AM',clockOut:''}]}));
const trucks=loads.map((load,i)=>({id:String(i+1),label:load.truck,vehicle:'Isuzu NPR',readiness:'ready',operatingStatus:'Parked',driver:'Synthetic driver',navigator:'Synthetic navigator',assignment:'Example territory',location:'Synthetic location',gpsAt:stamp,speed:0,ignition:'OFF',gpsFreshness:'Recent',odometer:'120,000 mi',serviceStatus:'Available',nextService:'Oil and filter',checklist:'Complete',loadPercent:33,loadLabel:load.label,loadNote:'Synthetic',loadVersion:'a',checklistVersion:'a',checklists:{},checklistDefinitions:[],answers:[],jobs:2,revenue:640,miles:45,idleMinutes:8,driverScore:90}));
const leads=Array.from({length:12},(_,i)=>({id:String(i),version:'a',customer:`Synthetic customer ${i}`,phone:'504-555-0100',territory:'New Orleans',intent:'Furniture and household items from a garage cleanout',quotedValue:450,status:'Open',reason:'Follow-up requested',note:'Synthetic record',contacted:false,calledAt:stamp,updatedAt:stamp,source:'SearchKings',sourceUrl:'',appointmentId:null,jk:null,completed:false,revenue:0}));
const commandMap = new URLSearchParams(location.search).has('commandMap');
const mapTrucks = [2,3,4,6,8,9].map((truck,index)=>({truck:`Truck ${truck}`,latitude:29.94+index*.09,longitude:-90.05-index*.15,lastGpsUpdate:stamp,speed:0,ignition:'OFF',operationalStatus:'Parked',driver:'Synthetic driver',navigator:'Synthetic navigator'}));
if(commandMap) {
  command.kpis = ['Today’s jobs','Revenue','Labor','Revenue Per Hour (RPH)','Average Job Size (AJS)'].map(label=>({label,value:label==='Today’s jobs'?'18':'$450.00',detail:'Synthetic metric',progress:50,tone:'healthy'}));
  if(command.crewProgress) command.crewProgress.jobs.forEach(row=>{row.updateIds=row.updateIds.flatMap(id=>Array.from({length:5},(_,index)=>`${id}-${index}`));});
  scheduleJobs.forEach((row,index)=>Object.assign(row,{location:{latitude:29.92+(index%6)*.07,longitude:-90.02-Math.floor(index/6)*.18}}));
  command.alerts = Array.from({length:5},(_,index)=>command.alerts.map(row=>({...row,id:`${row.id}-${index}`}))).flat();
}
// Synthetic API data only; every write is blocked.
window.fetch=async(input,init)=>{
 if(init?.method && init.method!=='GET')return Response.json({error:'Read-only fixture'},{status:403});
 const url=new URL(String(input),location.origin), selected=url.searchParams.get('date')||date;
 const snapshots:Record<string,unknown>={
 schedule:{date:selected,observedAt:stamp,appointments:scheduleJobs,truckLoads:loads,fleet:{isToday:true,lastUpdatedAt:stamp,trucks:commandMap?mapTrucks:[]}},
 krewe:{date,start:date,end:date,view:'today',sourceUpdatedAt:stamp,missingDates:[],payrollVisible:true,canWrite:false,members,totals:amounts,callIn:null},
 fleet:{date,report:'overview',sourceUpdatedAt:stamp,sourceAvailable:true,canWrite:false,trucks,issues:[],maintenance:[],reportRows:[],reportCoverageDays:1,warnings:[]},
 marketing:{date,range:'month',fetchedAt:stamp,available:true,error:null,canAssignReviews:false,leads,reviews:[],reviewAvailable:true,reviewFetchedAt:stamp,reviewError:null,totals:{calls:40,qualified:30,bookings:20,revenue:9000,cost:600,completed:12},sources:[{source:'SearchKings',calls:40,qualified:30,bookings:20,completed:12,revenue:9000,cost:600}],jobChange:'Synthetic'},
 finance:{date,available:true,generatedAt:stamp,daily:{revenue:1800,costs:900,profit:900,recyclingIncome:50},month:{label:'September',through:date,complete:false,missingDates:[],revenue:18000,jobs:60,costs:9000,profit:9000,source:'Synthetic'},territories:[{territory:'New Orleans',jobs:60,revenue:18000}],costs:[{category:'Labor',amount:9000,source:'Synthetic'}],trends:[],reconciliation:{status:'ready',generatedAt:stamp,merchantCenterAvailable:false,merchantCenterFresh:false,summary:{junkware_count:0,junkware_total:0,merchant_center_total:0,matched_count:0,net_difference:0,exception_count:0},paymentsByJob:[],exceptions:[]},resale:[],resaleUpdatedAt:stamp,recycling:[],recyclingVersion:'a',recyclingIncomeRows:[]}};
 if(url.pathname==='/api/desktop/schedule/routes')return Response.json({date:selected,calculatedAt:stamp,legs,closest:[],appointmentId:null});
 const data=snapshots[url.pathname.replace('/api/desktop/','')];return data?Response.json(data):Response.json({error:'Source disabled in synthetic fixture'},{status:503});
};
class NoEvents {addEventListener(){}close(){}}
window.EventSource=NoEvents as unknown as typeof EventSource;
createRoot(document.getElementById('root')!).render(<Home live={{snapshot:command,pendingAlertId:null,error:'',onDateChange:()=>{},onAlertAction:async()=>{}}}/>);
