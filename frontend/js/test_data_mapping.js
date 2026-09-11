(() => {
  const norm = s => String(s ?? '').normalize('NFKC').replace(/[\s_．.]/g,'').toLowerCase();
  window.LinksTestDataMapping = {
    initialize(host, sheets) {
      host.mappingSheet = 0; host.mappingSelection = {}; host.importPending = true;
      return sheets.map(s => {
        const saved = host.config.importMappings?.find(m => m.name === s.name && JSON.stringify(m.headers) === JSON.stringify(s.headers));
        const type = saved?.type && host.meta.importFields[saved.type] ? saved.type : 'companies';
        const used = new Set();
        const mapping = s.headers.map((h,column) => {
          const f = host.meta.importFields[type].find(f => f.aliases.some(a => norm(a) === norm(h)));
          const key = f && !used.has(f.key) ? f.key : ''; if (key) used.add(key);
          return {column,field:key,mode:'preserve'};
        });
        return {...s,type,enabled:saved?.enabled !== false,mapping:saved ? structuredClone(saved.mapping) : mapping};
      });
    },
    metadata(sheets) { return sheets.map(({name,headers,type,mapping,enabled}) => ({name,headers,type,mapping,enabled})); },
    render(host) {
      if (!host.sheets.length) return host.config.importMappings?.length ? '<p>列の対応付けは設定に保存されています。同じExcelを再選択すると復元できます。</p>' : '';
      const e = host.ctx.escapeHtml, index = host.mappingSheet || 0, s = host.sheets[index], pick = host.mappingSelection || {};
      const fields = host.meta.importFields[s.type], assigned = s.mapping.filter(m => m.field && m.mode !== 'unused');
      return `<section class="td-mapping"><h3>Excel列と取込項目の対応付け</h3>
        <p>左の項目→右の列、または右の列→左の項目をクリックすると連携します。解除は「×」。左右の選択はシート切替で解除されます。</p>
        <label><input type="checkbox" id="td-sheet-enabled" ${s.enabled !== false ? 'checked' : ''}>このシートを取り込む（${s.rows.length}件）</label>
        <div class="td-mapping-grid"><div><label>取込先 <select id="td-map-type">${Object.entries(host.meta.types).map(([k,v]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${e(v)}</option>`).join('')}</select></label>
        <div class="td-mapping-list">${fields.map(f => {
          const m = assigned.find(m => m.field === f.key);
          return `<div class="td-map-target"><button type="button" data-map-target="${e(f.key)}" aria-pressed="${pick.field === f.key}" ${s.enabled === false ? 'disabled' : ''}><strong>${e(f.label)}</strong><span>（${m ? `${m.column + 1}列目：${e(s.headers[m.column] || '見出しなし')}` : '未連携'}）</span></button>
          ${m ? `<button type="button" data-map-clear="${e(f.key)}" aria-label="${e(f.label)}の連携を解除">×</button><select data-map-policy="${e(f.key)}" aria-label="${e(f.label)}の取込方法"><option value="preserve" ${m.mode === 'preserve' ? 'selected' : ''}>維持</option>${f.key === 'name' ? `<option value="fictional" ${m.mode === 'fictional' ? 'selected' : ''}>仮想化</option>` : ''}</select>` : ''}
          ${f.note ? `<small>${e(f.note)}</small>` : ''}</div>`;
        }).join('')}</div></div>
        <div><label>Excel項目 <select id="td-map-sheet" aria-label="Excelシート">${host.sheets.map((r,i) => `<option value="${i}" ${i === index ? 'selected' : ''}>${e(r.name)}${r.enabled === false ? '（対象外）' : ''}</option>`).join('')}</select></label>
        <p>列名 ／ データ1行目 ／ データ2行目</p><div class="td-mapping-list">${s.headers.map((h,column) => {
          const m = assigned.find(m => m.column === column), f = fields.find(f => f.key === m?.field);
          return `<button type="button" class="td-map-column" data-map-column="${column}" aria-pressed="${pick.column === column}" ${s.enabled === false ? 'disabled' : ''}><strong>${column + 1}列目：${e(h || '見出しなし')}</strong><span>${e(s.rows[0]?.[column] || '（空欄）')}</span><span>${e(s.rows[1]?.[column] || '（空欄）')}</span><small>${f ? `→ ${e(f.label)}` : '未連携・取込対象外'}</small></button>`;
        }).join('')}</div></div></div>
        <p role="status">${assigned.length}列を連携済み／${s.headers.length}列。未連携の列は取り込みません。${host.importPending ? '対応付けは未反映です。下のボタンで確認・反映してください。' : '設定へ反映済みです。'}</p>
        <button type="button" class="btn" id="td-normalize">全シートの対応付けを確認して設定に反映</button></section>`;
    },
    bind(host) {
      if (!host.sheets.length) return;
      const s = host.sheets[host.mappingSheet || 0];
      const refresh = () => { const root = document.getElementById('td-mapping-root'); root.innerHTML = this.render(host); this.bind(host); host.bindNormalize(); };
      const changed = () => { host.importPending = true; host.sample = null; host.shared = null; document.getElementById('td-sample-panel')?.remove(); document.getElementById('td-share-panel')?.remove(); refresh(); };
      const assign = () => {
        const pick = host.mappingSelection;
        if (!pick.field || pick.column === undefined) { refresh(); return; }
        const current = s.mapping.find(m => m.column === pick.column);
        if (current?.field && current.field !== pick.field && !window.confirm('このExcel列の連携先を変更します。元の連携を解除してよいですか？')) { host.mappingSelection = {}; refresh(); return; }
        for (const m of s.mapping) if (m.field === pick.field || m.column === pick.column) { m.field = ''; m.mode = 'preserve'; }
        const target = s.mapping.find(m => m.column === pick.column);
        target.field = pick.field; target.mode = 'preserve'; host.mappingSelection = {}; changed();
      };
      document.querySelectorAll('[data-map-target]').forEach(el => el.onclick = () => { host.mappingSelection = {...host.mappingSelection,field:el.dataset.mapTarget}; assign(); });
      document.querySelectorAll('[data-map-column]').forEach(el => el.onclick = () => { host.mappingSelection = {...host.mappingSelection,column:Number(el.dataset.mapColumn)}; assign(); });
      document.querySelectorAll('[data-map-clear]').forEach(el => el.onclick = () => { s.mapping.filter(m => m.field === el.dataset.mapClear).forEach(m => { m.field = ''; m.mode = 'preserve'; }); host.mappingSelection = {}; changed(); });
      document.querySelectorAll('[data-map-policy]').forEach(el => el.onchange = () => { s.mapping.find(m => m.field === el.dataset.mapPolicy).mode = el.value; changed(); });
      document.getElementById('td-map-sheet').onchange = event => { host.mappingSheet = Number(event.target.value); host.mappingSelection = {}; refresh(); };
      document.getElementById('td-sheet-enabled').onchange = event => { s.enabled = event.target.checked; host.mappingSelection = {}; changed(); };
      document.getElementById('td-map-type').onchange = event => {
        const type = event.target.value;
        if (s.mapping.some(m => m.field) && !window.confirm('取込先を変更すると、このシートの対応付けを解除します。よいですか？')) { refresh(); return; }
        s.type = type; s.mapping.forEach(m => { m.field = ''; m.mode = 'preserve'; }); host.mappingSelection = {}; changed();
      };
    },
  };
})();
