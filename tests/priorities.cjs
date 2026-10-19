const fs=require('node:fs'),Module=require('node:module'),assert=require('node:assert/strict');
const repo=require('node:path').resolve(__dirname,'..'); const ts=require(repo+'/node_modules/typescript');
const {PGlite}=require(repo+'/node_modules/@electric-sql/pglite');
const db=new PGlite(); const emails=[]; let failDelivery = false; let deliveryState = null; let statements=[];
const RealDate=Date;global.Date=class extends RealDate{constructor(...args){super(...(args.length?args:['2026-10-18T16:00:00Z']))}static now(){return new RealDate('2026-10-18T16:00:00Z').getTime()}};
const sql=async(strings,...values)=>{let text='';strings.forEach((s,i)=>{text+=s;if(i<values.length)text+='$'+(i+1)});statements.push(text);try{return (await db.query(text,values)).rows}catch(error){console.error('SQL failure:',text.slice(0,350));throw error}};
const cache={};function load(path){if(cache[path])return cache[path].exports;const m=new Module(repo+'/'+path+'.qa.cjs',module);m.filename=repo+'/'+path+'.qa.cjs';m.paths=Module._nodeModulePaths(repo);cache[path]=m;const orig=m.require.bind(m);m.require=(id)=>id==='@neondatabase/serverless'?{neon:()=>sql}:id.endsWith('/email.js')?{sendTeamNotification:async(details,recipients)=>{emails.push({details,recipients});return true},deliverTeamNotification:async(details,recipients)=>{if(failDelivery)throw new Error('Temporary provider outage');emails.push({details,recipients});return {provider:'ghl',messageId:'test-'+emails.length}},checkMessageDelivery:async()=>deliveryState,recipientList:override=>override?.length?override:['organizer@example.com']}:id.startsWith('../lib/')||id.startsWith('./')?load('lib/'+id.split('/').at(-1).replace('.js','.ts')):orig(id);m._compile(ts.transpileModule(fs.readFileSync(repo+'/'+path,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2023}}).outputText,m.filename);return m.exports}
process.env.DATABASE_URL='postgres://local-test';process.env.ORGANIZER_SESSION_SECRET='isolated-test-secret';process.env.ORGANIZER_PIN='1234';process.env.HOME_ADDRESS='PRIVATE TEST ADDRESS 123';
const handler=load('api/data.ts').default;let cookie='';
async function call(body,admin=false,query={}){let data,code=200;const headers={};const res={setHeader:(k,v)=>{headers[k]=v},status:(c)=>{code=c;return res},json:(v)=>{data=v;return res},send:(v)=>{data=v;return res}};await handler({method:body?'POST':'GET',body:body||{},query,headers:{},cookies:admin?{marys_organizer:cookie}:{}},res);return {code,data,headers}}
(async()=>{
await load('lib/schema.ts').migrate(sql);
let r=await call();assert.equal(r.code,200,JSON.stringify(r.data));assert(!('homeAddress' in JSON.parse(JSON.stringify(r.data))));
r=await call({action:'organizerLogin',pin:'1234'});assert.equal(r.code,200);cookie=r.headers['Set-Cookie'].split(';')[0].split('=').slice(1).join('=');
r=await call({action:'saveHomeAddress',address:'PRIVATE UPDATED HOME'},true);assert.equal(r.code,200);
await sql`INSERT INTO support_contacts(id,name,phone,email) VALUES ('sam','Sam Helper','6025550100','sam@example.com'),('mary','Mary Greenberg','6025550101','house@example.com'),('stu','Stu Greenberg','6025550101','house@example.com')`;
await sql`INSERT INTO availability(id,name,phone,email,available_day,available_time,note) VALUES ('offer','Sam Helper','6025550100','sam@example.com','20261025','14:00-17:00','Errands')`;
await sql`INSERT INTO care_team(id,name,phone,email,role) VALUES ('sam-care','Sam Helper','6025550100','sam@example.com','Helper')`;
let event={id:'event-one',category:'appointment',forWho:'Mary',date:'20261025T140000',dayLabel:'Sunday, October 25',time:'14:00',endTime:'15:00',title:'Practical appointment',details:'Full appointment support',location:'Home',helpNeeded:'Need a ride',helper:'Sam Helper',helperPhone:'6025550100',helperEmail:'sam@example.com'};
r=await call({action:'addEventBatch',events:[event]},true);assert.equal(r.code,201,JSON.stringify(r.data));
r=await call(null,true);assert.equal(r.code,200);let sam=r.data.supportContacts.find(p=>p.name==='Sam Helper');assert(sam.personId);assert.equal(r.data.supportContacts.filter(p=>p.email==='house@example.com').length,2);assert.equal(r.data.events.find(e=>e.id===event.id).helperPersonId,sam.personId);
r=await call({action:'savePerson',originals:[sam],contact:{...sam,name:'Samuel Helper',phone:'6025550199'}},true);assert.equal(r.code,200,JSON.stringify(r.data));
r=await call(null,true);sam=r.data.supportContacts.find(p=>p.personId===sam.personId);assert.equal(sam.name,'Samuel Helper');let current=r.data.events.find(e=>e.id===event.id);assert.equal(current.helper,'Samuel Helper');assert.equal(r.data.availability.find(a=>a.id==='offer').name,'Samuel Helper');assert.equal(r.data.careTeam.find(a=>a.id==='sam-care').name,'Samuel Helper');assert.equal(current.helperPersonId,sam.personId);
r=await call(null,false,{calendar:event.id});assert.equal(r.code,200);assert(!r.data.includes('PRIVATE UPDATED HOME'));
await sql`INSERT INTO support_requests(id,event_id,requester_name,requester_phone,requester_email,approval_token,request_start_time,request_end_time) VALUES ('pending-test','event-one','Pending Helper','6025550110','pending@example.com','test-token','14:00','15:00')`;
const before=emails.length;r=await call({action:'updateEvent',event:{...current,time:'15:00',endTime:'16:00',date:'20261025T150000'}},true);assert.equal(r.code,200,JSON.stringify(r.data));assert(emails.slice(before).some(e=>e.details.heading==='Your scheduled help has changed'));assert(emails.slice(before).some(e=>e.recipients?.includes('pending@example.com')));
r=await call({action:'deleteEvent',eventId:event.id},true);assert.equal(r.code,200,JSON.stringify(r.data));assert.equal(r.data.cancellationEmailSent,true);
await sql`UPDATE food_settings SET weekdays='0',start_time='14:00',end_time='18:00' WHERE singleton=TRUE`;
const plan={action:'proposePlan',type:'food',name:'Meal Helper',phone:'6025550123',email:'meal@example.com',date:'2026-10-25',time:'14:00',endTime:'14:30',details:'Chicken soup, front door, no visit'};
const results=await Promise.all([call(plan),call({...plan,name:'Other Helper',email:'other@example.com'})]);assert.equal(results.filter(r=>r.code===202).length,1,JSON.stringify(results));assert.equal(results.filter(r=>r.code===409).length,1,JSON.stringify(results));
r=await call();assert(r.data.foodReservedDates.includes('20261025'));assert(!JSON.stringify(r.data).includes('PRIVATE UPDATED HOME'));
const reqs=await call({action:'getPendingRequests'},true);assert.equal(reqs.code,200);const pending=reqs.data.requests.find(r=>r.proposalType==='food');assert(pending);r=await call({action:'organizerDecideRequest',requestId:pending.id,decision:'approve'},true);assert.equal(r.code,200,JSON.stringify(r.data));assert(emails.some(e=>e.details.rows?.some(row=>row.value==='PRIVATE UPDATED HOME')));
const offer={id:'offer-new',name:'Available Only',phone:'6025550140',email:'offer@example.com',day:'20261026',time:'09:00-12:00',note:'Practical support'};r=await call({action:'addAvailabilityBatch',entries:[offer]});assert.equal(r.code,201,JSON.stringify(r.data));assert(emails.some(e=>e.details.heading==='Your availability was received'));

const confirmedFood=(await call(null,true)).data.events.find(e=>e.proposalType==='food'&&e.helper);
assert(confirmedFood);r=await call({action:'updateEvent',event:{...confirmedFood,details:'Updated brief drop-off instructions'}},true);assert.equal(r.code,200);assert.equal(r.data.event.helper,confirmedFood.helper);assert((await call()).data.foodReservedDates.includes('20261025'));

await sql`UPDATE food_settings SET visitor_preferences='No visits. Please contribute to the GoFundMe. Bring food only when slots are open.' WHERE singleton=TRUE`;
assert(!/gofundme|contribute/i.test((await call()).data.visitorPreferences));
assert(!/gofundme|contribute/i.test((await call(null,true)).data.visitorPreferences));

// Read paths must be read-only, bounded and small, with no hidden private data.
statements=[];r=await call();const publicReads=statements.length;assert(publicReads<=8);assert(statements.every(q=>q.trim().startsWith('SELECT')));
statements=[];r=await call(null,true);const privateReads=statements.length;assert(privateReads<=12);assert(statements.every(q=>q.trim().startsWith('SELECT')));
const secretEvent={id:'private-event',category:'appointment',forWho:'Mary',date:'20261026T100000',dayLabel:'Monday, October 26',time:'10:00',endTime:'11:00',title:'SECRET MEDICAL TITLE',details:'SECRET PRIVATE NOTES',location:'SECRET LOCATION',helpNeeded:'No help needed'};
await call({action:'addEventBatch',events:[secretEvent]},true);
await call({action:'saveFamilyBusyDates',person:'Gabby',dates:['20261026'],rangeStart:'20261026',rangeEnd:'20261026',startTime:'09:00',endTime:'12:00'},true);
r=await call();const publicJson=JSON.stringify(r.data);assert(!publicJson.includes('SECRET'));assert(!publicJson.includes('Gabby Work'));assert(!('familyInTownDates' in r.data));assert(!('careTeam' in r.data));assert(!('notifications' in r.data));assert(r.data.events.some(e=>e.title==='Mary is too sick to see anyone'));
r=await call(null,false,{calendar:'private-event'});assert.equal(r.code,404);r=await call(null,true,{calendar:'private-event'});assert.equal(r.code,200);assert(r.data.includes('SECRET MEDICAL TITLE'));
// Pending names and notes never leak; cancelled food becomes available again.
r=await call({...plan,date:'2026-11-01'},false);assert.equal(r.code,202);let pendingFood=(await call({action:'getPendingRequests'},true)).data.requests.find(e=>e.proposalType==='food');assert(pendingFood);
r=await call();assert(!JSON.stringify(r.data.events).includes('Meal Helper'));assert(r.data.foodReservedDates.includes('20261101'));
await call({action:'organizerDecideRequest',requestId:pendingFood.id,decision:'decline',declineReason:'No longer needed'},true);
r=await call({...plan,date:'2026-11-01'},false);assert.equal(r.code,202,JSON.stringify(r.data));
// Weekly templates require organizer access; preview detects conflicts and repeated apply is safe.
r=await call({action:'saveScheduleTemplate',name:'Routine',selectedIds:['private-event']},false);assert.equal(r.code,401);
r=await call({action:'saveScheduleTemplate',name:'Routine',selectedIds:['private-event']},true);assert.equal(r.code,201);const templateId=r.data.template.id;
assert(!JSON.stringify(r.data.template).includes('helperEmail'));
r=await call({action:'previewScheduleTemplate',id:templateId,weekOf:'2026-11-02'},true);assert.equal(r.code,200);assert.equal(r.data.items.length,1);const routineId=r.data.items[0].id;
r=await call({action:'applyScheduleTemplate',id:templateId,weekOf:'2026-11-02',selectedIds:[routineId]},true);assert.equal(r.data.added,1);
r=await call({action:'applyScheduleTemplate',id:templateId,weekOf:'2026-11-02',selectedIds:[routineId]},true);assert.equal(r.data.added,0);
await call({action:'addEventBatch',events:[{...secretEvent,id:'conflict',date:'20261109T100000',dayLabel:'Monday, November 9'}]},true);
r=await call({action:'previewScheduleTemplate',id:templateId,weekOf:'2026-11-09'},true);assert(r.data.items[0].conflict);
// Each recipient is durable and independent. Leased workers do not double-send.
const outbox=load('lib/outbox.ts');const details={subject:'Test',heading:'Test',intro:'Test',rows:[]};
await outbox.queueNotification(sql,'qa-retry',details,['retry@example.com']);failDelivery=true;assert.equal(await outbox.processOutbox(sql,'qa-retry'),false);
let jobs=await sql`SELECT * FROM email_outbox WHERE notification_key='qa-retry'`;assert.equal(jobs[0].status,'retry');assert.equal(jobs[0].attempts,1);
await sql`UPDATE email_outbox SET next_attempt_at=NOW()-INTERVAL '1 minute' WHERE notification_key='qa-retry'`;failDelivery=false;
let emailCount=emails.length;await Promise.all([outbox.processOutbox(sql,'qa-retry'),outbox.processOutbox(sql,'qa-retry')]);assert.equal(emails.length-emailCount,1);
await outbox.queueNotification(sql,'qa-retry',details,['retry@example.com']);await outbox.processOutbox(sql,'qa-retry');assert.equal(emails.length-emailCount,1);
await sql`UPDATE email_outbox SET checked_at=NOW() WHERE notification_key<>'qa-retry'`;deliveryState={status:'failed',error:'Mailbox does not exist'};await outbox.checkOutboxDelivery(sql);jobs=await sql`SELECT * FROM email_outbox WHERE notification_key='qa-retry'`;assert.equal(jobs[0].status,'bounced');
r=await call();assert(!JSON.stringify(r.data).includes('Mailbox does not exist'));
await outbox.queueNotification(sql,'qa-stale',details,['stale@example.com']);await outbox.supersedeNotifications(sql,'qa-stale');emailCount=emails.length;await outbox.processOutbox(sql,'qa-stale');assert.equal(emails.length,emailCount);

await outbox.runEmailJob(sql, (await sql`SELECT id FROM email_outbox WHERE notification_key='qa-retry'`)[0].id, 1);
await outbox.queueNotification(sql,'qa-background',details,['background@example.com']);failDelivery=true;let backgroundId=(await sql`SELECT id FROM email_outbox WHERE notification_key='qa-background'`)[0].id;
await assert.rejects(outbox.runEmailJob(sql,backgroundId,1),e=>e instanceof outbox.EmailRetry&&e.afterSeconds>=60);failDelivery=false;
await sql`UPDATE email_outbox SET next_attempt_at=NOW()-INTERVAL '1 minute' WHERE id=${backgroundId}`;deliveryState={status:'delivered',error:''};await outbox.runEmailJob(sql,backgroundId,2);
assert.equal((await sql`SELECT status FROM email_outbox WHERE id=${backgroundId}`)[0].status,'delivered');

// A new volunteer immediately joins the directory without waiting for a GET repair.
r=await call({action:'addSupportContact',name:'New Friend',phone:'6025550166',email:'new@example.com'});assert.equal(r.code,201);
assert((await call(null,true)).data.supportContacts.some(p=>p.name==='New Friend'&&p.personId));
console.log(`PASS: public GET ${publicReads} read-only SQL statements; private GET ${privateReads}; private events, locations, notes and family presence hidden; private ICS blocked; food cancellation releases reservation; routine preview/conflict/idempotency; recipient outbox retries, leases, idempotency, bounce reporting and supersession; immediate person linking.`);

console.log('PASS: real PostgreSQL schema, person linking and rename across records, shared-household contacts, changed-time email, cancellation email, single food reservation under concurrent requests, private address hidden publicly and emailed on approval, availability acknowledged without booking. No real emails sent.');await db.close();
})().catch(async e=>{console.error(e);await db.close();process.exitCode=1});
