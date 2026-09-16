import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { LiveFinance } from '../live-finance';
import type { FinanceData, FinanceView } from '../lib/commercial-contract';
import '../app/globals.css';
import '../live-responsive.css';
import '../workspace-density.css';
import '../daily-finance-freshness.css';
const data: FinanceData = {
 date:'2026-09-16', available:true, generatedAt:new Date().toISOString(),
 daily:{revenue:4200,costs:1800,profit:2400,recyclingIncome:0},
 month:{label:'September 2026',through:'2026-09-16',complete:false,missingDates:['2026-09-10'],revenue:64500,jobs:145,costs:null,profit:null,source:'Fixture'},
 trends:[92000,118000,104000,133000,126000,64500].map((grossRevenue,index)=>({monthKey:`2026-${String(index+4).padStart(2,'0')}`,monthDisplay:'Fixture month',dataThroughDate:`2026-${String(index+4).padStart(2,'0')}-${index===5?'16':'30'}`,complete:index!==5,reportingComplete:index!==5,grossRevenue,totalOperatingExpenses:null,estimatedOperatingProfit:null,completedJobs:200,revenueSource:'Fixture'})),
 territories:['Baton Rouge','Jefferson Parish','New Orleans','Northshore'].map((territory,index)=>({territory:`Junk King ${territory}`,jobs:30+index,revenue:[14000,12000,23000,15500][index]})),
 costs:['Payroll','Dump Expense','Fuel Expense','Other Expense'].map(category=>({category,amount:null,source:'Cost inputs incomplete or stale'})),
 reconciliation:{status:'collected',generatedAt:new Date().toISOString(),merchantCenterAvailable:true,merchantCenterFresh:true,summary:{junkware_count:0,junkware_total:0,merchant_center_total:0,matched_count:0,net_difference:0,exception_count:0},paymentsByJob:[],exceptions:[]},
 resale:[],resaleUpdatedAt:null,recycling:[],recyclingVersion:'fixture',recyclingIncomeRows:[]
};
window.fetch = async () => new Response(JSON.stringify(data), {status:200,headers:{'Content-Type':'application/json'}});
function Fixture() { const [view,setView]=useState<FinanceView>('overview'); return <div className="ops-app ops-live"><aside className="ops-sidebar"><div className="brand-lockup"><strong>OpsCenter</strong></div><nav className="primary-nav">{['Command','Control','Crew','Convoy','Capital','Campaign'].map(name=><div className={`nav-item ${name==='Capital'?'active':''}`} key={name}>{name}</div>)}</nav></aside><main className="ops-content"><div className="workspace"><div className="workspace-heading"><div><h1>Capital</h1><p>Performance, payments and financial decisions. All in one place.</p></div><div className="workspace-tabs finance-view-switcher" role="tablist" aria-label="Capital views">{(['overview','payments','expenses','accounting','resale','recycling','trends'] as const).map(item=><button key={item} role="tab" aria-selected={view===item} className={view===item?'active':''} onClick={()=>setView(item)}>{item[0].toUpperCase()+item.slice(1)}</button>)}</div></div><LiveFinance date={data.date} view={view} onViewChange={setView}/></div></main></div>; }
createRoot(document.getElementById('root')!).render(<Fixture/>);
