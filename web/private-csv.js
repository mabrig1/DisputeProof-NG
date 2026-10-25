/* DisputeProof NG v0.7 — private, browser-only CSV audit.
 * NO fetch / XHR / WebSocket / storage / AI / database calls occur in this module.
 * Data stays in memory until the user clears the audit or closes the tab.
 * Aggregate output deliberately excludes raw descriptions, account IDs and references.
 */
'use strict';
const privateCsvState = { report: null, error: '', processing: false };
const LOCAL_MAX_BYTES = 2 * 1024 * 1024, LOCAL_MAX_ROWS = 5000;

function privateNormalize(s) {
  return String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g,'');
}
const privateAliases = {
  date:['date','transactiondate','valuedate','postingdate','transdate'],
  description:['description','narration','details','transactiondetails','remarks','particulars','memo'],
  debit:['debit','dr','withdrawal','withdrawals','moneyout','paidout','outflow'],
  credit:['credit','cr','deposit','deposits','moneyin','paidin','inflow'],
  balance:['balance','runningbalance','closingbalance','availablebalance','ledgerbalance'],
  amount:['amount','transactionamount','value'],
  type:['type','transactiontype','direction','drcr','entrytype'],
  reference:['reference','ref','transactionreference','sessionid','transactionid','rrn','paymentreference'],
};
function privateHeader(row) {
  const map={};
  row.forEach((col,index)=>{
    let k=privateNormalize(col).replace(/(ngn|naira)$/,'');
    if(k.endsWith('amount')&&!['amount','transactionamount'].includes(k))k=k.slice(0,-6);
    for(const [key,values] of Object.entries(privateAliases)){
      if(map[key]===undefined && values.map(privateNormalize).includes(k))map[key]=index;
    }
  });
  return map.date!==undefined&&(map.debit!==undefined||map.credit!==undefined||map.amount!==undefined)?map:null;
}
function privateDelimiter(text) {
  const sample=text.slice(0,2500);
  let quoted=false, candidates={',':0,';':0,'\t':0,'|':0};
  for(let i=0;i<sample.length;i++){
    const c=sample[i];
    if(c==='"'){if(quoted&&sample[i+1]==='"'){i++;continue}quoted=!quoted;continue}
    if(!quoted&&(c==='\n'||c==='\r'))break;
    if(!quoted&&Object.hasOwn(candidates,c))candidates[c]++;
  }
  return Object.entries(candidates).sort((a,b)=>b[1]-a[1])[0][0];
}
function privateParseCSV(text){
  if(typeof text!=='string'||!text.trim())throw Error('The CSV is empty.');
  if(text.length>LOCAL_MAX_BYTES)throw Error('CSV content exceeds the 2 MB local-audit limit.');
  if(text.includes('\u0000'))throw Error('Invalid CSV contains a NUL byte.');
  const delimiter=privateDelimiter(text);
  const rows=[]; let row=[],cell='',quoted=false,cellStarted=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"'){if(text[i+1]==='"'){cell+='"';i++}else quoted=false}
      else cell+=c;
    }else if(c==='"'&&!cellStarted){quoted=true;cellStarted=true}
    else if(c===delimiter){row.push(cell);cell='';cellStarted=false}
    else if(c==='\n'||c==='\r'){
      if(c==='\r'&&text[i+1]==='\n')i++;
      row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
      if(rows.length>LOCAL_MAX_ROWS+36)throw Error('More than 5,000 rows; export a shorter period.');
      row=[];cell='';cellStarted=false;
    }else{cell+=c;cellStarted=true}
    if(cell.length>1200)throw Error('A CSV cell is unexpectedly long.');
    if(row.length>40)throw Error('Too many columns in this CSV.');
  }
  if(quoted)throw Error('Unterminated quoted field. Export a valid UTF-8 CSV.');
  row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
  return rows;
}
function privateCents(value,{balance=false}={}){
  const s=String(value??'').trim();
  if(!s||['-','n/a','null','none'].includes(s.toLowerCase()))return null;
  const neg=(s.startsWith('(')&&s.endsWith(')'))||s.startsWith('-');
  const cleaned=s.replace(/(?:NGN|₦|\s|,)/gi,'').replace(/^[-+]/,'').replace(/^\(/,'').replace(/\)$/,'');
  if(!/^\d+(?:\.\d{1,2})?$/.test(cleaned))return null;
  const [whole,frac='']=cleaned.split('.');
  const v=Number(whole)*100+Number(frac.padEnd(2,'0'));
  if(!Number.isSafeInteger(v)||v<0)return null;
  if(neg&&!balance)return -v;
  return neg?-v:v;
}
function privateDate(raw){
  const s=String(raw??'').trim();
  let y,m,d,match;
  if(match=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s)){
    y=+match[1];m=+match[2];d=+match[3];
  }else if(match=/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/.exec(s)){
    d=+match[1];m=+match[2];y=+match[3]; // Nigerian day-first format
  }else return null;
  if(y<2000||y>2100)return null;
  const check=new Date(Date.UTC(y,m-1,d));
  if(check.getUTCFullYear()!==y||check.getUTCMonth()+1!==m||check.getUTCDate()!==d)return null;
  return [y,String(m).padStart(2,'0'),String(d).padStart(2,'0')].join('-');
}
function privateFormatCents(cents){
  const neg=cents<0?'-':'', abs=Math.abs(cents);
  return neg+'₦'+Math.floor(abs/100).toLocaleString('en-NG')+'.'+String(abs%100).padStart(2,'0');
}
function privateAuditCSV(text){
  const rows=privateParseCSV(text);
  let header=-1,cols;
  for(let i=0;i<Math.min(rows.length,35);i++){
    if(cols=privateHeader(rows[i])){header=i;break}
  }
  if(header<0)throw Error('Missing Date and Debit/Credit (or Amount + Type) column headers.');
  const get=(row,key)=>cols[key]===undefined?'':String(row[cols[key]]??'');
  let skipped=0;const tx=[];
  for(let i=header+1;i<rows.length;i++){
    const row=rows[i],day=privateDate(get(row,'date'));
    if(!day){skipped++;continue}
    let debit=privateCents(get(row,'debit'));
    let credit=privateCents(get(row,'credit'));
    const amount=privateCents(get(row,'amount')),type=get(row,'type').toLowerCase();
    const rawDebit=get(row,'debit').trim(),rawCredit=get(row,'credit').trim(),rawAmount=get(row,'amount').trim();
    if((rawDebit && debit===null) || (rawCredit && credit===null) ||
       (rawAmount && amount===null)){skipped++;continue}
    if(debit===null&&credit===null&&amount!==null){
      if(/^(?:debit|dr|withdrawal|outflow)$/.test(type))debit=Math.abs(amount),credit=0;
      else if(/^(?:credit|cr|deposit|inflow)$/.test(type))credit=Math.abs(amount),debit=0;
      else if(amount<0)debit=Math.abs(amount),credit=0;
    }
    if(debit===null&&credit===null){skipped++;continue}
    debit=debit??0;credit=credit??0;
    if(!Number.isSafeInteger(debit)||!Number.isSafeInteger(credit)||debit<0||credit<0||(debit>0&&credit>0)){skipped++;continue}
    const balance=privateCents(get(row,'balance'),{balance:true});
    tx.push({day,debit,credit,balance,description:get(row,'description').slice(0,160),
      ref:get(row,'reference').trim().toLowerCase().slice(0,90),row:i+1});
    if(tx.length>LOCAL_MAX_ROWS)throw Error('Too many transactions; use a shorter CSV statement.');
  }
  if(!tx.length)throw Error('No unambiguous transaction rows found.');
  const ordered=[...tx];let asc=true,desc=true;
  for(let i=1;i<tx.length;i++){if(tx[i-1].day>tx[i].day)asc=false;if(tx[i-1].day<tx[i].day)desc=false}
  if(!asc&&!desc)ordered.length=0;
  else if(!asc&&desc)ordered.reverse();
  const flags=[];let checked=0,withBalances=0;
  for(const t of tx)if(t.balance!==null)withBalances++;
  for(let i=1;i<ordered.length;i++){
    const prev=ordered[i-1],cur=ordered[i];
    if(prev.balance===null||cur.balance===null)continue;
    checked++;
    const expected=prev.balance+cur.credit-cur.debit;
    if(!Number.isSafeInteger(expected)){flags.push({kind:'large_value',row:cur.row,amount:0,description:'Arithmetic exceeds safe integer range. Manual review needed.'});continue}
    const gap=cur.balance-expected;
    if(gap!==0)flags.push({kind:'arithmetic_gap',row:cur.row,amount:Math.abs(gap),
      description:'Recorded running balance differs from previous balance plus recorded credits minus debits.'});
  }
  const seen=new Map();
  for(const t of tx){
    if(t.debit===0||t.ref.length<5)continue;
    const key=t.ref+'|'+t.debit;
    if(seen.has(key))flags.push({kind:'duplicate_reference',row:t.row,amount:t.debit,
      description:'Repeated debit amount and transaction reference. Two legitimate postings or duplicate export rows are possible.'});
    else seen.set(key,t.row);
  }
  const months=new Map();let debits=0,credits=0;
  for(const t of tx){
    debits+=t.debit;credits+=t.credit;
    if(!Number.isSafeInteger(debits)||!Number.isSafeInteger(credits))throw Error('Totals exceed numeric limits; split this CSV into smaller periods.');
    const key=t.day.slice(0,7);
    const old=months.get(key)||{month:key,credits:0,debits:0};
    old.credits+=t.credit;old.debits+=t.debit;months.set(key,old);
  }
  const warning=[
    'This is a local arithmetic review, NOT bank authentication or proof that funds are missing.',
    'Assumes NGN and that the supplied rows use a consistent currency and signed-balance convention.',
    'Raw statement rows are parsed in this browser only; they are not saved or uploaded by this feature.',
    'Look at your original bank statement to confirm transaction ordering, columns and completeness.',
  ];
  if(skipped)warning.push(skipped+' nonempty rows were skipped; they may affect balance checks.');
  if(!ordered.length)warning.push('Mixed date ordering prevents reliable adjacent-balance checks.');
  if(cols.balance===undefined)warning.push('No balance column; reconciliation checks are unavailable.');
  return {source:'browser_only_csv',transaction_count:tx.length,skipped_rows:skipped,
    date_start:tx.map(t=>t.day).sort()[0],date_end:tx.map(t=>t.day).sort().at(-1),
    debits,credits,net:credits-debits,
    balance_rows:withBalances,possible_pairs:ordered.length?Math.max(0,ordered.length-1):0,
    pairs_checked:checked, flags:flags.slice(0,250),flag_count:flags.length,
    monthly:[...months.values()].sort((a,b)=>a.month.localeCompare(b.month)),
    warnings:warning};
}
function privateCsvReport(){
  const r=privateCsvState.report;
  if(!r)return '<section class="card pad"><p>No local audit loaded. Nothing has been uploaded.</p></section>';
  const max=Math.max(1,...r.monthly.map(m=>Math.max(m.credits,m.debits)));
  return `<section class="stats">
    <div class="stat-card"><span class="stat-top">Total credits</span><b class="stat-value">${privateFormatCents(r.credits)}</b></div>
    <div class="stat-card"><span class="stat-top">Total debits</span><b class="stat-value">${privateFormatCents(r.debits)}</b></div>
    <div class="stat-card"><span class="stat-top">Transactions</span><b class="stat-value">${r.transaction_count}</b></div>
    <div class="stat-card"><span class="stat-top">Items for review</span><b class="stat-value">${r.flag_count}</b></div>
  </section>
  <section class="card pad"><h3>Monthly recorded cash flow</h3>
    <p>Credits versus debits, using the uploaded CSV only. Transfers between your accounts may be counted twice.</p>
    <div class="private-months">${r.monthly.map(x=>`<div class="private-month"><b>${x.month}</b><div><span>Credit</span><div class="private-track"><i class="private-credit" style="width:${Math.round(100*x.credits/max)}%"></i></div><small>${privateFormatCents(x.credits)}</small></div><div><span>Debit</span><div class="private-track"><i class="private-debit" style="width:${Math.round(100*x.debits/max)}%"></i></div><small>${privateFormatCents(x.debits)}</small></div></div>`).join('')}</div>
  </section>
  <section class="card pad"><h3>Reconciliation coverage</h3>
    <p>Checked ${r.pairs_checked} of ${r.possible_pairs} adjacent recorded rows. ${r.balance_rows} parsed rows have a running balance; ${r.skipped_rows} rows were skipped.</p>
    <p><b>Recorded net movement:</b> ${privateFormatCents(r.net)} (not necessarily the account balance).</p>
  </section>
  <section class="card pad"><h3>Possible discrepancies (${r.flag_count})</h3>
    <p>Review flags are not proven errors or losses. No raw transaction references or descriptions are stored in the results below.</p>
    ${r.flags.length?`<div class="table-scroller"><table class="table"><thead><tr><th>CSV row</th><th>Reason</th><th>Amount concerned</th></tr></thead><tbody>${r.flags.map(f=>`<tr><td>${f.row}</td><td>${f.kind==='arithmetic_gap'?'Balance mismatch':f.kind==='duplicate_reference'?'Repeated debit reference':'Uncheckable amount'} — ${f.description}</td><td>${privateFormatCents(f.amount)}</td></tr>`).join('')}</tbody></table></div>`:'<p>No arithmetic differences or repeated reference flags were observed in the parsed rows.</p>'}
    ${r.flag_count>r.flags.length?'<p>Only the first 250 flags are displayed.</p>':''}
  </section>
  <section class="card pad"><h3>Interpretation and limitations</h3>
    <ul>${r.warnings.map(w=>'<li>'+esc(w)+'</li>').join('')}</ul>
    <div class="action-row"><button class="btn btn-neutral" type="button" id="privateCsvExport">Export aggregate CSV (no transaction descriptions)</button></div>
  </section>`;
}
function privateCsvPage(){
  return heading('NO CLOUD UPLOAD · PRIVATE REVIEW','Browser-only CSV statement audit',
    'Reconcile your own CSV locally: the file never goes to Vercel, MongoDB or OpenRouter. PDF and Excel require another privacy-reviewed processing path.')
    +`<div class="callout"><strong>Privacy boundary:</strong> This audit runs in your web browser. No statement contents are sent to our server or third parties by this feature. Do not use on a shared device. Closing the tab or selecting Clear local audit discards the in-memory report. This is not bank verification.</div>`
    +`<section class="card pad"><h3>Choose a CSV statement (UTF-8, max 2 MB, 5,000 transactions)</h3><p>Supported columns: Date, Debit, Credit, Balance, Description and Reference; or signed Amount + Type. Date formats: YYYY-MM-DD or DD/MM/YYYY. No filename, narration or account number is displayed in exports.</p>
    <input type="file" id="privateCsvFile" class="private-file" accept=".csv,text/csv" aria-label="Choose private CSV statement"/>
    <div class="action-row"><button type="button" class="btn btn-neutral" id="privateCsvClear">Clear local audit</button></div>
    <div role="status" id="privateCsvStatus">${privateCsvState.error?esc(privateCsvState.error):'Only you see the selected statement in this browser session.'}</div></section>`
    +privateCsvReport();
}
function privateCsvDownload(){
  const r=privateCsvState.report;if(!r)return;
  const lines=['month,total_credits_ngn,total_debits_ngn',
    ...r.monthly.map(m=>[m.month,(m.credits/100).toFixed(2),(m.debits/100).toFixed(2)].join(','))];
  lines.push('','metric,value','transactions,'+r.transaction_count,
    'skipped_rows,'+r.skipped_rows,'pairs_checked,'+r.pairs_checked,
    'arithmetic_or_reference_flags,'+r.flag_count);
  download('\uFEFF'+lines.join('\r\n'),
    'moneytrace-browser-audit-aggregate.csv','text/csv;charset=utf-8');
}
function privateCsvBind(){
  document.getElementById('privateCsvClear')?.addEventListener('click',()=>{
    privateCsvState.report=null;privateCsvState.error='';render();
  });
  document.getElementById('privateCsvExport')?.addEventListener('click',privateCsvDownload);
  document.getElementById('privateCsvFile')?.addEventListener('change',async e=>{
    const file=e.target.files?.[0];if(!file)return;
    privateCsvState.report=null;privateCsvState.error='';
    if(!file.name.toLowerCase().endsWith('.csv')||file.size>LOCAL_MAX_BYTES){
      privateCsvState.error='Choose a UTF-8 CSV file no larger than 2 MB.';render();return;
    }
    try{
      // File.text() reads in-browser only. No request leaves this audit flow.
      const text=await file.text();
      privateCsvState.report=privateAuditCSV(text);
    }catch(err){privateCsvState.error=err.message||'Could not parse this CSV.';}
    render();
  });
}
