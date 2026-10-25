'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const content=fs.readFileSync('web/insights.js','utf8');
const rows=[
 {date:'2026-08-01',account:'Bank A',credit:'100.10',debit:'0',category:'Income'},
 {date:'2026-10-05',account:'Bank A',credit:'0',debit:'20.05',category:'Card & POS'},
 {date:'2026-10-20',account:'Bank B',credit:'0',debit:'10.05',category:'=IMPORTXML("https://bad.invalid")'},
 {date:'2026-10-25',account:'Bank A',credit:'5.00',debit:'0',category:'Income'}
];
function context(){
 const env={state:{report:{transactions:structuredClone(rows)}},
 esc:v=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;'),
 download:()=>{},toast:()=>{},document:{},XMLSerializer:class{}};
 vm.createContext(env);
 vm.runInContext(content,env);
 return env;
}
test('30-day filter follows latest statement row not wall clock',()=>{
 const v=context();
 vm.runInContext("vizFocus.window='30';vizFocus.group='day'",v);
 const scope=vm.runInContext('vizScope()',v);
 assert.equal(scope.first,'2026-09-26');
 assert.equal(scope.rows.length,3);
});
test('account selection isolates rows and preserves cent amounts',()=>{
 const v=context();
 vm.runInContext("vizFocus.account='0'",v);
 const result=vm.runInContext('vizFocusData(vizScope().rows)',v);
 assert.equal(result.credit,10510);
 assert.equal(result.debit,2005);
 assert.equal(result.rows,3);
});
test('daily and monthly views have different distinct plotted periods',()=>{
 const v=context();
 const month=vm.runInContext('vizFocusData(vizScope().rows).series.length',v);
 vm.runInContext("vizFocus.group='day'",v);
 const days=vm.runInContext('vizFocusData(vizScope().rows).series.length',v);
 assert.equal(month,2);
 assert.equal(days,4);
});
test('CSV export neutralizes category spreadsheet formula injection',()=>{
 const v=context();
 const csv=vm.runInContext('vizFocusCSV()',v);
 assert.ok(csv.includes("\"'=IMPORTXML("));
 assert.ok(csv.includes('2026-10'));
 assert.ok(csv.includes('no confirmed loss'));
});
test('interactive dashboard includes native controls and exact-value table',()=>{
 const v=context();
 const markup=vm.runInContext('vizExplorer()',v);
 assert.ok(markup.includes('data-viz-filter="window"'));
 assert.ok(markup.includes('data-viz-filter="account"'));
 assert.ok(markup.includes('data-viz-filter="mode"'));
 assert.ok(markup.includes('View exact plotted values'));
 assert.ok(markup.includes('Not an account balance'));
 assert.ok(markup.includes('SVG'));
});
test('graph respects account filter and offers clear scoped period',()=>{
 const v=context();
 vm.runInContext("vizFocus.account='1';vizFocus.window='30'",v);
 const result=vm.runInContext('vizFocusResults()',v);
 assert.ok(result.includes('2026-09-26'));
 vm.runInContext("vizFocus.window='all';vizFocus.account='0'",v);
 assert.ok(vm.runInContext('vizFocusResults()',v).includes('Cash-flow timeline'));
});
