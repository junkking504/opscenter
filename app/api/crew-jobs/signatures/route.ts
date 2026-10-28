import {crewSignatureRequest} from '@/lib/crew-job-signature-http';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export const GET=(request:Request)=>crewSignatureRequest(request);
export const POST=(request:Request)=>crewSignatureRequest(request);
