/* Interactive, dependency-free MoneyTrace analytics. SVG is produced from sanitized data. */
'use strict';
const vizPalette = ['#0f766e','#e4a63e','#5f86ce','#d46b5a','#7e6db7','#5e9b91','#b3738f','#7893a6'];
const vizAmount = n => '₦' + Number(n||0).toLocaleString('en-NG',{maximumFractionDigits:2,minimumFractionDigits:2});
const vizShort = n => { const x=Math.abs(Number(n)||0); return (n<0?'-':'')+'₦'+(x>=1000000?(x/1000000).toFixed(1)+'m':x>=1000?(x/1000).toFixed(1)+'k':x.toFixed(0)); };
const vizNumber = n => Number(n||0);
function vizEmpty(text){return `<div class="viz-empty">${esc(text)}</div>`;}
function vizFlowChart(rows){
 if(!rows?.length) return vizEmpty('No dated transactions to visualize.');
 const width=Math.max(700,rows.length*70+120),height=270, bottom=218, chartTop=22, left=70;
 const max=Math.max(1,...rows.flatMap(x=>[vizNumber(x.credits),vizNumber(x.debits)]));
 const available=width-left-20, group=available/rows.length, bar=Math.min(22,group*.3);
 const grid=[0,.25,.5,.75,1].map(f=>{const y=bottom-f*(bottom-chartTop);return `<line x1="${left}" x2="${width-20}" y1="${y}" y2="${y}" stroke="#e4eaf0"/><text x="${left-10}" y="${y+4}" text-anchor="end" class="svg-axis">${esc(vizShort(max*f))}</text>`}).join('');
 const bars=rows.map((r,i)=>{
  const cx=left+group*(i+.5),cr=vizNumber(r.credits),dr=vizNumber(r.debits);
  const h1=(cr/max)*(bottom-chartTop),h2=(dr/max)*(bottom-chartTop);
  return `<rect x="${cx-bar-2}" y="${bottom-h1}" width="${bar}" height="${h1}" fill="#0f766e" rx="3"><title>${esc(r.month)} credits: ${esc(vizAmount(cr))}</title></rect><rect x="${cx+2}" y="${bottom-h2}" width="${bar}" height="${h2}" fill="#e4a63e" rx="3"><title>${esc(r.month)} debits: ${esc(vizAmount(dr))}</title></rect><text x="${cx}" y="${bottom+20}" text-anchor="middle" class="svg-axis">${esc(r.month)}</text>`;
 }).join('');
 return `<div class="viz-scroll"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Monthly credits and debits chart"><g>${grid}${bars}</g></svg></div><div class="viz-key"><span><i class="viz-swatch-0"></i> Credits</span><span><i class="viz-swatch-1"></i> Debits</span></div>`;
}
function vizDailyChart(rows){
 if(!rows?.length)return vizEmpty('No daily activity in the uploaded period.');
 const width=Math.max(700,Math.min(rows.length*30+100,1800)),height=270,left=74,right=22,top=20,bottom=215;
 const vals=rows.map(r=>vizNumber(r.net)); const low=Math.min(0,...vals),high=Math.max(0,...vals);
 const span=(high-low)||1; const x=i=>left+(width-left-right)*(rows.length===1?.5:i/(rows.length-1));
 const y=v=>bottom-(v-low)/span*(bottom-top);
 const path=vals.map((v,i)=>(i?'L':'M')+x(i).toFixed(2)+' '+y(v).toFixed(2)).join(' ');
 const idx=[...new Set([0,Math.floor((rows.length-1)/2),rows.length-1])];
 const labels=idx.map(i=>`<text class="svg-axis" x="${x(i)}" y="${bottom+21}" text-anchor="middle">${esc(rows[i].date)}</text>`).join('');
 const dots=rows.map((r,i)=>`<circle cx="${x(i)}" cy="${y(vals[i])}" r="${rows.length>70?2:4}" fill="#0f766e"><title>${esc(r.date)} net flow: ${esc(vizAmount(vals[i]))}</title></circle>`).join('');
 return `<div class="viz-scroll"><svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="Net daily cash flow chart"><line x1="${left}" x2="${width-right}" y1="${y(0)}" y2="${y(0)}" stroke="#c3cbd0" stroke-dasharray="4 3"/><text class="svg-axis" x="${left-8}" y="${y(high)+3}" text-anchor="end">${esc(vizShort(high))}</text><text class="svg-axis" x="${left-8}" y="${y(low)+3}" text-anchor="end">${esc(vizShort(low))}</text><path d="${path}" fill="none" stroke="#0f766e" stroke-width="3" stroke-linejoin="round"/>${dots}${labels}</svg></div><p class="viz-caption">Daily net is credits minus debits, not the balance of any account.</p>`;
}
function vizSpendingChart(rows){
 if(!rows?.length)return vizEmpty('No debits to categorize.');
 const active=rows.slice(0,7),tail=rows.slice(7).reduce((sum,x)=>sum+vizNumber(x.debits),0);
 if(tail)active.push({category:'Other categories',debits:tail});
 const total=active.reduce((sum,r)=>sum+vizNumber(r.debits),0)||1;
 const r=70,c=2*Math.PI*r;let offset=0;
 const arcs=active.map((row,i)=>{const len=vizNumber(row.debits)/total*c,start=offset;offset+=len;return `<circle cx="98" cy="98" r="${r}" fill="none" class="viz-stroke-${i%vizPalette.length}" stroke-width="27" stroke-dasharray="${len} ${c-len}" stroke-dashoffset="${-start}" transform="rotate(-90 98 98)"><title>${esc(row.category)}: ${esc(vizAmount(row.debits))}</title></circle>`}).join('');
 const legend=active.map((row,i)=>`<li><i class="viz-swatch-${i%vizPalette.length}"></i><span>${esc(row.category)}</span><b>${esc((vizNumber(row.debits)/total*100).toFixed(1))}%</b></li>`).join('');
 return `<div class="viz-donut"><svg viewBox="0 0 196 196" role="img" aria-label="Spending allocation donut chart">${arcs}<text x="98" y="92" text-anchor="middle" class="viz-center-label">DEBITS</text><text x="98" y="115" text-anchor="middle" class="viz-center-value">${esc(vizShort(total))}</text></svg><ul class="viz-legend">${legend}</ul></div>`;
}
function vizAccountTable(rows){if(!rows?.length)return vizEmpty('No accounts found.');return `<div class="table-scroller"><table class="table"><thead><tr><th>Statement account label</th><th>Transactions</th><th>Credits</th><th>Debits</th><th>Net movement</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.account)}</td><td>${r.transactions}</td><td class="money credit">${vizAmount(r.credits)}</td><td class="money debit">${vizAmount(r.debits)}</td><td class="money">${vizAmount(r.net)}</td></tr>`).join('')}</tbody></table></div>`;}
function vizTopDebits(rows){if(!rows?.length)return vizEmpty('No outgoing transactions.');return `<div class="table-scroller"><table class="table"><thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.date)}</td><td title="${esc(r.account)}">${esc(r.description)}</td><td>${esc(r.category)}</td><td class="money debit">${vizAmount(r.amount)}</td></tr>`).join('')}</tbody></table></div>`;}
function vizQuality(rows){
 if(!rows?.length)return vizEmpty('No balance audit metadata.');
 return `<div class="table-scroller"><table class="table"><thead><tr><th>Account label</th><th>Parsed / skipped</th><th>Balance checkability</th><th>Mismatches</th><th>Ordering</th></tr></thead><tbody>${rows.map(r=>{
 const pct=Math.max(0,Math.min(100,Number(r.arithmetic_checkability_pct)||0));
 return `<tr><td>${esc(r.account)}</td><td>${Number(r.parsed_rows)} / ${Number(r.skipped_rows)}</td><td><div class="viz-quality-bar" role="img" aria-label="${esc(String(pct))}% adjacent rows checkable"><span style="width:${pct}%"></span></div><small>${esc(String(pct))}% (${Number(r.pairs_checked)} of ${Number(r.possible_adjacent_pairs)} pairs)</small></td><td>${Number(r.arithmetic_mismatches)}</td><td>${r.order_status==='mixed_uncheckable'?'Mixed – review':'Date order consistent'}</td></tr>`;
 }).join('')}</tbody></table></div><p class="viz-caption">Checkability measures whether adjacent recorded balances can be checked mathematically. It does not verify authorization, missing entries, or bank identity.</p>`;
}
function vizCandidateMatches(audit){
 if(!audit)return vizEmpty('No candidate-matching data available.');
 const reversals=audit.reversals||[],transfers=audit.transfers||[];
 const counts=(rows,status)=>rows.filter(x=>x.status===status).length;
 return `<div class="viz-candidate-grid"><div><b>${counts(transfers,'possible_match')}</b><span>Possible cross-account pairs</span></div><div><b>${counts(transfers,'ambiguous')}</b><span>Ambiguous transfers</span></div><div><b>${counts(transfers,'coverage_limited')+counts(transfers,'no_candidate')}</b><span>Transfers requiring records</span></div><div><b>${counts(reversals,'possible_reversal')}</b><span>Possible reversal pairs</span></div><div><b>${counts(reversals,'window_incomplete')+counts(reversals,'not_observed')+counts(reversals,'ambiguous_reversal')}</b><span>Reversals requiring review</span></div></div><p class="viz-caption">A match is a candidate based on uploaded rows; no payment network has confirmed settlement, ownership or refund.</p>`;
}
function insightsPage(){
 const r=state.report, a=r?.analytics; if(!a)return heading('DATA ANALYSIS & VISUALIZATION','Financial insights','Analyze your uploaded transaction history with explainable charts.',buttons())+banner()+vizEmpty('No analytics available. Load the synthetic demo or analyze statements.');
 const s=a.statistics; const d=a.period;
 return heading('DATA ANALYSIS & VISUALIZATION','Financial insights',`Explore transaction patterns between ${esc(d.start||'—')} and ${esc(d.end||'—')}.`, `<div class="action-row"><button class="btn btn-neutral" data-action="export-analytics">${ico('down')} Export insights CSV</button><button class="btn btn-primary" data-page="upload">${ico('upload')} New audit</button></div>`)+banner()+vizExplorer()+`<section class="insight-stats">${stat('AVERAGE DEBIT',vizAmount(s.average_debit),'Across outgoing entries','arrowup')}${stat('MEDIAN DEBIT',vizAmount(s.median_debit),'Typical outgoing entry','coins','blue')}${stat('LARGEST DEBIT',vizAmount(s.largest_debit),'Single observed debit','radar','gold')}${stat('SPENDING CONCENTRATION',`${s.largest_category_share_percent}%`,'Largest category share of debits','graph')}</section><div class="insights-grid"><section class="card insight-card insight-wide"><div class="card-heading"><div><h3>Monthly money movement</h3><p>Credits versus debits across uploaded statements</p></div></div>${vizFlowChart(a.monthly)}</section><section class="card insight-card"><div class="card-heading"><div><h3>Spending breakdown</h3><p>Classification based on transaction narration</p></div></div>${vizSpendingChart(a.spending)}</section><section class="card insight-card"><div class="card-heading"><div><h3>Review flags by severity</h3><p>Counts may overlap across transactions</p></div></div><div class="viz-severity">${a.findings_by_severity.map(x=>`<div class="viz-severity-row"><span>${esc(x.severity)}</span><div><svg viewBox="0 0 100 12" preserveAspectRatio="none"><rect class="sev-${esc(x.severity)}" x="0" y="0" width="${Math.round(x.count/Math.max(1,...a.findings_by_severity.map(y=>y.count))*100)}" height="12" /></svg></div><strong>${x.count}</strong></div>`).join('')}</div></section><section class="card insight-card insight-wide"><div class="card-heading"><div><h3>Daily net movement</h3><p>Cash flow trend, not a bank balance reconstruction</p></div></div>${vizDailyChart(a.daily)}</section><section class="card insight-card insight-wide"><div class="card-heading"><div><h3>Account comparisons</h3><p>Source labels are based on uploaded filenames, not verified identities</p></div></div>${vizAccountTable(a.accounts)}</section><section class="card insight-card insight-wide"><div class="card-heading"><div><h3>Reconciliation coverage</h3><p>Which balances were actually checkable? Missing or ambiguous rows are surfaced.</p></div></div>${vizQuality(r.reconciliation_quality?.accounts)}</section><section class="card insight-card insight-wide"><div class="card-heading"><div><h3>Transfer and reversal tracing</h3><p>Conservative one-to-one candidate matching with no bank-network verification</p></div></div>${vizCandidateMatches(r.matching_audit)}</section><section class="card insight-card insight-wide"><div class="card-heading"><div><h3>Largest recorded debits</h3><p>High amounts alone are not evidence of wrongdoing</p></div></div>${vizTopDebits(a.largest_debits)}</section></div><div class="callout"><strong>How to interpret:</strong> ${a.interpretation.map(esc).join(' ')}</div>`;
}
function insightsCSV(a,q,match){
 const lines=['section,period_or_label,credits_ngn,debits_ngn,net_ngn,transactions'];
 for(const [key,name] of [['daily','date'],['monthly','month'],['accounts','account']])for(const row of a[key]){
  const csv=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
  lines.push([key,row[name],row.credits,row.debits,row.net,row.transactions].map(csv).join(','));
 }
 lines.push('');lines.push('spending_category,debits_ngn,transactions');
 for(const row of a.spending){const csv=v=>'"'+String(v??'').replace(/"/g,'""')+'"';lines.push([row.category,row.debits,row.transactions].map(csv).join(','));}
 const csv=v=>'"'+String(v??'').replace(/"/g,'""')+'"';
 if(q?.accounts?.length){
  lines.push('');lines.push('reconciliation_account,parsed_rows,skipped_rows,pairs_checked,possible_pairs,arithmetic_mismatches,checkability_percent');
  for(const row of q.accounts)lines.push([row.account,row.parsed_rows,row.skipped_rows,row.pairs_checked,row.possible_adjacent_pairs,row.arithmetic_mismatches,row.arithmetic_checkability_pct].map(csv).join(','));
 }
 if(match){
  lines.push('');lines.push('matching_kind,debit_id,credit_id,status,amount_ngn,review_reason');
  for(const row of match.transfers||[])lines.push(['transfer',row.debit_id,row.credit_id,row.status,row.amount,row.reason].map(csv).join(','));
  for(const row of match.reversals||[])lines.push(['reversal',row.debit_id,row.credit_id,row.status,row.amount,row.reason].map(csv).join(','));
 }
 return '\uFEFF'+lines.join('\r\n');
}


/* v0.5 interactive drill-down. Computed from the report already in memory.
   Displays uploaded rows only, not verified account activity or bank settlement. */
const vizFocus={account:'all',window:'all',group:'month',mode:'gross'};
function vizScope(){
 const transactions=state.report?.transactions||[];
 const accounts=[...new Set(transactions.map(t=>String(t.account)))].sort();
 const selected=vizFocus.account==='all'?null:accounts[Number(vizFocus.account)];
 const last=transactions.reduce((v,t)=>t.date>v?t.date:v,'');
 let first='';
 if(last&&vizFocus.window!=='all'){const d=new Date(last+'T00:00:00Z');d.setUTCDate(d.getUTCDate()-(Number(vizFocus.window)-1));first=d.toISOString().slice(0,10);}
 const rows=transactions.filter(t=>(selected===null||t.account===selected)&&(!first||t.date>=first&&t.date<=last));
 return {accounts,selected,first,last,rows};
}
const vizCent=n=>{const x=Number(n);return Number.isFinite(x)&&Math.abs(x*100)<Number.MAX_SAFE_INTEGER?Math.round(x*100):0;};
function vizFocusData(rows){
 let credit=0,debit=0;const periods=new Map(),cats=new Map(),days=Array.from({length:7},(_,i)=>({day:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i],total:0}));
 for(const t of rows){
  const cr=vizCent(t.credit),db=vizCent(t.debit);credit+=cr;debit+=db;
  const key=vizFocus.group==='day'?t.date:t.date.slice(0,7);
  if(!periods.has(key))periods.set(key,{period:key,credit:0,debit:0,count:0});
  const p=periods.get(key);p.credit+=cr;p.debit+=db;p.count++;
  if(db>0){const cat=String(t.category||'Uncategorized');cats.set(cat,(cats.get(cat)||0)+db);
   const d=new Date(t.date+'T00:00:00Z');if(!Number.isNaN(d.getTime()))days[(d.getUTCDay()+6)%7].total+=db;}
 }
 return {credit,debit,rows:rows.length,series:[...periods.values()].sort((a,b)=>a.period.localeCompare(b.period)),cats:[...cats].map(([name,total])=>({name,total})).sort((a,b)=>b.total-a.total),days};
}
function vizFocusTable(items){
 if(!items.length)return vizEmpty('No periods match these filters.');
 let html='<details class="viz-focus-details"><summary>View exact plotted values ('+items.length+' periods)</summary><div class="table-scroller"><table class="table"><thead><tr><th>Period</th><th>Entries</th><th>Credits</th><th>Debits</th><th>Net flow</th></tr></thead><tbody>';
 for(const p of items)html+='<tr><td>'+esc(p.period)+'</td><td>'+p.count+'</td><td>'+esc(vizAmount(p.credit/100))+'</td><td>'+esc(vizAmount(p.debit/100))+'</td><td>'+esc(vizAmount((p.credit-p.debit)/100))+'</td></tr>';
 return html+'</tbody></table></div></details>';
}
function vizWeekdayChart(days){
 const highest=Math.max(1,...days.map(d=>d.total));
 return '<div class="viz-weekdays">'+days.map(d=>'<div class="viz-weekday"><span>'+esc(d.day)+'</span><div class="viz-week-bar" role="img" aria-label="'+esc(d.day+': '+vizAmount(d.total/100))+'"><i style="height:'+Math.max(0,Math.min(100,d.total/highest*100)).toFixed(1)+'%"></i></div><strong>'+esc(vizShort(d.total/100))+'</strong></div>').join('')+'</div><p class="viz-caption">Debit amounts grouped by the weekday of recorded transactions, not projected spending.</p>';
}
function vizFocusResults(){
 const scope=vizScope(),d=vizFocusData(scope.rows);
 const points=d.series.map(p=>({date:p.period,month:p.period,credits:(p.credit/100).toFixed(2),debits:(p.debit/100).toFixed(2),net:((p.credit-p.debit)/100).toFixed(2)}));
 const chart=vizFocus.mode==='net'?vizDailyChart(points):vizFlowChart(points);
 const spending=d.cats.map(c=>({category:c.name,debits:(c.total/100).toFixed(2)}));
 const periodText=scope.first?('From '+scope.first+' to '+scope.last+' relative to latest statement entry'):'Across all recorded dates in the chosen account(s)';
 const k=(name,v,info)=>'<div class="viz-focus-kpi"><small>'+name+'</small><strong>'+esc(v)+'</strong><span>'+info+'</span></div>';
 return '<div class="viz-focus-context">'+esc(periodText)+' · '+d.rows+' transaction rows</div>'+
  '<div class="viz-focus-kpis">'+k('Credits',vizAmount(d.credit/100),'Total recorded inflows')+k('Debits',vizAmount(d.debit/100),'Total recorded outflows')+k('Net movement',vizAmount((d.credit-d.debit)/100),'Not an account balance')+k('Entries',String(d.rows),'In selected rows')+'</div>'+
  '<div class="viz-focus-plot"><div class="viz-focus-caption"><strong>Cash-flow timeline</strong><button type="button" data-viz-export="svg" class="viz-focus-button">Export chart SVG</button></div>'+chart+'<p class="viz-caption">Only periods with recorded entries are plotted. Absent dates do not demonstrate zero transactions.</p>'+vizFocusTable(d.series)+'</div>'+
  '<div class="viz-focus-breakdowns"><div><h4>Selected debit categories</h4>'+vizSpendingChart(spending)+'</div><div><h4>Weekday debit activity</h4>'+vizWeekdayChart(d.days)+'</div></div>';
}
function vizExplorer(){
 if(!state.report?.transactions?.length)return '';
 const s=vizScope();
 const opts=(values,key)=>values.map(v=>'<option value="'+esc(v[0])+'"'+(vizFocus[key]===v[0]?' selected':'')+'>'+esc(v[1])+'</option>').join('');
 const accountChoices=[['all','All uploaded accounts'],...s.accounts.map((a,i)=>[String(i),a])];
 const select=(label,key,options)=>'<label>'+label+'<select class="select" data-viz-filter="'+key+'">'+opts(options,key)+'</select></label>';
 return '<section class="card viz-focus" id="vizExplorer"><div class="viz-focus-head"><div><span class="section-eyebrow">INTERACTIVE FINANCIAL EXPLORER</span><h3>Examine the patterns behind the totals</h3><p>Filter accounts and dates without uploading anything again.</p></div><button type="button" class="viz-focus-button" data-viz-export="csv">Export filtered CSV</button></div>'+
 '<div class="viz-focus-controls">'+select('Account','account',accountChoices)+select('Period','window',[['all','All recorded dates'],['30','Last 30 days'],['90','Last 90 days']])+select('Time grouping','group',[['month','Monthly'],['day','Daily']])+select('Chart mode','mode',[['gross','Credits vs debits'],['net','Net movement']])+'</div>'+
 '<div id="vizFocusResults" aria-live="polite">'+vizFocusResults()+'</div></section>';
}
function vizFocusCSV(){
 const scope=vizScope(),data=vizFocusData(scope.rows);
 const cell=(v,label)=>{let str=String(v??'');if(label&&/^[\s\x00-\x1f]*[=+@-]/.test(str))str="'"+str;return '"'+str.replace(/"/g,'""')+'"';};
 const lines=['section,period,credits_ngn,debits_ngn,net_ngn,transactions'];
 for(const p of data.series)lines.push([cell('period',true),cell(p.period,true),cell((p.credit/100).toFixed(2)),cell((p.debit/100).toFixed(2)),cell(((p.credit-p.debit)/100).toFixed(2)),cell(p.count)].join(','));
 lines.push('');lines.push('category,debits_ngn');
 for(const c of data.cats)lines.push([cell(c.name,true),cell((c.total/100).toFixed(2))].join(','));
 lines.push('');lines.push(cell('Notice',true)+','+cell('Filtered records only; account transfers may be counted twice; no confirmed loss or bank settlement.',true));
 return '\uFEFF'+lines.join('\r\n');
}
function vizExplorerBind(){
 const root=document.getElementById('vizExplorer');if(!root)return;
 root.addEventListener('change',e=>{
  const kind=e.target?.dataset?.vizFilter,value=e.target?.value;
  const accepted={account:['all',...vizScope().accounts.map((_,i)=>String(i))],window:['all','30','90'],group:['day','month'],mode:['gross','net']};
  if(!kind||!accepted[kind]?.includes(value))return;
  vizFocus[kind]=value;
  document.getElementById('vizFocusResults').innerHTML=vizFocusResults();
 });
 root.addEventListener('click',e=>{
  const button=e.target.closest('[data-viz-export]');if(!button)return;
  if(button.dataset.vizExport==='csv'){download(vizFocusCSV(),'moneytrace-filtered-analytics.csv','text/csv;charset=utf-8');toast('Filtered aggregates exported; review before sharing.');}
  if(button.dataset.vizExport==='svg'){const svg=root.querySelector('.viz-focus-plot svg');if(!svg)return;const copy=svg.cloneNode(true);copy.setAttribute('xmlns','http://www.w3.org/2000/svg');download(new XMLSerializer().serializeToString(copy),'moneytrace-timeline.svg','image/svg+xml;charset=utf-8');toast('Chart exported as SVG.');}
 });
}
