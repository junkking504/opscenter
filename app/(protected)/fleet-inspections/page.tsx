import { redirect } from 'next/navigation';
export default async function Page({searchParams}:{searchParams:Promise<Record<string,string|string[]|undefined>>}) {
  const source=await searchParams;
  const params=new URLSearchParams({data:'live',workspace:'Fleet',fleetView:'maintenance',inspectionReports:'1'});
  for(const key of ['date','report']) {
    const value=source[key];
    if(typeof value==='string' && value.length<=100)params.set(key,value);
  }
  redirect(`/desktop?${params}`);
}
