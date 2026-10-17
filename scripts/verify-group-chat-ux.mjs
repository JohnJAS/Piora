import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const require = createRequire(import.meta.url);
const repo = process.cwd();
const output = path.resolve(".verification/group-chat-ux");
mkdirSync(output, { recursive: true });
const webpack = require("next/dist/compiled/webpack/webpack").webpack;
const results = [], errors = [];
const check = (name, condition) => { assert.ok(condition, name); results.push(name); console.log(`PASS ${name}`); };

writeFileSync(path.join(output, "fixture.tsx"), `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {I18nProvider} from '@/hooks/useI18n';
import {RoomWorkspace} from '@/components/RoomWorkspace';
import {RoomSidebarSection} from '@/components/RoomSidebarSection';
const roomId='11111111-1111-4111-8111-111111111111';
const runId='22222222-2222-4222-8222-222222222222';
const now=Date.now();
const profiles=[['m0','s0','阿策','coordinator','组织分工与汇总'],['m1','s1','小研','worker','完成任务与验证'],['m2','s2','小审','reviewer','检查结果与遗漏']];
const members=profiles.map(([memberId,sessionId,name,role,roleDescription])=>({memberId,profile:{schemaVersion:1,revision:1,name,role,roleDescription,systemPrompt:'',personality:[],capabilities:[],constraints:[],modelPolicy:{mode:'session'},toolPolicy:{mode:'inherit'},skillPolicy:{mode:'inherit'},workspacePolicy:{mode:'shared',integration:'artifact_only'},memoryPolicy:{recentRoomMessages:20,includePrivateNotes:false,retainAcrossRuns:true}},binding:{sessionId,cwd:'/workspace/project',projectRoot:'/workspace/project',managedByPiora:true,boundAt:now,status:'ready'},joinedAt:now}));
const room={schemaVersion:3,id:roomId,name:'Piora 界面改版',description:'完成设置页设计方案',projectRoot:'/workspace/project',createdAt:now-600000,updatedAt:now,nextSeq:6,members,coordination:{mode:'team',coordinatorMemberId:'m0',defaultReviewerMemberIds:['m2'],maxConcurrency:3},workspace:{mode:'managed',path:'/workspace/project',label:'Piora'},paths:{shared:'F:/fixture/shared',root:'F:/fixture',privateRoot:'F:/fixture/private'}};
const msg=(id,seq,author,content,extra={})=>({id,roomId,seq,author:{id:author,kind:author==='you'?'user':'session',name:author==='you'?'你':members.find(m=>m.binding.sessionId===author)?.profile.name},content,payload:{byteLength:content.length*3,lineCount:1,sha256:id,truncated:false},createdAt:now+seq*1000,...extra});
const tasks=Object.fromEntries(['整理竞品资料','梳理现有问题','检查交互遗漏','汇总设计方案'].map((title,i)=>['t'+i,{id:'t'+i,title,description:title,status:i<2?'completed':i===2?'running':'pending',assignedMemberId:['m1','m0','m2','m0'][i]}]));
const run={schemaVersion:1,id:runId,roomId,revision:4,objective:'设置页改版',phase:'running',createdBy:{kind:'user',id:'s0'},coordinatorMemberId:'m0',tasks,successCriteria:[],activeDispatches:{},evidence:{},artifacts:{a1:{id:'a1',roomId,teamRunId:runId,taskId:'t0',memberId:'m1',kind:'report',name:'竞品观察.md',summary:'竞品交互研究与结论',createdAt:now}},reviewDecisions:{},finalArtifactIds:[],schedulingSteps:2,createdAt:now,updatedAt:now};
const initial={room,run,messages:[msg('u1',1,'you','帮我重新设计设置页，先给方案。'),msg('a1',2,'s0','我来组织。小研整理竞品，小审检查交互遗漏。'),msg('a2',3,'s1','资料已整理：建议统一入口，并让任务交接更清楚。'),msg('h1',4,'s1','检查方案覆盖情况',{kind:'handoff',teamRunId:runId,taskId:'t2',targetMemberIds:['m2']})],submissions:[]};
const state=structuredClone(initial);
const sources=[];
const originalFetch=window.fetch.bind(window);
const snapshot=()=>({type:'snapshot',room:state.room,messages:state.messages,tasks:[],artifacts:[]});
const activity=()=>({sessionId:'s2',runId:'live-review',status:state.run.phase==='running'?'working':'ended',phase:'正在检查 3 个交互场景',text:'',thinking:'检查建群、补充指令与问题回复。',tools:[{id:'read1',name:'read',status:'completed',input:'{"path":"docs/design/group-chat-ux.md"}',output:'已读取设计方案'}],browser:false,startedAt:now+4500,updatedAt:now+5000});
function emit(){for(const source of sources){if(source.closed)continue;if(source.url.includes('/runs/'))source.fire('snapshot',{run:state.run});else{source.onmessage?.({data:JSON.stringify(snapshot())});source.onmessage?.({data:JSON.stringify({type:'activity',activities:[activity()]})});}}}
window.EventSource=class{constructor(url){this.url=url;this.listeners={};sources.push(this);setTimeout(()=>{if(this.closed)return;this.onopen?.();if(url.includes('/runs/'))this.fire('snapshot',{run:state.run});else{this.onmessage?.({data:JSON.stringify(snapshot())});this.onmessage?.({data:JSON.stringify({type:'activity',activities:[activity()]})});}},0)}addEventListener(name,fn){(this.listeners[name]??=[]).push(fn)}fire(name,value){for(const fn of this.listeners[name]??[])fn({data:JSON.stringify(value)})}close(){this.closed=true}};
const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
window.ux={state,submissions:[],failNext:false,holdNext:false,release:null,emit,
 reset(){const revision=state.run.revision+1;Object.assign(state,structuredClone(initial));state.run.revision=revision;window.ux.remount?.();emit()},
 waiting(){state.run.phase='waiting_user';state.run.revision++;state.messages.push(msg('question',state.messages.length+1,'s2','需要你的回答\\n\\n需要保留现有导航结构吗？',{kind:'question',teamRunId:runId,correlationId:'team:'+runId+':question:0'}));emit()},
 complete(){state.run.phase='completed';state.run.revision++;for(const task of Object.values(state.run.tasks))task.status='completed';state.messages.push(msg('delivery',state.messages.length+1,'s0','方案已整理完成，包含主界面、建群与任务交互。',{kind:'delivery',teamRunId:runId}));emit()},
 longHistory(){state.messages=Array.from({length:160},(_,i)=>msg('history'+i,i+1,i%2?'s0':'you','第 '+i+' 条历史消息：'+('检查交互与长段落阅读。'.repeat(7))));emit()},
};
window.fetch=async(url,init)=>{
 const value=String(url);const u=new URL(value,location.href);
 if(!u.pathname.startsWith('/api/'))return originalFetch(url,init);
 if(init?.method==='POST'){
   if(u.pathname==='/api/rooms'){
     const body=JSON.parse(init.body);window.ux.submissions.push({type:'create',...body});
     if(window.ux.failNext){window.ux.failNext=false;return json({error:'准备工作区失败，请重试。'},500)}
     return json({room:{...state.room,id:'33333333-3333-4333-8333-333333333333',name:body.name}},201);
   }
   if(u.pathname==='/api/default-cwd')return json({cwd:'/workspace/project'});
   if(u.pathname.endsWith('/messages')){
     const body=JSON.parse(init.body);window.ux.submissions.push(body);
     if(window.ux.holdNext){window.ux.holdNext=false;await new Promise(resolve=>window.ux.release=resolve)}
     if(window.ux.failNext){window.ux.failNext=false;throw new Error('测试断网：消息未确认送达')}
     const existing=state.submissions.find(s=>s.clientPromptId===body.clientPromptId);
     if(existing)return json({message:state.messages.find(m=>m.id===existing.messageId),submission:existing});
     const parent=state.messages.find(m=>m.id===body.replyTo);
     const message=msg(crypto.randomUUID(),state.messages.length+1,'you',body.content,{clientPromptId:body.clientPromptId,replyTo:body.replyTo,threadRootId:parent?.threadRootId??parent?.id,attachments:body.attachments});
     state.messages.push(message);
     if(body.intent==='answer'){state.run.phase='running';state.run.revision++}
     const submission={clientPromptId:body.clientPromptId,messageId:message.id,roomId:state.room.id,intent:body.intent,status:body.intent==='new_task'?'queued':'delivered',teamRunId:body.intent==='new_task'?undefined:runId,targetMemberIds:body.mentions?.map(m=>m.memberId)??[],commandIds:[],createdAt:Date.now(),updatedAt:Date.now()};
     state.submissions.push(submission);emit();return json({message,submission},201);
   }
   if(u.pathname.endsWith('/cancel')&&window.ux.failStop){window.ux.failStop=false;state.run.stopRequested={reason:'用户停止',commandIds:['owned-command'],at:Date.now()};state.run.phase='interrupted';state.run.revision++;emit();return json({error:'部分成员尚未确认停止，请重试停止。任务队列暂不推进。'},500)}
   if(u.pathname.endsWith('/cancel')||u.pathname.endsWith('/resume')){delete state.run.stopRequested;state.run.phase=u.pathname.endsWith('/cancel')?'cancelled':'running';state.run.revision++;emit();return json({run:state.run})}
   return json({});
 }
 if(u.pathname==='/api/rooms')return json({rooms:[{...state.room,summary:{lastMessage:{author:'小研',content:'竞品资料已整理',seq:4},phase:state.run.phase}},{...state.room,id:'other',name:'发布准备',updatedAt:now-10000,summary:{lastMessage:{author:'阿策',content:'下周一发布',seq:2}}},{...state.room,id:'docs',name:'文档整理',updatedAt:now-20000,summary:{lastMessage:{author:'小审',content:'已更新文档',seq:2}}}]});
 if(u.pathname.endsWith('/runs'))return json({runs:[state.run]});
 if(u.pathname.includes('/runs/'))return json({run:state.run});
 if(u.pathname.endsWith('/messages'))return json({messages:state.messages,submissions:state.submissions});
 return json(snapshot());
};
function App(){const [selected,setSelected]=useState(state.room);const [version,setVersion]=useState(0);window.ux.remount=()=>setVersion(value=>value+1);return <I18nProvider><div className="ux-app"><div className="ux-title">Piora<span>—　□　×</span></div><div className="ux-body"><aside className="ux-sidebar"><RoomSidebarSection sessions={[]} selectedSessionId={null} selectedRoomId={selected.id} activeProjectRoot="/workspace/project" onSelectRoom={setSelected}/><span className="ux-settings">⚙　设置</span></aside><main><RoomWorkspace key={version} initialRoom={selected} onRoomDeleted={()=>{}} onOpenBrowser={(id)=>window.ux.browser=id}/></main></div></div></I18nProvider>}
createRoot(document.getElementById('root')).render(<App/>);
`);

