import assert from 'node:assert/strict';
import {chromium,expect} from '@playwright/test';
import {closeoutPhotoEvidence} from '../lib/closeout-photo-policy';
const field = (value: string, label: string, options = [{ value, label }]) => ({ value, label, options });
const sizes = ['', 'Dry Run', 'Bag(s)', 'Minimum', '.5 (1/12)', '1 (1/6)', '1.5 (1/4)', '2 (1/3)', '2.5 (3/8)', '3 (1/2)', '3.5 (5/8)', '4 (2/3)', '4.5 (3/4)', '5 (5/6)', '5.5 (7/8)'];
const hours = Array.from({length:24}, (_,index)=>({value:String(index),label:`${index%12 || 12} ${index>=12?'PM':'AM'}`}));
const minutes = Array.from({length:12}, (_,index)=>({value:String(index*5).padStart(2,'0'),label:String(index*5).padStart(2,'0')}));
const fixture = {
  truck:'Truck 6',truckOptions:[{value:'6',label:'Truck 6'}],status:field('1','Confirmed'),appointmentType:field('2','Job'),
  driver:{value:'driver',label:'Sample Driver'},drivers:[{value:'driver',label:'Sample Driver'}],navigators:[{value:'navigator',label:'Sample Navigator'}],navigatorOptions:[{value:'',label:'Choose navigator'},{value:'navigator',label:'Sample Navigator'},{value:'extra',label:'Extra Crew'}],
  loadQuantity:'0',loadSize:field('3 (1/2)','3 (1/2)',sizes.map(value=>({value,label:value}))),loadPrices:[40,100,150,200,250,300,350,400,450,500,550,600,650,700],dryRunFee:'75',loadPrice:'400',
  bedloadQuantity:'',bedloadSize:field('','None'),bedloadPrices:[],bedloadPrice:'',otherChargeOptions:[{value:'',label:'Choose charge'}],otherCharges:[],discount:'',tip:'',
  howHeard:field('ref','Referral'),jobCategory:field('house','Household'),actualStartHour:field('10','10 AM',hours),actualStartMinute:field('00','00',minutes),actualEndHour:field('11','11 AM',hours),actualEndMinute:field('00','00',minutes),
  paymentMethods:[{value:'1',label:'Billed'},{value:'2',label:'Cash'},{value:'3',label:'Credit Card'},{value:'4',label:'Check'}],payments:[],balance:'400.00',total:'$400.00',
};

