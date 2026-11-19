const test=require('node:test');const assert=require('node:assert/strict');
const {calculateCorrectionDeadline,correctionPolicyInput,verifiedReceivedTime,scheduleCorrectionDeadline}=require('../apps/api/dist/routes/prime-correction-deadlines');
const base={duration:1,duration_unit:'calendar_days',trigger_event:'customer_received',time_zone:'America/New_York',holidays:[],effective_from:'2026-01-01T00:00:00Z',effective_until:null};
test('calendar days retain local clock across daylight-saving transitions; elapsed hours do not',()=>{
 const start='2026-03-07T12:00:00-05:00';
 assert.equal(calculateCorrectionDeadline(base,start).due_at,'2026-03-08T16:00:00.000Z');
 assert.equal(calculateCorrectionDeadline({...base,duration:24,duration_unit:'hours'},start).due_at,'2026-03-08T17:00:00.000Z');
 assert.equal(calculateCorrectionDeadline(base,'2026-10-31T12:00:00-04:00').due_at,'2026-11-01T17:00:00.000Z');
});
test('business days skip weekends and the explicitly approved holiday calendar',()=>{
 assert.equal(calculateCorrectionDeadline({...base,duration_unit:'business_days',holidays:['2026-09-07']},'2026-09-04T15:00:00-04:00').due_at,'2026-09-08T19:00:00.000Z');
 assert.equal(calculateCorrectionDeadline({...base,duration:0},'2026-09-04T15:00:00-04:00').due_at,'2026-09-04T19:00:00.000Z');
});
test('invalid policy calendars, zones, offsets and future received times are rejected',()=>{
 for(const change of [{duration:-1},{duration:1.5},{duration:null},{time_zone:'Bogus/Zone'},{holidays:['2026-02-30']},{holidays:undefined},{effective_from:'2026-01-01'},{effective_until:'2025-01-01T00:00:00Z'}])assert.throws(()=>correctionPolicyInput({...base,...change}));
 assert.throws(()=>verifiedReceivedTime('2026-09-30T09:00:00Z','2026-09-29T09:00:00Z'),/cannot follow/);
 assert.equal(verifiedReceivedTime(undefined,new Date()),null);
});
test('late policy application uses the original receipt; missing policy never invents a date',async()=>{
 const correction={id:'correction',recorded_at:new Date('2026-09-10T20:00:00Z'),customer_received_at:new Date('2026-09-04T19:00:00Z'),deadline_status:'needs_policy_review'};
 let policy,update;
 const c={query:async(sql,args)=>{if(sql.startsWith('UPDATE')){update=args;return {rows:[{...correction,deadline_status:'scheduled'}]};}return {rows:sql.includes('FROM production_corrections')?[correction]:policy?[policy]:[]};}};
 assert.equal((await scheduleCorrectionDeadline(c,'tenant','correction')).deadline_status,'needs_policy_review');assert.equal(update,undefined);
 policy={...base,id:'policy'};await scheduleCorrectionDeadline(c,'tenant','correction');assert.equal(update[4],'2026-09-05T19:00:00.000Z');
 correction.deadline_status='scheduled';update=undefined;await scheduleCorrectionDeadline(c,'tenant','correction');assert.equal(update,undefined);
});
