import fs from 'node:fs';
import path from 'node:path';
import {wexFuelDirectory,type WexFuelTransaction} from './wex-fuel';
import {attributeWexTransactionToLinxup} from './wex-linxup-attribution';
import {sameTruck,truckNumber} from './junkware-trucks';
import {readDesktopKreweDay} from './desktop-krewe';
import {readJobRows} from './desktop-schedule-source';
import {normalizePayrollEmployeeKey as employeeKey} from './payroll-corrections';
import {validRosterDate} from './schedule-crew-roster';
import type {FuelPriceEvidence} from './appointment-cost-model';
export type WexPriceMessage={id:string;sender:string;receivedAt:string;body:string;sourceUrl:string};
export function parseWexPriceMessage(message:WexPriceMessage){
 if(message.sender.toLowerCase()!=='onlineservices@wexinc.com')return null;
 try{const url=new URL(message.sourceUrl);if(url.protocol!=='https:'||!['outlook.office365.com','outlook.office.com','outlook.live.com'].includes(url.hostname))return null;}catch{return null;}
 const body=message.body.replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ');
 const field=(name:string)=>body.match(new RegExp(name+':\\s*\\|?\\s*([^\\n|]+)','i'))?.[1]?.trim()||'';
 const trackingNumber=field('Tracking Number'),units=field('Units of Measure');
 const amount=Number(body.match(/A \$([\d,]+(?:\.\d+)?) Fuel purchase/i)?.[1]?.replaceAll(',',''));
 const gallons=Number(field('Units'));
 const date=field('Authorization Date & Time').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4}) (\d{2}:\d{2}:\d{2})$/);
 if(!/^\d+$/.test(trackingNumber)||units!=='GA'||!date||!Number.isFinite(amount)||amount<=0||!Number.isFinite(gallons)||gallons<=0||!Number.isFinite(Date.parse(message.receivedAt))||/declin|revers|void/i.test(field('Reason')))return null;
 if(!validRosterDate(`${date[3]}-${date[1].padStart(2,'0')}-${date[2].padStart(2,'0')}`)||!/^([01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(date[4]))return null;
 const price=amount/gallons;if(price<0.5||price>20)return null;
 const transaction={transactionId:trackingNumber,transactionDate:`${date[3]}-${date[1].padStart(2,'0')}-${date[2].padStart(2,'0')}`,transactionTime:date[4],merchantAddress:field('Merchant Address'),city:field('Merchant City'),state:field('Merchant State / Province'),postalCode:field('Merchant Postal Code'),merchant:field('Merchant Name'),driver:[field('Driver First Name'),field('Driver Last Name')].filter(Boolean).join(' '),driverPromptId:field('Driver Prompt ID')} as WexFuelTransaction;
 return {trackingNumber,price,amount,gallons,transaction,sourceUrl:message.sourceUrl,receivedAt:message.receivedAt};
}
export function chooseWexTruck(employeeTrucks:string[],gpsTruck:string|null){
 const trucks=[...new Set(employeeTrucks.map(truckNumber).filter((n):n is number=>n!==null))];
 if(trucks.length>1)return gpsTruck&&trucks.includes(truckNumber(gpsTruck)||0)?gpsTruck:null;
 if(trucks.length===1){const truck=`Truck ${trucks[0]}`;return gpsTruck&&!sameTruck(truck,gpsTruck)?null:truck;}
 return gpsTruck;
}
function employeeTrucks(transaction:WexFuelTransaction){
 const name=employeeKey(transaction.driver);if(!name)return [];
 const names=(values:string[])=>values.some(n=>employeeKey(n)===name);
 const trucks=readJobRows(transaction.transactionDate).filter(row=>!/cancel/i.test(row.status)&&names([row.driver,row.navigator,...(row.additionalCrew||[])])).map(row=>row.truck);
 try{const member=readDesktopKreweDay(transaction.transactionDate,transaction.driver,transaction.transactionDate,'admin').member;trucks.push(...member.truck.split(/[,;/]+/));}catch{/* No unique dated crew row. */}
 return trucks;
}
export const wexPriceFile=()=>path.join(wexFuelDirectory(),'realtime-prices.json');
export function importWexRealtimePrices(messages:WexPriceMessage[],attribute=attributeWexTransactionToLinxup,assignments=employeeTrucks){
 const rows:FuelPriceEvidence[]=[];
 for(const message of messages){const parsed=parseWexPriceMessage(message);if(!parsed)continue;const attribution=attribute(parsed.transaction);rows.push({price:parsed.price,amount:parsed.amount,gallons:parsed.gallons,trackingNumber:parsed.trackingNumber,truck:chooseWexTruck(assignments(parsed.transaction),attribution.status==='attributed'?attribution.truck:null),at:attribution.transactionAt||parsed.receivedAt,source:`WEX Outlook purchase alert · ${parsed.transaction.driver} · dated crew assignment / GPS · amount ÷ gallons`,sourceUrl:parsed.sourceUrl});}
 const file=wexPriceFile();let prior:FuelPriceEvidence[]=[];try{prior=JSON.parse(fs.readFileSync(file,'utf8')).rows;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}
 const byId=new Map(prior.map(row=>[row.trackingNumber,row]));
 for(const row of rows){const old=byId.get(row.trackingNumber);if(old&&(old.amount!==row.amount||old.gallons!==row.gallons))throw new Error('Conflicting WEX alert evidence.');byId.set(row.trackingNumber,row);}
 fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});const temp=file+'.'+process.pid+'.tmp';
 fs.writeFileSync(temp,JSON.stringify({source:'Outlook WEX real-time alerts',importedAt:new Date().toISOString(),rows:[...byId.values()]}),{mode:0o600});fs.renameSync(temp,file);
 return {imported:rows.length,matched:rows.filter(row=>row.truck).length};
}
export function readWexRealtimePrice(truck:string,asOf=new Date()){
 let data:{importedAt:string;rows:FuelPriceEvidence[]};try{data=JSON.parse(fs.readFileSync(wexPriceFile(),'utf8'));}catch{return {price:null,importedAt:null};}
 const rows=data.rows.filter(row=>sameTruck(row.truck,truck)&&Number.isFinite(row.price)&&row.price>0&&Number.isFinite(Date.parse(row.at))&&Date.parse(row.at)<=asOf.getTime()).sort((a,b)=>Date.parse(b.at)-Date.parse(a.at));
 return {price:rows[0]||null,importedAt:data.importedAt};
}