async function main(){
 const browser=await chromium.launch({headless:true});
 try {for(const width of [320,390,430]){
  const context=await browser.newContext({viewport:{width,height:844},ignoreHTTPSErrors:true}),page=await context.newPage();
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  let posts=0,receipt:any=null,sourceVersion='a'.repeat(64),photos=true,receiptReads=0,completed=false,managerChanged=false,closeoutResponded=false;
  const closeout=()=>({...fixture,actualStartMinute:managerChanged?field('05','05',minutes):fixture.actualStartMinute,photoEvidence:closeoutPhotoEvidence('900001',photos?['https://junkware.junk-king.com/system/aspnet/local/media/sample-900001-before.jpg']:[])});
  await page.route('**/api/**',async route=>{
   const r=route.request(),u=new URL(r.url());const send=(body:unknown)=>route.fulfill({contentType:'application/json',body:JSON.stringify(body)});
   if(u.pathname==='/api/crew-jobs/session')return send({phone:{deviceId:'sample-phone',truck:'Truck 6',label:'Sample phone'}});
   if(u.pathname==='/api/crew-jobs/day')return send({date:'2026-09-18',phone:{deviceId:'sample-phone',truck:'Truck 6',label:'Sample phone'},day:{date:'2026-09-18',version:1,responsible:'Sample Driver',driver:'Sample Driver',navigators:['Sample Navigator'],truck:'Truck 6'},inspection:{status:'ready'},trucks:['Truck 6'],roster:['Sample Driver','Sample Navigator','Extra Crew']});
   if(u.pathname==='/api/crew-jobs/current'){
    const job=completed?{assignmentId:'next-assignment',appointmentId:'900002',date:'2026-09-18',jkNumber:'SAMPLE-02',customerName:'Next Sample Customer',address:'200 Sample Street',appointmentTime:'12–2 PM',junkItems:['Second job'],appointmentNotes:[],driver:'Sample Driver',navigator:'Sample Navigator'}:{assignmentId:'sample-assignment',appointmentId:'900001',date:'2026-09-18',jkNumber:'SAMPLE-01',customerName:'Sample Customer',address:'100 Sample Street',appointmentTime:'10 AM–12 PM',junkItems:[],appointmentNotes:[],driver:'Sample Driver',navigator:'Sample Navigator'};
    return send({state:'assigned',truck:'Truck 6',job,jobs:[{...job,status:'Confirmed'},{...job,assignmentId:undefined,appointmentId:'900003',jkNumber:'SAMPLE-03',customerName:'Later Sample Customer',address:'300 Sample Street',appointmentNotes:['Use the side gate'],status:'Confirmed'},...(completed?[{...job,assignmentId:undefined,appointmentId:'900001',jkNumber:'SAMPLE-01',customerName:'Closed Sample Estimate',status:'Completed',appointmentType:'Estimate',closedTotal:568,estimateOutcomes:['Other: Training only, no discount: internal test']}]:[])]});
   }
   if(u.pathname==='/api/crew-jobs/photos')return send({photos:[]});
   if(u.pathname==='/api/crew-jobs/closeout'){
    if(r.method()==='POST'){
     posts++;const b=r.postDataJSON();assert.equal(b.assignmentId,'sample-assignment');assert.equal(b.values.truck,'Truck 6');assert.equal(b.values.targetStatus,'8');assert.equal(b.crewVersion,1);assert.equal(b.values.driverId,'driver');assert.deepEqual(b.values.navigatorIds,['navigator','extra']);assert.deepEqual(b.values.addPayment,{methodId:'3',amount:'400',reference:'1234'});
     assert.deepEqual(b.photoRequestIds,[]);receipt={requestId:b.requestId,action:'closeout',status:'pending',message:'Source verification in progress.'};
     await new Promise(resolve=>setTimeout(resolve,600));closeoutResponded=true;
     return send({receipt});
    }
    if(u.searchParams.has('requestId')){receiptReads++;if(receiptReads>=2){completed=true;receipt={requestId:receipt.requestId,action:'closeout',status:'verified',message:'Saved and verified in JunkWare.',sourceResult:{appointmentId:'900001',closeout:{...closeout(),status:{value:'8',label:'Completed'}}}};}return send({receipt});}
    return send({crewVersion:1,crewDefaults:{version:1,driver:fixture.driver,navigators:fixture.navigators},closeout:closeout(),sourceVersion,jobVersion:'sample-version',canWrite:true});
   }
   throw new Error(`Unexpected API ${r.method()} ${u.pathname}`);
  });
  const open=async()=>{await expect(page.getByRole('heading',{name:'Later Sample Customer',exact:true})).toBeVisible();await page.getByRole('button',{name:'View assignment',exact:true}).first().click();await page.getByRole('button',{name:'Start closeout · Before photos',exact:true}).click();};
  await page.goto(`${process.argv[2] || 'http://127.0.0.1:3189'}/crew-jobs`);await open();const photoInput=page.getByLabel('Add before photos',{exact:true});await expect(photoInput).toBeEnabled();assert.equal(await photoInput.evaluate(element=>getComputedStyle(element).opacity),'0','Native file control is visually replaced by the compact picker');const pickerBox=await photoInput.locator('..').boundingBox();assert.ok(pickerBox && pickerBox.height<=120,'Photo picker stays compact');if(width===390)await page.screenshot({path:'/tmp/waypoint-closeout-before.png',fullPage:true});
  await expect(page.getByRole('radio',{name:'Cancelled',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Continue to charges',exact:true}).click();await expect(page.getByRole('radio',{name:'Completed',exact:true})).toHaveCount(0);await expect(page.getByText('Truck# 6 · Sample Driver (driver) · Sample Navigator (navigator)',{exact:true})).toBeVisible();await expect(page.getByRole('combobox',{name:'Driver',exact:true})).toHaveCount(0);await expect(page.getByLabel('Actual start hour')).toHaveCount(0);await page.getByRole('button',{name:'Continue to after photos',exact:true}).click();await page.getByRole('button',{name:'Continue to payment',exact:true}).click();
  await page.getByLabel('Record a collected payment',{exact:true}).check();await page.getByRole('radio',{name:'Credit Card',exact:true}).check();
  await expect(page.getByRole('radio',{name:'Billed',exact:true})).toHaveCount(0);
  await page.getByLabel('Payment amount',{exact:true}).fill('400');await page.getByLabel('Card last four',{exact:false}).fill('1234');
  await page.reload();await open();await expect(page.getByLabel('Payment amount',{exact:true})).toHaveValue('400');await expect(page.getByText('Draft restored against the current JunkWare record. Review before saving.')).toBeVisible();
  sourceVersion='b'.repeat(64);managerChanged=true;await page.reload();await open();await page.getByRole('button',{name:'Continue to charges',exact:true}).click();await page.getByRole('button',{name:'+ Add additional crew',exact:true}).click();await page.getByRole('combobox',{name:'Additional crew 1',exact:true}).selectOption('extra');await page.getByRole('button',{name:'Continue to after photos',exact:true}).click();await page.getByRole('button',{name:'Continue to payment',exact:true}).click();await expect(page.getByLabel('Record a collected payment',{exact:true})).not.toBeChecked();
  await page.getByLabel('Record a collected payment',{exact:true}).check();await page.getByRole('radio',{name:'Credit Card',exact:true}).check();await page.getByLabel('Payment amount',{exact:true}).fill('400');await page.getByLabel('Card last four',{exact:false}).fill('1234');
  await page.getByRole('button',{name:'Review Closeout',exact:true}).click();await expect(page.getByRole('button',{name:'Submit checkout',exact:true})).toBeVisible();
  await page.screenshot({path:`/tmp/crew-closeout-${width}.png`,fullPage:true});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,`No overflow ${width}`);
  if(width===390)await page.screenshot({path:'/tmp/crew-closeout-review.png',fullPage:true});
  const started=Date.now();await page.getByRole('button',{name:'Submit checkout',exact:true}).click();await expect(page.getByRole('heading',{name:'Assignments',exact:true})).toBeVisible();assert.equal(closeoutResponded,false,'Assignments returns before the closeout request finishes');assert.ok(Date.now()-started<2000,'Submit returns to Assignments without waiting for JunkWare');await expect(page.getByText('Checkout is finishing in the background.',{exact:false})).toBeVisible();assert.equal(closeoutResponded,true);assert.equal(posts,1);
  await page.getByRole('button',{name:'View assignment',exact:true}).last().click();await expect(page.getByText('Use the side gate',{exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Start closeout · Before photos',exact:true})).toHaveCount(0);await page.getByRole('button',{name:'Back to Assignments',exact:true}).click();
  await expect(page.getByRole('heading',{name:'Next Sample Customer',exact:true})).toBeVisible({timeout:10_000});assert.equal(posts,1);assert.deepEqual(errors,[]);
  await expect(page.getByText('Closed as estimate · $568.00',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'View assignment',exact:true}).last().click();
  await expect(page.getByText('Other: Training only, no discount: internal test',{exact:true})).toBeVisible();
  await expect(page.getByRole('button',{name:'Start closeout · Before photos',exact:true})).toHaveCount(0);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  if(width===390)await page.screenshot({path:'/tmp/waypoint-closed-estimate.png',fullPage:true});
  await context.close();console.log(`PASS ${width}px: compact mobile review, one-click durable queue, immediate Assignments return, background receipt polling, automatic next assignment, one payment write, no overflow.`);
 }}finally{await browser.close();}
}
void main().catch(e=>{console.error(e);process.exitCode=1;});
