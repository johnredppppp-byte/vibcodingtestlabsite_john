import { ApiError, all, one, run, stmt, db, json, session, body, str, now, uid, sha, sameOrigin, googleConfig, googleLogin, adminLogin, logout, settings, putSetting, encrypt, httpsUrl, ownedSession, taskPublic, enqueue, background, rate, bindings, csv, download, Row } from '@/lib/server';
import { completion, processJobs, gradeMarkdown, promptQuery } from '@/lib/scoring';
export const dynamic='force-dynamic';
async function api(req:Request){
 try{
  sameOrigin(req);const u=new URL(req.url),path=u.pathname.replace(/^\/api\//,''),method=req.method;
  if(path==='auth/config'&&method==='GET')return await googleConfig();
  if(path==='auth/google'&&method==='POST')return await googleLogin(req,await body(req));
  if(path==='auth/admin'&&method==='POST')return await adminLogin(req,await body(req));
  if(path==='auth/logout'&&method==='POST')return await logout(req);
  if(path==='me'&&method==='GET'){try{const s=await session(req);return json({role:s.role,participant:s.participant_id?await one('SELECT id,seq,name,email FROM participants WHERE id=?',[s.participant_id]):null});}catch(e){if(e instanceof ApiError&&e.status===401)return json({role:null});throw e;}}
  if(path==='tasks'&&method==='GET')return json({tasks:(await all('SELECT * FROM tasks WHERE published=1 ORDER BY sort')).map(taskPublic)});
  if(path==='sessions'&&method==='POST'){
   const auth=await session(req,'student'),data=await body(req),task=await one('SELECT * FROM tasks WHERE id=? AND published=1',[str(data.taskId,64)]);if(!task)throw new ApiError(404,'任务尚未发布');const cfg=await settings();if(!cfg.studyOpen)throw new ApiError(403,'实验尚未开放，请联系研究者');
   await run('INSERT OR IGNORE INTO study_sessions(id,participant_id,task_id,task_snapshot,started) VALUES(?,?,?,?,?)',[uid(),auth.participant_id,task.id,JSON.stringify(task),now()]);const s=await one('SELECT id FROM study_sessions WHERE participant_id=? AND task_id=?',[auth.participant_id,task.id]);return json(s);
  }
  if(path.startsWith('sessions/')&&method==='GET'){
   const s=await ownedSession(req,path.split('/')[1]);const messages=await all('SELECT id,role,text,created,reply_status,error FROM messages WHERE session_id=? ORDER BY seq',[s.id]);const submissions=await all('SELECT id,filename,created FROM submissions WHERE session_id=? ORDER BY created',[s.id]);return json({id:s.id,started:s.started,finished:s.finished,task:taskPublic(JSON.parse(s.task_snapshot)),messages,submissions});
  }
  if(path==='chat'&&method==='POST'){
   const data=await body(req),s=await ownedSession(req,str(data.sessionId,80)),cfg=await settings(true);if(!cfg.studyOpen)throw new ApiError(403,'实验当前暂停');if(s.finished)throw new ApiError(409,'已提交的任务不能继续对话');if(!cfg.chatKey||!cfg.chatModel)throw new ApiError(503,'对话 AI 尚未配置，请联系研究者');
   await rate('chat:'+s.participant_id,30);const text=(str(data.text,16000),data.text as string),requestId=str(data.requestId,100);const old=await one('SELECT id,session_id FROM messages WHERE request_id=?',[requestId]);if(old){if(old.session_id!==s.id)throw new ApiError(409,'请求标识冲突');return json({saved:true,duplicate:true});}
   const lock=await one('UPDATE study_sessions SET busy_until=? WHERE id=? AND busy_until<? AND finished IS NULL RETURNING id',[now()+75000,s.id,now()]);if(!lock)throw new ApiError(409,'上一条消息正在处理中，请稍后');const messageId=uid();
   try{
    const history=await all('SELECT role,text FROM messages WHERE session_id=? ORDER BY seq',[s.id]);if(history.reduce((a,r)=>a+r.text.length,0)+text.length>160000)throw new ApiError(400,'当前对话已达到长度上限，请提交代码');
    const context=[{role:'system',content:'你是一名 Python 编程助手。请根据用户的问题提供帮助。'},...history.map(m=>({role:m.role,content:m.text})),{role:'user',content:text}];
    await db().batch([stmt('INSERT INTO messages(id,session_id,role,text,created,request_id,reply_status,context_json,provider,model) VALUES(?,?,?,?,?,?,?,?,?,?)',[messageId,s.id,'user',text,now(),requestId,'pending',JSON.stringify({messages:context,temperature:cfg.chatTemperature,model:cfg.chatModel}),cfg.chatBaseUrl,cfg.chatModel]),stmt('INSERT INTO jobs(id,kind,target_id,status,created) VALUES(?,?,?,?,?)',[uid(),'prompt',messageId,'pending',now()])]);background(processJobs(2));
    const result=await completion(cfg,'chat',context);
    await db().batch([stmt('INSERT INTO messages(id,session_id,role,text,created,context_json,provider,model) VALUES(?,?,?,?,?,?,?,?)',[uid(),s.id,'assistant',result.text,now(),JSON.stringify({usage:result.usage}),result.provider,result.model]),stmt("UPDATE messages SET reply_status='completed' WHERE id=?",[messageId])]);return json({saved:true});
   }catch(e){await run("UPDATE messages SET reply_status='failed',error=? WHERE id=?",[e instanceof ApiError?e.message:'AI 连接失败；Prompt 已保存',messageId]);throw e;}finally{await run('UPDATE study_sessions SET busy_until=0 WHERE id=?',[s.id]);}
  }
  if(path==='submissions'&&method==='POST'){
   const form=await req.formData(),s=await ownedSession(req,str(form.get('sessionId'),80));if(s.finished)throw new ApiError(409,'本任务已经提交');if(s.busy_until>now())throw new ApiError(409,'请等待当前对话结束后提交');if(!(await settings()).studyOpen)throw new ApiError(403,'实验当前暂停');
   const file=form.get('code');if(!(file instanceof File)||!file.name.endsWith('.py')||file.size>200000||file.size===0)throw new ApiError(400,'请上传不超过 200 KB 的 .py 文件');const code=await file.text();if(code.includes('\u0000'))throw new ApiError(400,'代码文件必须是文本');const id=uid(),key='submissions/'+id+'/code.py',artifacts=[];const extras=form.getAll('artifacts').filter(f=>f instanceof File&&f.size>0);if(extras.length>3)throw new ApiError(400,'最多上传 3 个结果文件');for(const f of extras){if(!(f instanceof File)||f.size>5*1024*1024||!/\.(csv|xlsx|txt|md|json)$/i.test(f.name))throw new ApiError(400,'结果文件支持 CSV、XLSX、TXT、MD 或 JSON，每份最大 5 MB');}
   await bindings().BUCKET.put(key,code,{httpMetadata:{contentType:'text/plain; charset=utf-8'}});
   for(const f of extras as File[]){const artifactKey='submissions/'+id+'/'+uid();await bindings().BUCKET.put(artifactKey,await f.arrayBuffer());artifacts.push({key:artifactKey,name:f.name,size:f.size});}
   const claimed=await one('UPDATE study_sessions SET finished=? WHERE id=? AND finished IS NULL AND busy_until<? RETURNING id',[now(),s.id,now()]);if(!claimed)throw new ApiError(409,'任务状态已改变，请刷新');
   try{await db().batch([stmt('INSERT INTO submissions(id,session_id,file_key,filename,code_sha,explanation,artifacts,created) VALUES(?,?,?,?,?,?,?,?)',[id,s.id,key,file.name,await sha(code),str(String(form.get('explanation')||''),6000,false),JSON.stringify(artifacts),now()]),stmt('INSERT INTO jobs(id,kind,target_id,status,created) VALUES(?,?,?,?,?)',[uid(),'code',id,'pending',now()])]);}catch(e){await run('UPDATE study_sessions SET finished=NULL WHERE id=?',[s.id]);throw e;}
   background(processJobs(2));return json({id,submitted:true});
  }
  if(path==='materials'&&method==='GET'){
   const auth=await session(req),task=await one('SELECT * FROM tasks WHERE id=?',[u.searchParams.get('task')]);let materials:Row[]=[];if(auth.role==='admin'&&task)materials=JSON.parse(task.materials);else if(auth.role==='student'){const s=await one('SELECT task_snapshot FROM study_sessions WHERE participant_id=? AND task_id=?',[auth.participant_id,u.searchParams.get('task')]);if(s)materials=JSON.parse(JSON.parse(s.task_snapshot).materials);else if(task?.published)materials=JSON.parse(task.materials);}
   const file=materials.find(m=>m.key===u.searchParams.get('key'));if(!file)throw new ApiError(404,'文件不存在');return await objectDownload(file.key,file.name);
  }
  if(path.startsWith('admin/')){
   await session(req,'admin');
   if(path==='admin/overview'&&method==='GET'){background(processJobs(2));return json({counts:{participants:(await one('SELECT COUNT(*) AS n FROM participants'))?.n,prompts:(await one("SELECT COUNT(*) AS n FROM messages WHERE role='user'"))?.n,submissions:(await one('SELECT COUNT(*) AS n FROM submissions'))?.n,completed:(await one("SELECT COUNT(*) AS n FROM jobs WHERE status='completed'"))?.n,pending:(await one("SELECT COUNT(*) AS n FROM jobs WHERE status!='completed'"))?.n},settings:await settings(),recent:await all(promptQuery+' ORDER BY m.seq DESC LIMIT 6')});}
   if(path==='admin/participants'&&method==='GET')return json({participants:await all("SELECT p.id,p.seq,p.name,p.email,p.created,p.last_seen,(SELECT COUNT(*) FROM messages m JOIN study_sessions s ON s.id=m.session_id WHERE s.participant_id=p.id AND m.role='user') AS prompt_count,(SELECT COUNT(*) FROM submissions b JOIN study_sessions s ON s.id=b.session_id WHERE s.participant_id=p.id) AS submission_count FROM participants p ORDER BY p.seq")});
   if(path==='admin/participant'&&method==='GET'){const id=u.searchParams.get('id');return json({participant:await one('SELECT id,seq,name,email,created,last_seen FROM participants WHERE id=?',[id]),sessions:await all('SELECT * FROM study_sessions WHERE participant_id=?',[id]),messages:await all('SELECT m.* FROM messages m JOIN study_sessions e ON e.id=m.session_id WHERE e.participant_id=? ORDER BY m.seq',[id])});}
   if(path==='admin/prompts'&&method==='GET'){const offset=Math.max(0,Number(u.searchParams.get('offset'))||0);return json({prompts:await all(promptQuery+' ORDER BY m.seq DESC LIMIT 100 OFFSET ?',[offset]),total:(await one("SELECT COUNT(*) AS n FROM messages WHERE role='user'"))?.n});}
   if(path==='admin/submissions'&&method==='GET')return json({submissions:await all("SELECT s.*,e.participant_id,p.seq AS student_no,json_extract(e.task_snapshot,'$.title') AS task_title,j.status,j.score,j.error FROM submissions s JOIN study_sessions e ON e.id=s.session_id JOIN participants p ON p.id=e.participant_id LEFT JOIN jobs j ON j.target_id=s.id AND j.kind='code' ORDER BY s.created DESC")});
   if(path==='admin/tasks'&&method==='GET')return json({tasks:await all('SELECT * FROM tasks ORDER BY sort')});
   if(path==='admin/tasks'&&method==='POST'){
    const d=await body(req),id=d.id?str(d.id,64):uid(),title=str(d.title,100),content=str(d.content,30000),rubric=str(d.rubric,30000),minutes=Number(d.minutes);if(!Number.isInteger(minutes)||minutes<5||minutes>240)throw new ApiError(400,'时长须为 5–240 分钟');
    await run('INSERT INTO tasks(id,title,content,rubric,minutes,sort,published,version,materials,updated) VALUES(?,?,?,?,?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,content=excluded.content,rubric=excluded.rubric,minutes=excluded.minutes,published=excluded.published,version=tasks.version+1,updated=excluded.updated',[id,title,content,rubric,minutes,Number(d.sort)||3,d.published?1:0,'[]',now()]);return json({id,saved:true});
   }
   if(path==='admin/materials'&&method==='POST'){
    const f=await req.formData(),id=str(f.get('taskId'),64),task=await one('SELECT * FROM tasks WHERE id=?',[id]),file=f.get('file');if(!task)throw new ApiError(404,'任务不存在');if(!(file instanceof File)||file.size>10*1024*1024||!/\.(xlsx|csv|txt|md|json|pdf|zip)$/i.test(file.name))throw new ApiError(400,'文件须为 XLSX / CSV / TXT / MD / JSON / PDF / ZIP，且小于 10 MB');const materials=JSON.parse(task.materials);if(materials.length>=8)throw new ApiError(400,'每个任务最多 8 个材料');const key='materials/'+id+'/'+uid();await bindings().BUCKET.put(key,await file.arrayBuffer());materials.push({key,name:file.name,size:file.size});await run('UPDATE tasks SET materials=?,version=version+1,updated=? WHERE id=?',[JSON.stringify(materials),now(),id]);return json({saved:true});
   }
   if(path==='admin/settings'&&method==='GET')return json(await settings());
   if(path==='admin/settings'&&method==='POST'){
    const d=await body(req);for(const key of ['googleClientId','chatBaseUrl','chatModel','gradeBaseUrl','gradeModel','promptosUrl'])if(d[key]!==undefined){const value=str(d[key],1000,false);if(key.endsWith('Url')&&value)httpsUrl(value);if(key==='googleClientId'&&value&&!value.endsWith('.apps.googleusercontent.com'))throw new ApiError(400,'Google Client ID 格式不正确');await putSetting(key,JSON.stringify(value));}
    for(const key of ['studyOpen','promptosEnabled'])if(typeof d[key]==='boolean')await putSetting(key,JSON.stringify(d[key]));
    if(d.chatTemperature!==undefined){const n=Number(d.chatTemperature);if(!Number.isFinite(n)||n<0||n>2)throw new ApiError(400,'Temperature 须在 0–2 之间');await putSetting('chatTemperature',JSON.stringify(n));}
    for(const key of ['chatKey','gradeKey','promptosKey'])if(typeof d[key]==='string'&&d[key].trim())await putSetting(key,await encrypt(str(d[key],1000)));
    if(d.newPassword){const p=str(d.newPassword,256);if(p.length<16)throw new ApiError(400,'管理口令至少 16 个字符');await putSetting('adminPasswordHash',JSON.stringify(await sha(p)));}
    await run("UPDATE jobs SET status='pending',attempts=0 WHERE status='blocked'");background(processJobs(2));return json({saved:true});
   }
   if(path==='admin/queue'&&method==='GET')return json({jobs:await all('SELECT id,kind,target_id,status,attempts,error,score,created,completed FROM jobs ORDER BY created DESC LIMIT 200'),counts:await all('SELECT status,COUNT(*) AS n FROM jobs GROUP BY status')});
   if(path==='admin/queue'&&method==='POST'){const d=await body(req);if(d.retry)await run("UPDATE jobs SET status='pending',attempts=0,lease_until=0 WHERE status IN ('failed','blocked')");return json(await processJobs(2));}
   if(path==='admin/export'&&method==='GET'){
    const type=u.searchParams.get('type')||'prompts';if(type==='interactions'){const rows=await all('SELECT m.*,e.participant_id,e.task_snapshot FROM messages m JOIN study_sessions e ON e.id=m.session_id ORDER BY m.seq');return download(JSON.stringify(rows,null,2),'interactions.json','application/json; charset=utf-8');}
    const rows=type==='participants'?await all('SELECT seq,id,name,email,created,last_seen FROM participants ORDER BY seq'):await all(promptQuery+' ORDER BY m.seq');
    const columns=type==='participants'?['seq','id','name','email','created','last_seen']:['record_no','student_no','student_id','task_id','task_version','prompt_id','session_id','prompt','created','reply_status','chat_provider','chat_model','score_status','score','result_json','score_error','scoring_provider','scoring_model','scored_at'];return download(csv(rows,columns),type+'.csv','text/csv; charset=utf-8');
   }
   if(path==='admin/download'&&method==='GET'){const id=u.searchParams.get('id')||'',kind=u.searchParams.get('kind');if(kind==='grade')return download(await gradeMarkdown(id),'grade-'+id+'.md','text/markdown; charset=utf-8');const s=await one('SELECT * FROM submissions WHERE id=?',[id]);if(!s)throw new ApiError(404,'提交不存在');if(kind==='artifact'){const f=JSON.parse(s.artifacts).find((a:Row)=>a.key===u.searchParams.get('key'));if(!f)throw new ApiError(404,'文件不存在');return await objectDownload(f.key,f.name);}return await objectDownload(s.file_key,s.filename);}
   if(path==='admin/test'&&method==='POST'){const d=await body(req),cfg=await settings(true);if(d.kind==='promptos'){const r=await fetch(httpsUrl(cfg.promptosUrl),{method:'POST',redirect:'manual',headers:{'Content-Type':'application/json',...(cfg.promptosKey?{Authorization:'Bearer '+cfg.promptosKey}:{})},body:JSON.stringify({prompt:'Write a Python function that adds two integers. Include an example.'}),signal:AbortSignal.timeout(20000)});if(!r.ok)throw new ApiError(502,'PromptOS 返回 HTTP '+r.status);const result=await r.json() as Row;if(typeof result.overallScore!=='number')throw new ApiError(502,'响应没有 overallScore');return json({ok:true,message:'PromptOS 连接成功；测试数据未写入实验记录'});}if(!['chat','grade'].includes(d.kind))throw new ApiError(400,'无效服务');await completion(cfg,d.kind,[{role:'user',content:'Reply with OK.'}],20000);return json({ok:true,message:'连接成功；测试数据未写入实验记录'});}
  }
  throw new ApiError(404,'接口不存在');
 }catch(error){if(!(error instanceof ApiError))console.error("Request failed",{route:new URL(req.url).pathname,type:error instanceof Error?error.name:"Unknown"});return json({error:error instanceof ApiError?error.message:'服务暂时不可用，请稍后重试'},error instanceof ApiError?error.status:500);}
}
async function objectDownload(key:string,name:string){const obj=await bindings().BUCKET.get(key);if(!obj)throw new ApiError(404,'文件不存在');return new Response(obj.body,{headers:{'Content-Type':'application/octet-stream','Content-Disposition':`attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(name)}`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export {api as GET,api as POST};
