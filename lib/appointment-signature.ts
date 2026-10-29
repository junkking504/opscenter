import {parseSignature,type SignatureDrawing} from './amazon-closeout';
export type AppointmentSignature={requestId:string;appointmentId:string;signerName:string;signedAt:string;drawing:SignatureDrawing};
export type SignatureSubmission={requestId:string;assignmentId:string;signerName:string;drawing:SignatureDrawing};
export const signatureRequestId=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export function signatureDrawing(value:unknown):SignatureDrawing {
 try{return parseSignature(value);}catch{throw new Error('Add a signature with a few pen strokes, or clear it and sign again.');}
}
export function signatureSubmission(value:unknown):SignatureSubmission {
 if(!value || typeof value!=='object' || Array.isArray(value))throw new Error('Signature request is invalid.');
 const row=value as SignatureSubmission;
 if(Object.keys(row).some(key=>!['requestId','assignmentId','signerName','drawing'].includes(key)) || !signatureRequestId.test(row.requestId) || !signatureRequestId.test(row.assignmentId))throw new Error('Signature request is invalid.');
 if(typeof row.signerName!=='string' || !row.signerName.trim() || row.signerName.length>100 || /[\u0000-\u001f\u007f]/.test(row.signerName))throw new Error('Enter the signer’s name (100 characters or fewer).');
 return {requestId:row.requestId,assignmentId:row.assignmentId,signerName:row.signerName.trim(),drawing:signatureDrawing(row.drawing)};
}
export function signatureReceipt(value:unknown,appointmentId:string):AppointmentSignature {
 if(!value || typeof value!=='object')throw new Error('Saved signature could not be verified.');
 const row=value as AppointmentSignature;
 if(!signatureRequestId.test(row.requestId) || row.appointmentId!==appointmentId || !/^\d{1,12}$/.test(row.appointmentId) || typeof row.signerName!=='string' || !row.signerName.trim() || row.signerName.length>100 || !Number.isFinite(Date.parse(row.signedAt)))throw new Error('Saved signature could not be verified.');
 return {requestId:row.requestId,appointmentId:row.appointmentId,signerName:row.signerName,signedAt:row.signedAt,drawing:signatureDrawing(row.drawing)};
}
