export const field = (value: string, label: string, options = [{ value, label }]) => ({ value, label, options });
const sizes = ['', 'Dry Run', 'Bag(s)', 'Minimum', '.5 (1/12)', '1 (1/6)', '1.5 (1/4)', '2 (1/3)', '2.5 (3/8)', '3 (1/2)', '3.5 (5/8)', '4 (2/3)', '4.5 (3/4)', '5 (5/6)', '5.5 (7/8)'];
const hours = Array.from({length:24}, (_,index)=>({value:String(index),label:`${index%12 || 12} ${index>=12?'PM':'AM'}`}));
export const minutes = Array.from({length:12}, (_,index)=>({value:String(index*5).padStart(2,'0'),label:String(index*5).padStart(2,'0')}));
export const savedChargeId='11111111-1111-4111-8111-111111111111';
export const fixture = {
  truck:'Truck 6',truckOptions:[{value:'6',label:'Truck 6'}],status:field('1','Confirmed'),appointmentType:field('2','Job'),
  driver:{value:'driver',label:'Sample Driver'},drivers:[{value:'driver',label:'Sample Driver'}],navigators:[{value:'navigator',label:'Sample Navigator'}],navigatorOptions:[{value:'',label:'Choose navigator'},{value:'navigator',label:'Sample Navigator'},{value:'extra',label:'Extra Crew'}],
  loadQuantity:'0',loadSize:field('3 (1/2)','3 (1/2)',sizes.map(value=>({value,label:value}))),loadPrices:[40,100,150,200,250,300,350,400,450,500,550,600,650,700],dryRunFee:'75',loadPrice:'400',
  bedloadQuantity:'',bedloadSize:field('','None'),bedloadPrices:[],bedloadPrice:'',otherChargeOptions:[{value:'',label:'Choose charge'},{value:'labor|50|0',label:'Labor'}],otherCharges:[{id:savedChargeId,label:'Labor',quantity:'1.00',price:'$50.00',total:'$50.00'}],discount:'',tip:'',
  howHeard:field('ref','Referral'),jobCategory:field('house','Household'),actualStartHour:field('10','10 AM',hours),actualStartMinute:field('00','00',minutes),actualEndHour:field('11','11 AM',hours),actualEndMinute:field('00','00',minutes),
  paymentMethods:[{value:'1',label:'Billed'},{value:'2',label:'Cash'},{value:'3',label:'Credit Card'},{value:'4',label:'Check'}],payments:[],balance:'450.00',total:'$450.00',
};

