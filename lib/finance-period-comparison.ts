type Metrics = Record<string,unknown>;
const finite=(value:unknown)=>value==null||value===''||!Number.isFinite(Number(value))?null:Number(value);
export function financePeriodComparison(through:string,read:(date:string)=>Metrics|null) {
  const end=new Date(`${through}T12:00:00Z`);
  const priorLast=new Date(Date.UTC(end.getUTCFullYear(),end.getUTCMonth(),0,12));
  const days=Math.min(end.getUTCDate(),priorLast.getUTCDate());
  const currentStart=through.slice(0,7)+'-01',priorStart=priorLast.toISOString().slice(0,7)+'-01';
  const total=(start:string,field:'revenue'|'profit')=>{
    const values=Array.from({length:days},(_,i)=>read(`${start.slice(0,7)}-${String(i+1).padStart(2,'0')}`)).map(row=>row?finite(field==='revenue'?row.total_revenue??row.gross_revenue??row.sales:row.net_profit):null);
    return values.some(value=>value===null)?null:values.reduce<number>((sum,value)=>sum+(value||0),0);
  };
  return {currentStart,currentEnd:`${currentStart.slice(0,7)}-${String(days).padStart(2,'0')}`,priorStart,priorEnd:`${priorStart.slice(0,7)}-${String(days).padStart(2,'0')}`,currentRevenue:total(currentStart,'revenue'),priorRevenue:total(priorStart,'revenue'),currentProfit:total(currentStart,'profit'),priorProfit:total(priorStart,'profit')};
}
