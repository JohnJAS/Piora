import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { createJiti } from 'jiti';
const jiti=createJiti(import.meta.url);
const { actionCatalog,actionSchema,actionDescriptor }=await jiti.import('../lib/harmony/contracts/actions.ts');
const { scenarioTemplates,bindScenarioTemplate }=await jiti.import('../lib/harmony/scenario/templates.ts');
const descriptors=Object.keys(actionCatalog).map(action=>({ ...actionDescriptor(action), schemas:Object.fromEntries(['direct','scenario'].filter(mode=>mode in actionCatalog[action]).map(mode=>[mode,actionSchema(action,mode)])) }));
for(const template of scenarioTemplates) bindScenarioTemplate(template.id,template.parameters);
const markdown=`# 动作与参数目录\n\n由 \`npm run harmony:docs\` 从动作注册表生成。注册动作不等于当前设备支持；请先查看工作台 doctor 返回的状态和证据级别。完整机器可读参数见 [actions.json](actions.json)。\n\n| 动作 | 入口 | 风险 | 含义 |\n| --- | --- | --- | --- |\n${descriptors.map(value=>`| \`${value.action}\` | ${value.modes.join(', ')} | ${value.risk} | ${value.description} |`).join('\n')}\n\n所有写入在实际发送前复核租约和策略。已发送或效果不明的写入不自动重放。物理按键、保持和声学路线必须校准；未验证机型见 [兼容矩阵](compatibility.md)。\n\n## 场景模板\n\n${scenarioTemplates.map(template=>`- [${template.title}](../../lib/harmony/scenario/templates/${template.id}.json)（流程版本 ${template.version}）`).join('\n')}\n`;
await mkdir('docs/harmony',{recursive:true});
for(const [path,content] of [['docs/harmony/capabilities.md',markdown],['docs/harmony/actions.json',JSON.stringify({protocolVersion:1,actions:descriptors},null,2)+'\n']]) {
 if(process.argv.includes('--check')) {if(await readFile(path,'utf8')!==content)throw new Error(`${path} is stale; run npm run harmony:docs`);}
 else await writeFile(path,content);
}
console.log(`Verified ${descriptors.length} shared actions and ${scenarioTemplates.length} scenario templates`);