writeFileSync(path.join(output, "loader.cjs"), `const ts=require(${JSON.stringify(require.resolve("typescript"))});module.exports=s=>ts.transpileModule(s,{compilerOptions:{jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;`);
writeFileSync(path.join(output, "css-loader.cjs"), `const path=require('node:path');module.exports=function(source){const prefix=path.basename(this.resourcePath).replace(/[^a-zA-Z]/g,'')+'_';const names={};const css=source.replace(/:global\\(([^)]+)\\)|\\.([a-zA-Z][\\w-]*)/g,(all,global,name)=>{if(global)return global;names[name]=prefix+name;return '.'+prefix+name});return 'const style=document.createElement("style");style.textContent='+JSON.stringify(css)+';document.head.append(style);export default '+JSON.stringify(names)};`);
await new Promise((resolve, reject) => {
  const compiler = webpack({ mode: "development", target: "web", devtool: false, entry: path.join(output, "fixture.tsx"),
    output: { path: output, filename: "fixture.js", publicPath: "/" },
    resolve: { extensions: [".tsx", ".ts", ".js"], alias: { "@": repo } },
    module: { rules: [{ test: /\.tsx?$/, exclude: /node_modules/, use: path.join(output, "loader.cjs") }, { test: /\.css$/, use: path.join(output, "css-loader.cjs") }] },
  });
  compiler.run((error, stats) => compiler.close(() => error || stats?.hasErrors() ? reject(error || new Error(stats.toString({ all: false, errors: true }))) : resolve()));
});

