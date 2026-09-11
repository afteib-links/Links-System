(() => {
  const norm = s => String(s ?? '').normalize('NFKC').replace(/[\s_．.]/g,'').toLowerCase();
  window.LinksTestDataMapping = {
    suggested(host, sheet, type) {
      const used = new Set();
      return sheet.headers.map((h,column) => {
        const f = host.meta.importFields[type].find(f => f.aliases.some(a => norm(a) === norm(h)));
        const key = f && !used.has(f.key) ? f.key : ''; if (key) used.add(key);
        return {column,field:key,mode:'preserve'};
      });
    },
    target(host, sheet, type) {
      let target = sheet.targets.find(t => t.type === type);
      if (!target) {
        target = {type,enabled:false,duplicatePolicy:'error',mapping:this.suggested(host,sheet,type)};
        sheet.targets.push(target);
      }
      return target;
    },
    inferType(host, sheet) {
      const name = norm(sheet.name);
      if (/基本案件/.test(name)) return 'baseProjects';
      if (/個別案件|案件一覧/.test(name)) return 'projects';
      if (/稼働者|パートナー|人物/.test(name)) return 'partners';
      if (/担当者|営業担当|社員/.test(name)) return 'staff';
      if (/企業|会社/.test(name)) return 'companies';
      const scores = Object.fromEntries(Object.keys(host.meta.importFields).map(type => [type, 0]));
      for (const type of Object.keys(scores)) for (const heading of sheet.headers) {
        if (host.meta.importFields[type].some(f => f.aliases.some(a => norm(a) === norm(heading)))) scores[type]++;
      }
      return Object.entries(scores).sort((a,b) => b[1] - a[1])[0]?.[0] || 'companies';
    },
    initialize(host, sheets) {
      host.mappingSheet = 0; host.mappingSelection = {}; host.importPending = true;
      return sheets.map(s => {
        const saved = host.config.importMappings?.find(m => m.name === s.name && JSON.stringify(m.headers) === JSON.stringify(s.headers));
        const inferred = this.inferType(host, s);
        const legacy = saved?.type ? [{type:saved.type,enabled:true,duplicatePolicy:saved.duplicatePolicy || 'error',mapping:saved.mapping}] : null;
        const targets = structuredClone(saved?.targets || legacy || [{type:inferred,enabled:true,duplicatePolicy:'error',mapping:this.suggested(host,s,inferred)}]);
        return {...s,type:targets.find(t => t.enabled)?.type || inferred,enabled:saved?.enabled !== false,targets};
      });
    },
    metadata(sheets) { return sheets.map(({name,headers,targets,enabled}) => ({name,headers,targets,enabled})); },
    render(host) {
      if (!host.sheets.length) return host.config.importMappings?.length ? '<p>列の対応付けは設定に保存されています。同じExcelを再選択すると復元できます。</p>' : '';
      const e = host.ctx.escapeHtml, index = host.mappingSheet || 0, s = host.sheets[index], pick = host.mappingSelection || {};
      const target = this.target(host,s,s.type), fields = host.meta.importFields[s.type], assigned = target.mapping.filter(m => m.field && m.mode !== 'unused');
      const targetSummary = s.targets.filter(t => t.enabled && t.mapping.some(m => m.field)).map(t => `<button type="button" data-map-type-tab="${t.type}" class="${t.type === s.type ? 'active' : ''}">${e(host.meta.types[t.type])} ${t.mapping.filter(m => m.field).length}列</button>`).join('');
      return `<section class="td-mapping"><div class="td-mapping-head"><div><h3>Excel列と取込項目の対応付け</h3>
        <p>左の取込項目と右のExcel列を1つずつ押すと連携します。</p></div>
        <label>このシートの扱い<select id="td-sheet-enabled"><option value="1" ${s.enabled !== false ? 'selected' : ''}>取り込む（${s.rows.length}件）</option><option value="0" ${s.enabled === false ? 'selected' : ''}>取り込まない</option></select></label></div>
        <div class="td-target-tabs"><span>このシートから取り込むマスター：</span>${targetSummary || '<span>未設定</span>'}</div>
        <div class="td-mapping-grid"><div><div class="td-map-settings"><label>編集中の取込先 <select id="td-map-type">${Object.entries(host.meta.types).map(([k,v]) => `<option value="${k}" ${s.type === k ? 'selected' : ''}>${e(v)}</option>`).join('')}</select></label>
        <label>同じ番号が重複した場合<select id="td-duplicate-policy"><option value="error" ${target.duplicatePolicy === 'error' ? 'selected' : ''}>エラーにする</option><option value="first" ${target.duplicatePolicy === 'first' ? 'selected' : ''}>先の行を優先</option><option value="last" ${target.duplicatePolicy === 'last' ? 'selected' : ''}>後の行を優先</option><option value="averageFloor" ${target.duplicatePolicy === 'averageFloor' ? 'selected' : ''}>平均値（小数切捨て）</option><option value="averageCeil" ${target.duplicatePolicy === 'averageCeil' ? 'selected' : ''}>平均値（小数切上げ）</option></select></label></div>
        <p class="td-target-state">${target.enabled ? `${e(host.meta.types[s.type])}を取込対象にしています。` : '列を1つ連携すると、この取込先が追加されます。'} 数値平均では文字項目は先／後の空欄でない値を使用します。</p>
        <div class="td-mapping-list">${fields.map(f => {
          const m = assigned.find(m => m.field === f.key);
          return `<div class="td-map-target"><button type="button" data-map-target="${e(f.key)}" aria-pressed="${pick.field === f.key}" ${s.enabled === false ? 'disabled' : ''}><strong>${e(f.label)}</strong><span>（${m ? `${m.column + 1}列目：${e(s.headers[m.column] || '見出しなし')}` : '未連携'}）</span></button>
          ${m ? `<button type="button" data-map-clear="${e(f.key)}" aria-label="${e(f.label)}の連携を解除">×</button><select data-map-policy="${e(f.key)}" aria-label="${e(f.label)}の取込方法"><option value="preserve" ${m.mode === 'preserve' ? 'selected' : ''}>維持</option>${f.key === 'name' ? `<option value="fictional" ${m.mode === 'fictional' ? 'selected' : ''}>仮想化</option>` : ''}</select>` : ''}
          ${f.note ? `<small title="${e(f.note)}">補足：${e(f.note)}</small>` : ''}</div>`;
        }).join('')}</div></div>
        <div><label>Excel項目 <select id="td-map-sheet" aria-label="Excelシート">${host.sheets.map((r,i) => `<option value="${i}" ${i === index ? 'selected' : ''}>${e(r.name)}${r.enabled === false ? '（対象外）' : ''}</option>`).join('')}</select></label>
        <p>列名 ／ データ1行目 ／ データ2行目</p><div class="td-mapping-list">${s.headers.map((h,column) => {
          const m = assigned.find(m => m.column === column), f = fields.find(f => f.key === m?.field);
          return `<button type="button" class="td-map-column" data-map-column="${column}" aria-pressed="${pick.column === column}" ${s.enabled === false ? 'disabled' : ''}><strong>${column + 1}列目：${e(h || '見出しなし')}</strong><span>${e(s.rows[0]?.[column] || '（空欄）')}</span><span>${e(s.rows[1]?.[column] || '（空欄）')}</span><small>${f ? `→ ${e(f.label)}` : '未連携・取込対象外'}</small></button>`;
        }).join('')}</div></div></div>
        <div class="td-mapping-footer"><p role="status">${assigned.length}列を連携済み／${s.headers.length}列。取込先を切り替えても連携は残ります。${host.importPending ? '保存時に自動反映します。' : '設定へ反映済みです。'}</p>
        <button type="button" class="btn" id="td-normalize">列の連携を設定へ反映</button></div></section>`;
    },
    bind(host) {
      if (!host.sheets.length) return;
      const s = host.sheets[host.mappingSheet || 0], target = this.target(host,s,s.type);
      const refresh = () => {
        const root = document.getElementById('td-mapping-root');
        const scroll = [...root.querySelectorAll('.td-mapping-list')].map(el => el.scrollTop);
        root.innerHTML = this.render(host);
        [...root.querySelectorAll('.td-mapping-list')].forEach((el,i) => { el.scrollTop = scroll[i] || 0; });
        this.bind(host); host.bindNormalize();
      };
      const changed = () => { host.importPending = true; host.sample = null; host.shared = null; document.getElementById('td-sample-panel')?.remove(); document.getElementById('td-share-panel')?.remove(); refresh(); };
      const assign = () => {
        const pick = host.mappingSelection;
        if (!pick.field || pick.column === undefined) { refresh(); return; }
        const current = target.mapping.find(m => m.column === pick.column);
        if (current?.field && current.field !== pick.field && !window.confirm('このExcel列の連携先を変更します。元の連携を解除してよいですか？')) { host.mappingSelection = {}; refresh(); return; }
        for (const m of target.mapping) if (m.field === pick.field || m.column === pick.column) { m.field = ''; m.mode = 'preserve'; }
        const mapped = target.mapping.find(m => m.column === pick.column);
        mapped.field = pick.field; mapped.mode = 'preserve'; target.enabled = true; host.mappingSelection = {}; changed();
      };
      document.querySelectorAll('[data-map-target]').forEach(el => el.onclick = () => { host.mappingSelection = {...host.mappingSelection,field:el.dataset.mapTarget}; assign(); });
      document.querySelectorAll('[data-map-column]').forEach(el => el.onclick = () => { host.mappingSelection = {...host.mappingSelection,column:Number(el.dataset.mapColumn)}; assign(); });
      document.querySelectorAll('[data-map-clear]').forEach(el => el.onclick = () => { target.mapping.filter(m => m.field === el.dataset.mapClear).forEach(m => { m.field = ''; m.mode = 'preserve'; }); target.enabled = target.mapping.some(m => m.field); host.mappingSelection = {}; changed(); });
      document.querySelectorAll('[data-map-policy]').forEach(el => el.onchange = () => { target.mapping.find(m => m.field === el.dataset.mapPolicy).mode = el.value; changed(); });
      document.querySelectorAll('[data-map-type-tab]').forEach(el => el.onclick = () => { s.type = el.dataset.mapTypeTab; host.mappingSelection = {}; refresh(); });
      document.getElementById('td-map-sheet').onchange = event => { host.mappingSheet = Number(event.target.value); host.mappingSelection = {}; refresh(); };
      document.getElementById('td-sheet-enabled').onchange = event => { s.enabled = event.target.value === '1'; host.mappingSelection = {}; changed(); };
      document.getElementById('td-duplicate-policy').onchange = event => { target.duplicatePolicy = event.target.value; changed(); };
      document.getElementById('td-map-type').onchange = event => {
        s.type = event.target.value; this.target(host,s,s.type); host.mappingSelection = {}; refresh();
      };
    },
  };
})();
