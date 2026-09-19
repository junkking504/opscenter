import assert from 'node:assert/strict';
import {bonusProgress,mapsDirections} from '../lib/waypoint-day-summary';
import {projectWaypointDay} from '../lib/waypoint-day-summary-source';
import {testDaySummary,type TestCompletion} from '../lib/waypoint-sandbox-summary';
import type {CrewPhoneDay} from '../lib/crew-phone';
for(const [threshold,bonus] of [[1000,20],[1250,40],[1500,60],[1750,75],[2000,100],[2250,125],[2500,150],[2750,175],[3000,200],[3250,250],[3500,300],[3750,350],[4000,400]]){
 assert.equal(bonusProgress(threshold).bonus,bonus);assert.equal(bonusProgress(threshold-.01).next?.remaining,.01);
}
assert.equal(bonusProgress(9000).next,null);assert.equal(bonusProgress(0).next?.remaining,1000);
const day={date:'2026-09-19',truck:'Truck 6',driver:'Test Driver',navigators:['Test Navigator']} as CrewPhoneDay;
const now=Date.parse('2026-09-19T20:00:00Z');
const metrics={date:day.date,generated_at:new Date(now).toISOString(),source_freshness:{metrics:{truck_revenue:{status:'current',as_of:new Date(now).toISOString()}}},revenue_by_truck:{'Truck# 6':2400},tips_by_truck:{'Truck# 6':30},payroll_records:[{name:'Test Driver',individual_revenue:1750,tip:25,revenue_bonus:75,is_salary:false,hourly_rate:999},{name:'Test Navigator',individual_revenue:650,tip:5,revenue_bonus:0,is_salary:false},{name:'Private Other',individual_revenue:5000}],appointments:[{appt_id:'a',job_status:'Completed Duration: 60 min(s)',truck_number:'Truck 6',revenue:'$2,400.00',tip:'30',customer_name:'Completed test'},{appt_id:'b',job_status:'Confirmed',truck_number:'Truck 6',customer_name:'Future private'},{appt_id:'c',job_status:'Completed',truck_number:'Truck 9',customer_name:'Other truck private'}]};
const summary=projectWaypointDay(day,metrics,now);assert.equal(summary.revenue,2400);assert.equal(summary.completed?.length,1);assert.equal(summary.crew[0].progress?.next?.remaining,250);assert.equal(summary.crew[1].progress?.next?.remaining,350);assert.equal(summary.stale,false);
for(const secret of ['hourly_rate','Private Other','Future private','Other truck private'])assert(!JSON.stringify(summary).includes(secret));
assert.equal(projectWaypointDay(day,metrics,now+11*60_000).stale,true);
assert.equal(projectWaypointDay(day,{...metrics,date:'2026-09-18'},now).revenue,null);
assert.equal(projectWaypointDay(day,null,now).completed,null);
assert.equal(projectWaypointDay(day,{...metrics,payroll_records:[]},now).crew[0].revenue,null);
assert.equal(projectWaypointDay(day,{...metrics,payroll_records:[{...metrics.payroll_records[0],revenue_bonus:999}]},now).crew[0].progress,null);
const completed=[{id:'a',truck:'Truck 6',revenue:1000.01,tips:10.01,crew:['Test Driver','Test Navigator']},{id:'b',truck:'Truck 9',revenue:1000,tips:10,crew:['Test Driver','Test Navigator']}] as TestCompletion[];
const moved=testDaySummary({...day,truck:'Truck 9'},completed,0);assert.equal(moved.revenue,1000);assert.equal(moved.completed?.length,1);assert.equal(moved.crew[0].revenue,1000.01);assert.equal(moved.crew[0].progress?.bonus,20);assert.equal(moved.crew[1].revenue,1000);assert.equal(testDaySummary(day,completed,1).revenue,null);
assert.equal(mapsDirections('Address unavailable'),null);assert(mapsDirections('10 Main & A #2')?.includes('10%20Main%20%26%20A%20%232'));
console.log('PASS: all tier boundaries, highest-tier cap, credited allocation, privacy projection, source freshness, missing data, truck switches, legacy test totals, Maps encoding.');
