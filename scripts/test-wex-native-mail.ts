import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {prepareNativeWex,importNativeWex,readWexMailFeedStatus,type NativeWexPacket} from '../lib/wex-mail-feed';
import {importWexAlertExpenses,readWexAlertExpenses} from '../lib/wex-alert-expenses';
import {readWexRealtimePrice,importWexRealtimePrices} from '../lib/wex-realtime-prices';
import {isWexSource} from '../desktop-ui/lib/wex-source';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'wex-native-'));process.env.WEX_FUEL_DATA_DIR=root;
const dependencies={attribute:()=>({status:'unavailable' as const,truck:null,transactionAt:'',method:null,evidence:'Synthetic only',candidates:[]}),assignments:()=>['Truck 1']};
const base={id:'connector-source',sender:'OnlineServices@wexinc.com',receivedAt:'2026-10-24T15:01:00Z',sourceUrl:'https://outlook.office365.com/owa/?synthetic',body:'Tracking Number: 12345\nReason: A $80.00 Fuel purchase has exceeded your alert value.\nAuthorization Date & Time: 10/24/2026 10:00:00\nUnits: 20\nUnits of Measure: GA\nDriver First Name: Sample\nDriver Last Name: Person\nMerchant Name: Example Fuel\nMerchant Address: 1 Example Rd\nMerchant City: Example Town\nMerchant State / Province: LA'};
function packet(message=base,rfc='<synthetic@example.invalid>'):NativeWexPacket{
 const accountId='synthetic-account',id='outlook-local:'+createHash('sha256').update(accountId+'\0'+rfc).digest('hex');
 return {messages:[{...message,id,sourceUrl:id}],sources:[{id,accountId,internetMessageId:rfc,receivedAt:message.receivedAt}]};
}
try{
 assert.equal(isWexSource('javascript:alert(1)'),false);assert.equal(isWexSource('outlook-local:bad'),false);
 assert.equal(prepareNativeWex(packet(),dependencies).summary.newDaily,1);assert.equal(fs.readdirSync(root).length,0,'dry-run writes nothing');
 importWexAlertExpenses([base],'missing');importWexRealtimePrices([base],dependencies.attribute,dependencies.assignments);
 const beforeDaily=fs.readFileSync(path.join(root,'alert-expenses.json'),'utf8'),beforePrice=fs.readFileSync(path.join(root,'realtime-prices.json'),'utf8');
 const alias=importNativeWex(packet(),dependencies);assert.equal(alias.crossSourceAliases,1);assert.equal(alias.newDaily,0);assert.equal(alias.newPrices,0);
 assert.equal(fs.readFileSync(path.join(root,'alert-expenses.json'),'utf8'),beforeDaily);assert.equal(fs.readFileSync(path.join(root,'realtime-prices.json'),'utf8'),beforePrice);
 assert.equal(readWexAlertExpenses('2026-10-24',[]).rows.length,1);
 assert.equal(importNativeWex(packet(),dependencies).newDaily,0);
 const changed={...base,receivedAt:'2026-10-24T15:02:00Z',body:base.body.replace('$80.00','$90.00')};
 const revision=importNativeWex(packet(changed,'<revision@example.invalid>'),dependencies);
 assert.equal(revision.blockedPrices,1);assert.equal(readWexRealtimePrice('Truck 1',new Date('2026-10-24T20:00:00Z')).price,null,'conflicting existing price is blocked, not overwritten');
 assert.equal(readWexAlertExpenses('2026-10-24',[]).rows.length,1);assert.equal(readWexAlertExpenses('2026-10-24',[]).provisionalTotal,90);
 const reversal={...changed,receivedAt:'2026-10-24T15:03:00Z',body:changed.body.replace('Fuel purchase','Fuel purchase reversed')};
 importNativeWex(packet(reversal,'<reversal@example.invalid>'),dependencies);assert.equal(readWexAlertExpenses('2026-10-24',[]).rows[0].status,'reversed');
 const fresh={...base,receivedAt:'2026-10-24T16:01:00Z',body:base.body.replace('12345','67890').replace('10:00:00','11:00:00')};
 fs.writeFileSync(path.join(root,'realtime-prices.json.lock'),'owned elsewhere');
 assert.throws(()=>importNativeWex(packet(fresh,'<fresh@example.invalid>'),dependencies),/EEXIST/);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'mail-feed-status.json'),'utf8')).status,'apply_failed');
 assert.equal(readWexRealtimePrice('Truck 1',new Date('2026-10-24T20:00:00Z')).price,null);
 fs.unlinkSync(path.join(root,'realtime-prices.json.lock'));
 const repaired=importNativeWex(packet(fresh,'<fresh@example.invalid>'),dependencies);assert.equal(repaired.newDaily,0);assert.equal(repaired.newPrices,1);
 assert.equal(readWexRealtimePrice('Truck 1',new Date('2026-10-24T20:00:00Z')).price?.trackingNumber,'67890');
 assert.equal(importNativeWex(packet(fresh,'<fresh@example.invalid>'),dependencies).newPrices,0);
 for(const body of [fresh.body.replace('Units: 20','Units: N/A'),fresh.body.replace('Units of Measure: GA','Units of Measure: N/A')]){
  const unknownQuantity={...fresh,receivedAt:'2026-10-24T16:02:00Z',body};
  assert.ok(prepareNativeWex(packet(unknownQuantity,'<unknown-quantity@example.invalid>'),dependencies).blocked.includes('67890'),'unknown quantity blocks an earlier price even when the amount is unchanged');
 }
 const missingGallons={...fresh,receivedAt:'2026-10-24T16:02:00Z',body:fresh.body.replace('$80.00','$95.00').replace('Units: 20','Units: N/A')};
 importNativeWex(packet(missingGallons,'<missing-gallons@example.invalid>'),dependencies);
 assert.equal(readWexRealtimePrice('Truck 1',new Date('2026-10-24T20:00:00Z')).price,null,'later authorization with missing gallons blocks the older price');
 assert.equal(readWexAlertExpenses('2026-10-24',[]).rows.find(r=>r.trackingNumber==='67890')?.authorizedAmount,95);
 assert.ok(prepareNativeWex({messages:[],sources:[]},dependencies).blocked.includes('67890'),'full saved journal retains revision guard outside the current scan');
 const forged=packet();forged.sources[0].internetMessageId='<different@example.invalid>';assert.throws(()=>prepareNativeWex(forged,dependencies),/identity mismatch/);
 const conflict=packet();conflict.messages.push({...conflict.messages[0],body:conflict.messages[0].body.replace('$80.00','$85.00')});conflict.sources.push(conflict.sources[0]);assert.throws(()=>prepareNativeWex(conflict,dependencies),/Conflicting content/);
 assert.equal(readWexMailFeedStatus(()=>'not_running').watcher,'not_running');assert.equal(readWexMailFeedStatus(()=>'unknown').application?.status,'available');
 const retained=JSON.parse(fs.readFileSync(path.join(root,'native-mail-evidence.json'),'utf8'));assert.ok(retained.some((s:{internetMessageId:string})=>s.internetMessageId==='<synthetic@example.invalid>'));
 assert.equal(fs.statSync(path.join(root,'native-mail-evidence.json')).mode&0o777,0o600);
 console.log('Native WEX source identity, connector replay, revisions/reversals, blocked prices, partial-write recovery and private provenance passed.');
}finally{fs.rmSync(root,{recursive:true,force:true});}
