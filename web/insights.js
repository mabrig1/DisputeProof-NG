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
 return heading('DATA ANALYSIS & VISUALIZATION','Financial insights',`Explore transaction patterns between ${esc(d.start||'—')} and ${esc(d.end||'—')}.`, `<div class="action-row"><button class="btn btn-neutral" data-action="export-analytics">${ico('down')} Export insights CSV</button><button class="btn btn-primary" data-page="upload">${ico('upload')} New audit</button></div>`)+banner()+`<section class="insight-stats">${stat('AVERAGE DEBIT',vizAmount(s.average_debit),'Across outgoing entries','arrowup')}${stat('MEDIAN DEBIT',vizAmount(s.median_debit),'Typical outgoing entry','coins','blue')}${stat('LARGEST DEBIT',vizAmount(s.largest_debit),'Single observed debit','radar','gold')}${stat('SPENDING CONCENTRATION',`${s.largest_category_share_percent}%`,'Largest category share of debits','graph')}</section><div class="insights-grid"><section class="card insight-card insight-wide"><div class="card-heading"><div><h3>Monthly money movement</h3><p>Credits versus debits across uploaded statements</p></div></div>${vizFlowChart(a.monthly)}</section><section class="card insight-card"><div class="card-heading"><div><h3>Spending breakdown</h3><p>Classification based on transaction narration</p></div></div>${vizSpendingChart(a.spending)}</section><section class="card insight-card"><div class="card-heading"><div><h3>Review flags by severity</h3><p>Counts may overlap across transactions</p></div></div><div class="viz-severity">${a.findings_by_severity.map(x=>`<div class="viz-severity-row"><span>${esc(x.severity)}</span><div><svg viewBox="0 0 100 12" preserveAspectRatio="none"><rect class="sev-${esc(x.severity)}" x="0" y="0" width="${Math.round(x.count/Math.max(1,...a.findings_by_severity.map(y=>y.count))*100)}" height="12" /></svg></div><strong>${x.count}</strong></div>`).join('')}</div></section><section class="card insight-card insight-wide"><div class="card-heading"><div><h3>Daily net movement</h3><p>Cash flow trend, not a bank balance reconstruction</p></div></div>${vizDailyChart(a.daily)}</section><section class="card insight-card insight-wide"><div class="card-heading"><div><h3>Account comparisons</h3><p>Source labels are based on uploaded filenames, not verified identities</p></div></div>${vizAccountTable(a.accounts)}</section><section class="card insight-card insight-wide"><div class="card-heading"><div><h3>Reconciliation coverage</h3><p>Which balances were actually checkable? Missing or ambiguous rows are surfaced.</p></div></div>${vizQuality(r.reconciliation_quality?.accounts)}</section><section class="card insight-card insight-wide"><div class="card-heading"><div><h3>Transfer and reversal tracing</h3><p>Conservative one-to-one candidate matching with no bank-network verification</p></div></div>${vizCandidateMatches(r.matching_audit)}</section><section class="card insight-card insight-wide"><div class="card-heading"><div><h3>Largest recorded debits</h3><p>High amounts alone are not evidence of wrongdoing</p></div></div>${vizTopDebits(a.largest_debits)}</section></div><div class="callout"><strong>How to interpret:</strong> ${a.interpretation.map(esc).join(' ')}</div>`;
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
