'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

const source = fs.readFileSync('web/private-csv.js','utf8');
function context(){
  const a = {console,Date,Math,Intl,Map,Number,Object,String,Error,
    heading:(...args)=>args.join(' '),banner:()=>'',esc:s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;'),
    download:()=>{},render:()=>{},document:{getElementById:()=>null}};
  vm.createContext(a);
  vm.runInContext(source,a);
  return a;
}
function run(script) {
  const a=context();
  return vm.runInContext(script,a);
}
const csv=[
  'Date,Description,Debit,Credit,Balance,Reference',
  '2026-10-01,Opening,0,0,500000,OPEN',
  '2026-10-02,Salary,0,2000,502000,IN-ONE',
  '2026-10-03,Purchase,500,0,501500,PAY-12345',
  '2026-10-04,Purchase,500,0,501000,PAY-12345',
].join('\n');

test('money arithmetic uses integer kobo, preserving exact decimals',()=>{
 const report=run(`privateAuditCSV(${JSON.stringify(csv.replace('2000','2000.01').replace('502000','502000.01').replace('501500','501500.01').replace('501000','501000.01'))})`);
 assert.equal(report.credits,200001);
 assert.equal(report.debits,100000);
 assert.equal(report.net,100001);
 assert.equal(report.pairs_checked,3);
 assert.equal(report.flag_count,1);
 assert.equal(report.flags[0].kind,'duplicate_reference');
});

test('running balance mismatch flagged without declaring stolen funds',()=>{
 const sample=csv.replace('501000','500995');
 const report=run(`privateAuditCSV(${JSON.stringify(sample)})`);
 assert.ok(report.flags.some(x=>x.kind==='arithmetic_gap'&&x.amount===500));
 assert.ok(report.warnings.some(x=>x.includes('NOT bank authentication')));
});
test('RFC 4180 quoted separators and doubled quotes work',()=>{
 const sample=csv.replace('Purchase,500','"Purchase, ""home""",500');
 const report=run(`privateAuditCSV(${JSON.stringify(sample)})`);
 assert.equal(report.transaction_count,4);
});

test('semicolon-delimited exports and day-first dates are accepted',()=>{
 const rows=['Date;Narration;DR;CR;Balance;Ref',
 '01/10/2026;Opening;0;0;100;OPEN',
 '02/10/2026;POS;25.50;0;74.50;POS231'];
 const report=run(`privateAuditCSV(${JSON.stringify(rows.join('\n'))})`);
 assert.equal(report.debits,2550);
 assert.equal(report.date_end,'2026-10-02');
 assert.equal(report.pairs_checked,1);
});

test('amount-only positive row without direction is skipped',()=>{
 const rows=['Date,Details,Amount,Balance',
 '2026-10-01,Opening,0,100',
 '2026-10-02,Unclear,10,110',
 '2026-10-03,Purchase,-10,100'].join('\n');
 const report=run(`privateAuditCSV(${JSON.stringify(rows)})`);
 assert.equal(report.transaction_count,1);
 assert.equal(report.skipped_rows,2);
 assert.ok(report.warnings.some(x=>x.includes('2 nonempty rows')));
});

test('invalid dates and mixed date ordering lower checkability',()=>{
 const sample=['Date,Debit,Credit,Balance',
 '2026-10-03,0,0,100',
 '2026-10-01,10,0,90',
 '2026-10-02,0,10,100'].join('\n');
 const report=run(`privateAuditCSV(${JSON.stringify(sample)})`);
 assert.equal(report.pairs_checked,0);
 assert.ok(report.warnings.some(x=>x.includes('Mixed date ordering')));
});

test('all outputs are aggregate-only, no reference or description leakage',()=>{
 const sample=csv.replace('Purchase','=HYPERLINK("https://evil.invalid","pwn")')
                 .replace('PAY-12345','PRIVATE-ACCOUNT-1234');
 const report=run(`privateAuditCSV(${JSON.stringify(sample)})`);
 const out=JSON.stringify(report);
 assert.ok(!out.includes('PRIVATE-ACCOUNT-1234'));
 assert.ok(!out.includes('evil.invalid'));
 const ui=run(`privateCsvState.report=privateAuditCSV(${JSON.stringify(sample)});privateCsvReport()`);
 assert.ok(!ui.includes('PRIVATE-ACCOUNT-1234'));
 assert.ok(!ui.includes('evil.invalid'));
});

test('reject NUL and unterminated CSV quoting',()=>{
 assert.throws(()=>run('privateAuditCSV("Date,Debit,\\u0000")'),/NUL byte/);
 assert.throws(()=>run('privateAuditCSV("Date,Debit\\n2026-10-01,\\\"oops")'),/Unterminated quoted/);
});

test('CSV exporter only includes monthly totals, not personal transaction details',()=>{
 let exported='', filename='';
 const a=context();
 a.download=(v,f)=>{exported=v;filename=f};
 vm.runInContext(`privateCsvState.report=privateAuditCSV(${JSON.stringify(csv)});privateCsvDownload()`,a);
 assert.ok(exported.includes('month,total_credits_ngn'));
 assert.ok(!exported.includes('PAY-12345'));
 assert.ok(!exported.includes('Purchase'));
 assert.ok(filename.endsWith('.csv'));
});

test('no network or browser storage methods are reachable from private parser',()=>{
 assert.ok(!/\b(?:fetch|XMLHttpRequest|WebSocket|localStorage|sessionStorage|indexedDB)\s*\(/.test(source));
 assert.ok(source.includes('await file.text()'));
 assert.ok(source.includes('File.text()'));
});

test('big values are rejected rather than silently losing cents',()=>{
 const sample=['Date,Debit,Credit,Balance','2026-10-01,90071992547409999,0,0'].join('\n');
 assert.throws(()=>run(`privateAuditCSV(${JSON.stringify(sample)})`),/No unambiguous/);
});