const globalCss = readFileSync(path.join(repo, "app/globals.css"), "utf8").replace(/@import[^;]+;/gu, "");
writeFileSync(path.join(output, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Piora 群聊 UX 验收</title><style>${globalCss}</style><style>
*{box-sizing:border-box}html,body,#root{margin:0;width:100%;height:100%;overflow:hidden}body{font:14px/1.5 'Inter','Microsoft YaHei UI',sans-serif;color:var(--text);background:var(--bg)}button,input,textarea,select{font:inherit}button{cursor:pointer}.ux-app{height:100dvh;display:flex;flex-direction:column}.ux-title{display:flex;align-items:center;justify-content:space-between;height:43px;flex:0 0 auto;padding:0 22px;border-bottom:1px solid var(--border);font-size:21px;font-weight:550}.ux-title>span{font-size:13px;color:var(--text-muted);letter-spacing:12px}.ux-body{display:flex;flex:1;min-height:0}.ux-sidebar{display:flex;flex-direction:column;width:260px;flex:0 0 auto;background:var(--bg-panel);border-right:1px solid var(--border);padding-top:14px}.ux-sidebar>section{border-bottom:0}.ux-settings{margin-top:auto;padding:25px;color:var(--text-muted)}main{flex:1;min-width:0;min-height:0}.ux-sidebar [class*="heading"]{font-size:16px;padding-bottom:16px;color:var(--text)}.ux-sidebar [class*="roomMain"]{min-height:72px}.ux-sidebar [class*="roomCopy"] strong{font-size:14px}.ux-sidebar [class*="roomCopy"] small{font-size:11px}@media(max-width:820px){.ux-sidebar{display:none}.ux-title{height:36px;font-size:16px;padding:0 14px}}
</style><div id="root"></div><script>localStorage.setItem('pi-locale','zh-CN');</script><script src="/fixture.js"></script></html>`);

const server = createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  const file = url.pathname === "/" ? path.join(output, "index.html") : path.join(output, decodeURIComponent(url.pathname));
  const publicFile = path.join(repo, "public", decodeURIComponent(url.pathname));
  const resolved = existsSync(file) && file.startsWith(output) ? file : existsSync(publicFile) && publicFile.startsWith(path.join(repo, "public")) ? publicFile : undefined;
  if (!resolved) { response.writeHead(404); response.end(); return; }
  const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".woff2": "font/woff2", ".woff": "font/woff", ".png": "image/png" }[path.extname(resolved)] ?? "application/octet-stream";
  response.setHeader("Content-Type", mime); response.end(readFileSync(resolved));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: "msedge", headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.on("pageerror", (error) => errors.push(String(error)));
const screenshot = async (name) => { await page.evaluate(() => document.fonts.ready); await page.screenshot({ path: path.join(output, `${name}.png`), animations: "disabled" }); };
try {
  await page.goto(origin);
  await page.getByRole("heading", { name: "Piora 界面改版", exact: true }).waitFor();
  await page.getByText("正在检查 3 个交互场景", { exact: true }).waitFor();
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("heading", { name: "任务详情" }).waitFor();
  check("主界面只有一个输入框与一张活跃任务卡", await page.locator("textarea").count() === 1 && await page.locator("[data-room-task-summary]").count() === 1);
  check("成员交接与成果入口可见", await page.getByText("检查方案覆盖情况", { exact: true }).isVisible() && await page.getByRole("link", { name: /竞品观察/ }).isVisible());
  check("执行细节默认收起", await page.locator("[data-room-activity] details").first().evaluate((element) => !element.open));
  await screenshot("desktop-main");
  await page.getByRole("button", { name: "新建群聊", exact: true }).click();
  await page.getByRole("dialog", { name: "新建群聊" }).waitFor();
  check("零历史会话仍可创建默认团队", await page.getByRole("button", { name: "创建群聊", exact: true }).isEnabled());
  await screenshot("desktop-create");
  await page.getByRole("button", { name: /自定义 自由选择成员/ }).click();
  check("自定义成员可编辑职责与名称", await page.getByRole("textbox", { name: "成员名称 1" }).isVisible());
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  const input = page.getByRole("textbox", { name: "发消息，或输入 @ 指定成员……" });
  const beforeComposition = await page.evaluate(() => window.ux.submissions.length);
  await input.fill("中文输入中");
  await input.dispatchEvent("compositionstart");
  await input.dispatchEvent("keydown", { key: "Enter", code: "Enter", keyCode: 229, isComposing: true });
  await input.dispatchEvent("compositionend");
  check("中文输入法确认不会误发送", await page.evaluate(() => window.ux.submissions.length) === beforeComposition);
  await input.fill("@小");
  await page.getByRole("option", { name: /小审/ }).click();
  await input.press("End"); await input.type("只检查交互");
  await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(() => window.ux.submissions.some((input) => input.content?.includes("只检查交互")));
  check("提及传递稳定成员 ID", await page.evaluate(() => window.ux.submissions.at(-1).mentions[0]?.memberId === "m2"));
  await page.evaluate(() => window.ux.waiting());
  await page.getByRole("button", { name: "回复这个问题", exact: true }).first().waitFor();
  await screenshot("desktop-question");
  await input.fill("补充：保留现有主题"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(() => window.ux.submissions.some((input) => input.content === "补充：保留现有主题"));
  check("无关群消息不会恢复等待问题", await page.evaluate(() => window.ux.state.run.phase === "waiting_user"));
  await page.getByRole("button", { name: "回复这个问题", exact: true }).first().click();
  await input.fill("保留导航，优化群聊交互。"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(() => window.ux.state.run.phase === "running");
  check("问题回复关联具体问题并恢复", await page.evaluate(() => { const input=window.ux.submissions.at(-1);return input.intent==='answer'&&input.replyTo==='question'; }));
  await page.evaluate(() => window.ux.holdNext = true);
  await input.fill("先处理这个补充"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(() => Boolean(window.ux.release));
  await input.fill("这是发送期间的新草稿");
  await page.evaluate(() => window.ux.release());
  await page.getByRole("button", { name: "发送", exact: true }).waitFor({ state: "visible" });
  check("发送回执不覆盖后续新输入", await input.inputValue() === "这是发送期间的新草稿");
  await page.evaluate(() => window.ux.failNext = true);
  await input.fill("断网后需要恢复的原文"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "测试断网" }).waitFor();
  check("断网保留原文与恢复入口", await input.inputValue() === "断网后需要恢复的原文" && await page.getByText("尚未确认送达，可重试发送", { exact: true }).isVisible());
  await screenshot("desktop-recovery");
  await page.reload();
  await page.getByText("尚未确认送达，可重试发送", { exact: true }).waitFor();
  check("刷新后恢复原文", await input.inputValue() === "断网后需要恢复的原文");
  await page.getByRole("button", { name: "重试未完成项", exact: true }).click();
  await page.waitForFunction(() => window.ux.state.messages.some((message) => message.content === "断网后需要恢复的原文"));
  await page.getByText("尚未确认送达，可重试发送", { exact: true }).waitFor({ state: "hidden" });
  check("恢复重试成功后清除同一份草稿", await input.inputValue() === "");
  await input.fill("");
  await page.getByRole("button", { name: "新任务", exact: true }).click();
  await input.fill("下一轮独立任务"); await page.getByRole("button", { name: "发送", exact: true }).click();
  await page.waitForFunction(() => window.ux.state.submissions.some((input) => input.status === "queued"));
  check("独立目标进入任务队列", await page.evaluate(() => window.ux.submissions.at(-1).intent === "new_task"));
  await page.evaluate(() => window.ux.complete());
  await page.getByText("交付结果", { exact: true }).waitFor();
  await screenshot("desktop-delivery");
  check("完成后有一份权威交付与成果", await page.getByText("交付结果", { exact: true }).count() === 1 && await page.locator("[data-room-task-summary]").count() === 0);
  await page.evaluate(() => window.ux.reset());
  await page.evaluate(() => window.dispatchEvent(new Event("online")));
  await page.locator("[data-room-task-summary]").waitFor();
  await page.evaluate(() => { window.ux.failStop = true; });
  await page.locator("[data-room-task-summary]").getByRole("button", { name: "停止", exact: true }).click();
  await page.locator("[data-room-task-summary]").getByText("等待停止确认", { exact: true }).waitFor();
  check("取消失败时保留停止确认状态与重试入口", await page.locator("[data-room-task-summary]").getByRole("button", { name: "重试停止", exact: true }).isVisible()
    && await page.locator("[data-room-task-summary]").getByRole("button", { name: "继续运行", exact: true }).count() === 0);
  await screenshot("desktop-stopping");
  await page.locator("[data-room-task-summary]").getByRole("button", { name: "重试停止", exact: true }).click();
  await page.locator("[data-room-task-summary]").waitFor({ state: "hidden" });
  check("确认停止后才移除活跃任务卡", await page.evaluate(() => window.ux.state.run.phase === "cancelled" && !window.ux.state.run.stopRequested));
  await page.evaluate(() => { window.ux.reset(); window.dispatchEvent(new Event("online")); });
  await page.locator("[data-room-task-summary]").waitFor();
  await page.setViewportSize({ width: 820, height: 1000 });
  await screenshot("tablet-main");
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("dialog", { name: "任务详情", exact: true }).waitFor();
  await screenshot("tablet-details");
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  check("390px 无横向溢出", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await screenshot("mobile-main");
  await page.getByRole("button", { name: "任务", exact: true }).click();
  await page.getByRole("dialog", { name: "任务详情", exact: true }).waitFor();
  await screenshot("mobile-details");
  await page.keyboard.press("Escape");
  check("窄屏抽屉支持 Escape 关闭", await page.getByRole("dialog", { name: "任务详情", exact: true }).count() === 0);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => document.documentElement.classList.add("dark"));
  await screenshot("desktop-dark");
  await page.evaluate(() => { document.documentElement.classList.remove("dark"); window.ux.longHistory(); });
  await page.locator("[data-room-message-list]").evaluate((element) => { element.scrollTop=250; element.dispatchEvent(new Event('scroll')); });
  const oldTop=await page.locator("[data-room-message-list]").evaluate((element) => element.scrollTop);
  await page.evaluate(() => { const state=window.ux.state;state.messages.push({...state.messages.at(-1),id:'late',seq:999,content:'后来到达的消息'});window.ux.emit(); });
  check("阅读历史时新消息不会抢走滚动位置", await page.locator("[data-room-message-list]").evaluate((element,top) => Math.abs(element.scrollTop-top)<4, oldTop));
  check("无未捕获浏览器错误", errors.length === 0);
  writeFileSync(path.join(output, "report.json"), JSON.stringify({ status: "passed", results, errors, note: "Uses production React components and styles with isolated API/SSE fixtures. Backend contracts are tested separately." }, null, 2));
} catch (error) {
  await screenshot("failure");
  writeFileSync(path.join(output, "report.json"), JSON.stringify({ status: "failed", results, errors, failure: String(error) }, null, 2));
  console.error(errors); throw error;
} finally {
  await browser.close(); await new Promise((resolve) => server.close(resolve));
}
