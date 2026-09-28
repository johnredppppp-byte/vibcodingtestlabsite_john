import { createRequire } from 'node:module';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {Miniflare}=createRequire(require.resolve('wrangler/package.json'))('miniflare');
const hash=s=>createHash('sha256').update(s).digest('hex');
const password='local-test-password-123456';
const promptResult={overallScore:70,criteriaScores:{clarity:7,specificity:7,model_fit:7,relevance:7,structure:7,conciseness:7},feedback:'Synthetic test response'};
const aiRequests=[];
const mf=new Miniflare({modules:[{type:'ESModule',path:'dist/server/index.js'},...readdirSync('dist/server',{recursive:true}).filter(f=>f.endsWith('.js')&&f!=='index.js').map(f=>({type:'ESModule',path:'dist/server/'+f}))],compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat'],d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{ADMIN_PASSWORD_HASH:hash(password),SETTINGS_ENCRYPTION_KEY:randomBytes(32).toString('base64')},outboundService:async req=>{
 const url=new URL(req.url),input=await req.json();
 if(url.hostname==='promptos.test')return Response.json(promptResult);
 if(url.hostname==='model.test'){aiRequests.push(input);const grade=input.messages[0].content.includes('代码审阅员');const content=grade?JSON.stringify({score:80,maxScore:100,criteria:[{name:'测试标准',score:80,maxScore:100,reason:'fixture'}],summary:'模拟审阅',limitations:'未执行程序'}):'这是本地测试回答。\n```python\nprint(1)\n```';return Response.json({model:input.model,choices:[{message:{content}}],usage:{prompt_tokens:375,completion_tokens:900,completion_tokens_details:{reasoning_tokens:200}}});}
 return new Response('Network not allowed in isolated test',{status:503});
}});
let adminCookie='';
async function call(path,{method='GET',body,cookie=adminCookie}={}){const headers={'Origin':'https://study.test'};if(cookie)headers.Cookie=cookie;if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';let encoded=body?JSON.stringify(body):undefined;if(body instanceof FormData){const wire=new Request('https://study.test',{method:'POST',body});headers['Content-Type']=wire.headers.get('content-type');encoded=await wire.arrayBuffer();}const res=await mf.dispatchFetch('https://study.test/api/'+path,{method,headers,body:encoded});return res;}
async function data(path,opts){const r=await call(path,opts);const text=await r.text();assert.equal(r.status,200,path+': '+text);return JSON.parse(text);}
try{
 await mf.ready;const db=await mf.getD1Database('DB');
 for(const sql of readFileSync('drizzle/0000_little_thunderbird.sql','utf8').split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await db.prepare(sql).run();
 assert.equal((await call('admin/participants',{cookie:''})).status,401);
 assert.equal((await call('auth/admin',{method:'POST',body:{password:'wrong'},cookie:''})).status,401);
 const login=await call('auth/admin',{method:'POST',body:{password},cookie:''});assert.equal(login.status,200);adminCookie=login.headers.get('set-cookie').split(';')[0];assert.ok(login.headers.get('set-cookie').includes('HttpOnly'));
 const tasks=await data('admin/tasks');assert.equal(tasks.tasks.length,2);
 await data('admin/settings',{method:'POST',body:{googleClientId:'test.apps.googleusercontent.com',studyOpen:true,chatBaseUrl:'https://model.test/v1',chatModel:'fixture-model',chatKey:'secret-fixture-chat',gradeBaseUrl:'https://model.test/v1',gradeModel:'fixture-grade',gradeKey:'secret-fixture-grade',promptosUrl:'https://promptos.test/score',promptosEnabled:true}});
 const config=await data('admin/settings');assert.equal(config.chatKey,undefined);assert.equal(config.chatKeySet,true);const keyRow=await db.prepare("SELECT value FROM settings WHERE key='chatKey'").first();assert.ok(!keyRow.value.includes('secret-fixture'));
 const t=tasks.tasks[0];await data('admin/tasks',{method:'POST',body:{...t,published:true}});
 const material=new FormData();material.set('taskId',t.id);material.set('file',new File(['a,b\n1,2'],'材料.csv'));await data('admin/materials',{method:'POST',body:material});
 const base=Date.now();for(const [i,id]of [[1,'STU-test-a'],[2,'STU-test-b']]){await db.prepare('INSERT INTO participants(id,google_sub,name,email,created,last_seen) VALUES(?,?,?,?,?,?)').bind(id,'google-'+i,'测试用户'+i,'test'+i+'@example.test',base,base).run();await db.prepare('INSERT INTO auth_sessions(token_hash,role,participant_id,expires) VALUES(?,?,?,?)').bind(hash('student-'+i),'student',id,base+3600000).run();}
 const student='pl_session=student-1',other='pl_session=student-2';
 assert.equal((await call('admin/export',{cookie:student})).status,403);
 const s=await data('sessions',{method:'POST',body:{taskId:t.id},cookie:student});const view=await data('sessions/'+s.id,{cookie:student});assert.equal(view.task.rubric,undefined);assert.equal(view.task.materials.length,1);
 assert.equal((await call('sessions/'+s.id,{cookie:other})).status,404);
 const file=await call('materials?task='+t.id+'&key='+encodeURIComponent(view.task.materials[0].key),{cookie:student});assert.equal(await file.text(),'a,b\n1,2');
 await data('admin/tasks',{method:'POST',body:{...t,published:true,content:'新的任务版本'}});assert.equal((await data('sessions/'+s.id,{cookie:student})).task.content,view.task.content);
 await data('chat',{method:'POST',body:{sessionId:s.id,text:'=1+2',requestId:'unique-request'},cookie:student});
 await data('chat',{method:'POST',body:{sessionId:s.id,text:'=1+2',requestId:'unique-request'},cookie:student});
 let messages=(await data('sessions/'+s.id,{cookie:student})).messages;assert.equal(messages.length,2);assert.equal(messages[0].text,'=1+2');assert.equal(messages[1].role,'assistant');
 assert.equal(aiRequests[0].max_tokens,6000);assert.equal(aiRequests[0].temperature,.2);
 await data('admin/settings',{method:'POST',body:{chatModel:'gpt-5.5',gradeModel:'gpt-5.5'}});
 await data('chat',{method:'POST',body:{sessionId:s.id,text:'继续解释函数',requestId:'unique-request-2'},cookie:student});
 assert.equal(aiRequests[1].max_completion_tokens,6000);assert.equal(aiRequests[1].max_tokens,undefined);assert.equal(aiRequests[1].temperature,undefined);
 await data('admin/queue',{method:'POST',body:{}});const prompts=await data('admin/prompts');assert.equal(prompts.total,2);assert.equal(prompts.prompts[0].score,70);
 const interactions=await data('admin/export?type=interactions');assert.equal(interactions.filter(x=>x.role==='assistant').length,2);assert.equal(JSON.parse(interactions.find(x=>x.role==='assistant').context_json).usage.completion_tokens,900);
 const safeView=JSON.stringify(await data('sessions/'+s.id,{cookie:student}));assert.ok(!safeView.includes('overallScore'));assert.ok(!safeView.includes('criteriaScores'));assert.ok(!safeView.includes('score_status'));
 const submit=new FormData();submit.set('sessionId',s.id);submit.set('code',new File(['print(1)\n'],'answer.py'));submit.set('explanation','本地测试');submit.set('artifacts',new File([],''));const submitted=await data('submissions',{method:'POST',body:submit,cookie:student});
 await data('admin/queue',{method:'POST',body:{}});const subs=await data('admin/submissions');assert.equal(subs.submissions.length,1);assert.equal(subs.submissions[0].score,80);
 const gradeReq=aiRequests.find(x=>x.messages[0].content.includes('代码审阅员'));assert.equal(gradeReq.max_completion_tokens,3500);assert.equal(gradeReq.temperature,undefined);
 assert.equal((await call('chat',{method:'POST',body:{sessionId:s.id,text:'late',requestId:'late'},cookie:student})).status,409);
 assert.equal(await (await call('admin/download?id='+submitted.id+'&kind=code')).text(),'print(1)\n');
 const markdown=await (await call('admin/download?id='+submitted.id+'&kind=grade')).text();assert.ok(markdown.includes('未执行程序'));assert.ok(markdown.includes('80 / 100'));assert.ok(markdown.includes('SHA-256'));
 const exported=await (await call('admin/export?type=prompts')).text();assert.ok(exported.includes("'=1+2"));assert.ok(exported.includes('STU-test-a'));assert.ok(exported.includes('70'));assert.ok(!exported.includes('secret-fixture'));
 assert.equal((await call('admin/download?id='+submitted.id+'&kind=grade',{cookie:other})).status,403);
 const csrf=await mf.dispatchFetch('https://study.test/api/admin/settings',{method:'POST',headers:{Cookie:adminCookie,Origin:'https://evil.test','Content-Type':'application/json'},body:'{}'});assert.equal(csrf.status,403);
 console.log('PASS: authentication, role boundaries, student isolation, task snapshots, materials, encrypted secrets, prompt capture and idempotency, legacy/GPT-5.5 API parameter compatibility, persisted usage, asynchronous scoring adapters, hidden scores, code upload, CSV, Markdown download, CSRF. External providers mocked; real Google login not tested.');
}finally{await mf.dispose();}
