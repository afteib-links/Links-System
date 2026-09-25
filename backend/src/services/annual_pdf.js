const escape=value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
const money=value=>`${Number(value||0).toLocaleString('ja-JP')}円`;
function renderAnnual(closing,type){
  const snapshot=closing.snapshot_data,side=type==='invoice'?'billing':'payment',label=type==='invoice'?'請求':'支払';
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><style>@page{size:A4;margin:15mm}body{font-family:"BIZ UDPGothic",sans-serif;font-size:10pt;color:#172033}h1{font-size:20pt}h2{font-size:14pt}table{border-collapse:collapse;width:100%;margin:12px 0}th,td{border:1px solid #667085;padding:7px}th{background:#e9eff6}td:nth-child(n+2){text-align:right}thead{display:table-header-group}tr{break-inside:avoid}.notice{border:2px solid #ad6610;padding:12px;font-weight:bold}.detail{font-size:9pt}.sum{font-size:15pt;font-weight:bold}</style></head><body>
    <h1>年度保存用 ${label}集計書</h1><h2>${escape(snapshot.label)} ／ 第${closing.revision_no}版</h2><p class="notice">年度末時点の金額を固定した保存帳票です。この帳票による請求・支払、入出金予定の作成は行いません。</p>
    <p>年度対象: ${escape(snapshot.period_start)}〜${escape(snapshot.period_end)} ／ 前年11月締日後: ${snapshot.settings.include_previous_tail?'年間総額に含む':'年間総額から除外'}</p>
    <table><tr><th>通常集計</th><th>当年11月締日後</th><th>前年調整（控除）</th><th>年間総額</th></tr><tr><td>${money(snapshot.normal[side])}</td><td>${money(snapshot.tail[side])}</td><td>${money(snapshot.settings.include_previous_tail?0:snapshot.previous[side])}</td><td class="sum">${money(snapshot.totals[side])}</td></tr></table>
    <p>作成・訂正理由: ${escape(closing.reason)}</p>
    <table class="detail"><thead><tr><th>企業・案件・パートナー</th><th>通常</th><th>11月実績</th><th>11月手動計上</th></tr></thead><tbody>${snapshot.details.map(d=>`<tr><td>${escape(d.project.company_name)} / ${escape(d.project.template_name||`案件#${d.project.project_id}`)} / ${escape(d.project.partner_name)}<br>${escape(d.tail_manual.reason||'')}</td><td>${money(d.normal[side])}</td><td>${money(d.tail_auto[side])}</td><td>${money(d.tail_manual[side])}</td></tr>`).join('')}</tbody></table>
    <h2>通常帳票の調整明細</h2>${snapshot.document_adjustments.filter(l=>l.settlement_type===type).map(l=>`<p>#${l.settlement_id} ${escape(l.item_name)} ${money(l.amount)} ／ ${escape(l.reason)}</p>`).join('')||'<p>該当なし</p>'}
    <h2>11月締日後の実績根拠</h2>${snapshot.details.filter(d=>d.tail_start).map(d=>`<h3>案件#${d.project.project_id} ${escape(d.tail_start)}〜${escape(d.tail_end)}</h3><p>対象日報: ${d.tail_reports.map(r=>`${escape(r.work_date)}（#${r.daily_report_id}）`).join('、')||'なし'}</p>${d.tail_items.map(i=>`<p>${escape(i.item_name)}: ${escape(i.work_date||'日別燃料の11月分')} / 設定・価格・日別金額は同版の電子明細に保存</p>`).join('')}`).join('')}
    ${snapshot.warnings.length?`<h2>確認した注意事項</h2><p>${escape(closing.input_data.warning_reason)}</p>${snapshot.warnings.map(w=>`<p>案件#${w.project_id} ${escape(w.month||'')}: ${escape(w.message)}</p>`).join('')}`:''}
    <p>前年根拠: ${snapshot.previous_closing_id?`年度保存#${snapshot.previous_closing_id} 第${snapshot.previous_revision}版`:escape(closing.input_data.previous_none?'初年度・前年分該当なし確認':closing.input_data.previous_reason)}</p>
    <p>通常の請求書・支払明細は従来の締め期間で別途作成します。訂正は旧版を残して新版を作成します。</p></body></html>`;
}
module.exports={renderAnnual};
