(() => {
  window.LinksTestData = {
    async open(ctx) {
      this.ctx = ctx; this.kit = window.LinksFeatureKit.createFeatureKit(ctx); this.kit.clearNav();
      this.meta = await this.call('/meta'); this.config = structuredClone(this.meta.defaults);
      this.draft = null; this.sample = null; this.sheets = []; this.message = ''; this.shared = null; this.importPending = false;
      await this.refreshList(); this.render();
    },
    async call(path, body, method) {
      const options = body === undefined ? {} : { method: method || 'POST', body: body instanceof FormData ? body : JSON.stringify(body) };
      const { res, data } = await this.ctx.api(`/api/test-data${path}`, options);
      if (!res.ok || !data?.ok) throw new Error(data?.message || '検証ツールを利用できません');
      return data;
    },
    async refreshList() { this.saved = (await this.call('/drafts')).drafts; },
    async action(fn) {
      if (this.busy) return; this.busy = true;
      this.ctx.app.querySelectorAll('main input, main select, main button').forEach(el => { el.disabled = true; });
      try { await fn(); } catch (e) { this.message = e.message; }
      finally { this.busy = false; this.render(); }
    },
    read() {
      const q = id => document.getElementById(id);
      for (const k of ['asOf', 'start', 'seed', 'preset']) this.config[k] = q(`td-${k}`).value;
      for (const k of Object.keys(this.meta.types)) this.config.counts[k] = Number(q(`td-count-${k}`).value);
      for (const k of Object.keys(this.config.weights)) this.config.weights[k] = Number(q(`td-weight-${k}`).value);
      this.config.required = [...document.querySelectorAll('[data-required]:checked')].map(el => el.dataset.required);
      this.config.acceptFill = q('td-fill').checked;
      this.config.decisions = Object.fromEntries(this.meta.cases.map(s => [s.id, { status: q(`td-decision-${s.id}`).value, comment: q(`td-comment-${s.id}`).value }]));
    },
    async save() {
      if (this.importPending) throw new Error('先に全シートの対応付けを確認して設定へ反映してください');
      this.read();
      const data = this.draft ? await this.call(`/drafts/${this.draft.id}`, { config: this.config, revision: this.draft.revision }, 'PUT') : await this.call('/drafts', { config: this.config });
      this.draft = data.draft; this.sample = null; this.shared = null; await this.refreshList();
    },
    table(headers, rows) {
      const e = this.ctx.escapeHtml;
      return `<div class="table-wrap"><table class="data-table"><thead><tr>${headers.map(h => `<th>${e(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map(v => `<td>${e(v ?? '')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    },
    render() {
      const e = this.ctx.escapeHtml, c = this.config;
      const input = (id, value, type = 'text') => `<input id="td-${id}" type="${type}" value="${e(value)}" ${type === 'number' ? 'min="0" max="500"' : ''}>`;
      const button = (id, text, disabled = false) => `<button class="btn btn-secondary" id="td-${id}" type="button" ${disabled ? 'disabled' : ''}>${text}</button>`;
      const importHtml = `<div id="td-mapping-root">${window.LinksTestDataMapping.render(this)}</div>`;
      const sampleHtml = this.sample ? `<section class="panel" id="td-sample-panel"><h2>日報サンプル・補完確認</h2><p>${e(this.sample.warnings.join(' / '))}</p>
        <details><summary>補完内容 ${this.sample.fills.length}件</summary><ul>${this.sample.fills.map(f => `<li>${e(f)}</li>`).join('')}</ul></details>
        ${this.table(['ケース','実現件数'], Object.entries(this.sample.achieved).map(([k,v]) => [this.meta.cases.find(s => s.id === k)?.name || k,v]))}
        <details><summary>マスターのサンプル</summary>${Object.entries(this.sample.catalog).map(([k, rows]) => `<h3>${e(this.meta.types[k])}</h3>${this.table(['コード','名称'], rows.slice(0, 20).map(r => [r.code,r.name]))}`).join('')}</details>
        <p>先頭100案件日／全${this.sample.reports.length}件。金額は業務計算接続後に検証します。</p>
        ${this.table(['案件','人物','勤務日','区分','開始','終了','休憩分','距離km','月次目標'], this.sample.reports.slice(0,100).map(r => [r.projectCode,r.partnerCode,r.workDate,r.scenario,r.startTime,r.endTime,r.breakMinutes,r.distanceKm,r.monthlyTarget]))}
        ${button('approve','この設定版のサンプルを承認', !this.sample.approvable)} ${button('share','匿名共有内容を確認')}
        </section>` : '';
      this.ctx.app.innerHTML = this.kit.shell('検証データ作成', `<section class="panel"><h2>検証専用・日報サンプル設計</h2>
        <p>初回機能：取込・設定・サンプル確認。業務DBへの投入、精算、帳票生成は後続実装です。</p>
        <p role="status">${e(this.message)}</p><p>${this.draft ? `設定 ${e(this.draft.id)} / 第${this.draft.revision}版 / ${this.draft.approvedHash ? '承認済み' : '未承認'}` : '新しい設定'}</p>
        <label>保存した設定<select id="td-saved"><option value="">選択</option>${(this.saved || []).map(d => `<option value="${e(d.draft_id)}">${e(d.draft_id)} / 第${d.revision}版</option>`).join('')}</select></label>${button('load','読み込む')}
        </section><section class="panel"><h2>1. 元データ</h2><p>原本は保存しません。維持した正規化値は設定保存時に検証DBへ保存します。各ファイル2MBまで。</p>
        <input type="file" id="td-files" multiple accept=".xlsx,.csv"><select id="td-encoding"><option value="utf8">UTF-8</option><option value="cp932">CP932</option></select>${button('import','ファイルを解析')}
        ${importHtml}</section>
        <section class="panel"><h2>2. 稼働パターン</h2><div class="form-grid">
        <label>基準日${input('asOf',c.asOf,'date')}</label><label>開始日${input('start',c.start,'date')}</label><label>乱数シード${input('seed',c.seed)}</label>
        <label>スタンス<select id="td-preset">${[['realistic','現実の稼働中心'],['coverage','境界・例外中心'],['mixed','混合']].map(([k,v]) => `<option value="${k}" ${c.preset === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        ${Object.entries(this.meta.types).map(([k,v]) => `<label>${e(v)}件数${input(`count-${k}`,c.counts[k],'number')}</label>`).join('')}</div>
        <p>勤務割合は合計100。休日出勤は日曜の稼働確率、その他は平日の構成比として適用。実現件数を下のサンプルで確認してください。</p>
        ${this.meta.cases.map(s => `<fieldset><legend>${e(s.name)}</legend><p>${e(s.purpose)}</p>${s.id in c.weights ? `<label>割合${input(`weight-${s.id}`,c.weights[s.id],'number')}</label>` : ''}
          <label><input type="checkbox" data-required="${s.id}" ${c.required.includes(s.id) ? 'checked' : ''}>必須ケース</label>
          <select id="td-decision-${s.id}">${[['accept','採用'],['adjust','要調整'],['exclude','除外']].map(([k,v]) => `<option value="${k}" ${(c.decisions[s.id]?.status || 'accept') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <label>コメント${input(`comment-${s.id}`,c.decisions[s.id]?.comment || '')}</label></fieldset>`).join('')}
        <label><input id="td-fill" type="checkbox" ${c.acceptFill ? 'checked' : ''}>サンプルの仮想補完内容を確認・採用する</label>
        <div class="btn-row">${button('preview','設定を保存してサンプル表示')}</div></section>${sampleHtml}
        ${this.shared ? `<section class="panel" id="td-share-panel"><h2>匿名共有内容の確認</h2><pre style="max-height:300px;overflow:auto">${e(JSON.stringify(this.shared,null,2))}</pre>${button('download','確認した匿名JSONを保存')}<a class="btn" href="/api/test-data/drafts/${e(this.draft.id)}/share?format=csv">匿名日報CSVを保存</a></section>` : ''}`, { wide: true });
      this.kit.bindShell(); this.bind();
    },
    bind() {
      const click = (id, fn) => document.getElementById(`td-${id}`)?.addEventListener('click', () => this.action(fn));
      click('preview', async () => { await this.save(); this.sample = (await this.call(`/drafts/${this.draft.id}/preview`, {})).preview; this.message = '設定を保存しました。補完内容と勤務サンプルを確認してください。'; });
      click('load', async () => { const id = document.getElementById('td-saved').value; if (!id) return; this.draft = (await this.call(`/drafts/${id}`)).draft; this.config = structuredClone(this.draft.config); this.sample = null; this.shared = null; this.sheets = []; this.importPending = false; });
      click('import', async () => { this.read(); const form = new FormData(); for (const file of document.getElementById('td-files').files) form.append('files', file); form.append('encoding', document.getElementById('td-encoding').value);
        this.sheets = window.LinksTestDataMapping.initialize(this, (await this.call('/imports', form)).sheets); this.sample = null; this.shared = null; });
      window.LinksTestDataMapping.bind(this); this.bindNormalize();
      click('approve', async () => { this.read(); if (this.importPending || JSON.stringify(this.config) !== JSON.stringify(this.draft.config)) throw new Error('変更後の設定を保存し、サンプルを再表示してください');
        this.draft = (await this.call(`/drafts/${this.draft.id}/approve`, { revision: this.draft.revision, hash: this.sample.hash })).draft; this.message = 'この設定版を承認しました。業務DB生成はまだ実施していません。'; });
      click('share', async () => {
        this.read(); if (this.importPending || JSON.stringify(this.config) !== JSON.stringify(this.draft.config)) throw new Error('共有前に変更後の設定を保存し、サンプルを再表示してください');
        const data = await this.call(`/drafts/${this.draft.id}/share`); this.shared = data.package; this.message = '匿名版を再サンプリングしました。元の名称・自由コメントは含みません。';
      });
      click('download', async () => { const url = URL.createObjectURL(new Blob([JSON.stringify(this.shared,null,2)], { type:'application/json' })); const a = document.createElement('a'); a.href = url; a.download = 'anonymous-test-data.json'; a.click(); setTimeout(() => URL.revokeObjectURL(url),1000); });
      document.getElementById('td-preset').addEventListener('change', () => { this.read(); this.config.weights = structuredClone(this.meta.presets[this.config.preset]); this.sample = null; this.render(); });
    },
    bindNormalize() {
      const button = document.getElementById('td-normalize'); if (!button) return;
      button.onclick = () => this.action(async () => {
        this.read(); const sheets = structuredClone(this.sheets.filter(s => s.enabled !== false));
        if (!sheets.length) throw new Error('取込対象のシートを選択してください');
        const ignored = sheets.flatMap(s => s.headers.filter((h,i) => !s.mapping.some(m => m.column === i && m.field && m.mode !== 'unused')).map(h => `${s.name}: ${h || '見出しなし'}`));
        const result = await this.call('/normalize', { sheets });
        if (result.issues.length) throw new Error(result.issues.join(' / '));
        if (ignored.length && !window.confirm(`未連携の${ignored.length}列は取り込みません。続行しますか？\n${ignored.join('\n')}`)) return;
        Object.assign(this.config.catalog, result.catalog); Object.assign(this.config.counts, result.counts);
        this.config.importMappings = window.LinksTestDataMapping.metadata(this.sheets);
        this.config.acceptFill = false; this.importPending = false; this.sample = null; this.shared = null;
        this.message = '対応付けと取込件数を設定に反映しました。「設定を保存してサンプル表示」で保存してください。';
      });
    },
  };
})();
