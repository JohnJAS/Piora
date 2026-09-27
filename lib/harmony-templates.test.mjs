import assert from 'node:assert/strict';
import test from 'node:test';
import { createJiti } from 'jiti';
const {scenarioTemplates,bindScenarioTemplate}=await createJiti(import.meta.url).import('./harmony/scenario/templates.ts');
for (const template of scenarioTemplates) test(`shared JSON template ${template.id} satisfies action admission`,()=> {
 const steps=bindScenarioTemplate(template.id,template.parameters);assert.ok(steps.length);
 assert.doesNotMatch(JSON.stringify(steps),/\{\{/);
 assert.throws(()=>bindScenarioTemplate(template.id,{...template.parameters,undeclared:true}));
});
test('template inputs are data, never reinterpreted as bindings or source code',()=> {
 const text='{{bundleName}} $ ` "\n中文';
 assert.equal(bindScenarioTemplate('chinese-input',{text})[0].text,text);
 assert.throws(()=>bindScenarioTemplate('orientation',{rotation:'0'}));
});
