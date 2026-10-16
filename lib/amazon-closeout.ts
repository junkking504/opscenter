import { appointmentPartner } from './appointment-partner';

export function isAmazonJob(value:unknown) {
  if(!value || typeof value!=='object')return false;
  const source=value as Record<string,unknown>;
  if(typeof source.companyName==='string')return appointmentPartner({address:source.companyName,customerName:''})?.name==='Amazon';
  return appointmentPartner({address:typeof source.address==='string'?source.address:'',customerName:typeof source.customerName==='string'?source.customerName:''})?.name === 'Amazon';
}
export function isAmazonAssignee(label:string) {
  const parts=label.trim().split(',').map(part=>part.trim());
  const name=(parts.length===2?`${parts[1]} ${parts[0]}`:label).replace(/\s+/g,' ').trim().toLowerCase();
  return ['eugene dabezies','robert mclaughlin','lance gerard'].includes(name);
}
export type SignatureDrawing = {strokes:Array<Array<[number,number]>>};
export type SignatureEvidence = {appointmentId:string;sha256:string}|null;
export const AMAZON_SIGNATURE_REQUIRED='A customer signature is required to complete an Amazon job.';
export function parseSignature(value:unknown):SignatureDrawing {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(key=>key!=='strokes'))throw new Error(AMAZON_SIGNATURE_REQUIRED);
  const strokes=(value as SignatureDrawing).strokes;
  if(!Array.isArray(strokes) || !strokes.length || strokes.length>100)throw new Error(AMAZON_SIGNATURE_REQUIRED);
  let points=0,distance=0;
  for(const stroke of strokes){
    if(!Array.isArray(stroke) || !stroke.length)throw new Error('The signature is not valid. Please sign again.');
    for(let i=0;i<stroke.length;i++){
      const point=stroke[i];points++;
      if(!Array.isArray(point) || point.length!==2 || point.some(n=>typeof n!=='number' || !Number.isFinite(n)) || point[0]<0 || point[0]>600 || point[1]<0 || point[1]>200)throw new Error('The signature is not valid. Please sign again.');
      if(i)distance+=Math.hypot(point[0]-stroke[i-1][0],point[1]-stroke[i-1][1]);
    }
  }
  if(points>2000)throw new Error('The signature is too large. Clear it and sign again.');
  if(points<3 || distance<12)throw new Error(AMAZON_SIGNATURE_REQUIRED);
  return {strokes};
}
export function hasSavedSignature(source:Record<string,unknown>,appointmentId:string) {
  const evidence=source.signatureEvidence as SignatureEvidence;
  return Boolean(evidence && evidence.appointmentId===appointmentId && /^[a-f0-9]{64}$/.test(evidence.sha256));
}
export function requireAmazonSignature(source:Record<string,unknown>,status:string,appointmentId:string,drawing?:unknown) {
  if(status!=='8' || !isAmazonJob(source))return;
  if(drawing!==undefined){parseSignature(drawing);return;}
  if(!hasSavedSignature(source,appointmentId))throw new Error(AMAZON_SIGNATURE_REQUIRED);
}

export function verifyAmazonSignature(before:Record<string,unknown>,after:Record<string,unknown>,status:string,appointmentId:string,expectedHash?:string) {
  if(status!=='8' || !isAmazonJob(before))return;
  if(!isAmazonJob(after))throw new Error('The Amazon company changed while saving. Check the source appointment.');
  requireAmazonSignature(after,status,appointmentId);
  const expected=expectedHash || (before.signatureEvidence as SignatureEvidence)?.sha256;
  if(expected && (after.signatureEvidence as SignatureEvidence)?.sha256!==expected)throw new Error('JunkWare did not retain the captured signature.');
}
