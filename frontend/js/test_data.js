(() => {
  window.LinksTestData = {
    async open(ctx) {
      this.ctx = ctx; this.kit = window.LinksFeatureKit.createFeatureKit(ctx); this.kit.clearNav();
      this.meta = await this.call('/meta'); this.config = structuredClone(this.meta.defaults);
      this.draft = null; this.sample = null; this.sheets = []; this.message = ''; this.shared = null; this.importPending = false; this.job = null; this.monthlyJob = null; this.settlementJob = null;
      await Promise.all([this.refreshList(), this.refreshJobs(), this.refreshMonthlyJobs(), this.refreshSettlementJobs()]); this.render();
    },
    async call(path, body, method) {
      const options = body === undefined ? {} : { method: method || 'POST', body: body instanceof FormData ? body : JSON.stringify(body) };
      const { res, data } = await this.ctx.api(`/api/test-data${path}`, options);
      if (!res.ok || !data?.ok) throw new Error(data?.message || '検証ツールを利用できません');
      return data;
    },
    async refreshList() { this.saved = (await this.call('/drafts')).drafts; },
    syncJob() { this.job = this.draft ? (this.jobs || []).find(j => j.draftId === this.draft.id && j.revision === this.draft.revision) || null : null; this.syncMonthlyJob(); },
    async refreshJobs() { this.jobs = (await this.call('/jobs')).jobs; this.syncJob(); },
    syncMonthlyJob() { this.monthlyJob = this.job ? (this.monthlyJobs || []).find(j => j.dailyJobId === this.job.id) || null : null; this.syncSettlementJob(); },
    async refreshMonthlyJobs() { this.monthlyJobs = (await this.call('/monthly-jobs')).jobs; this.syncMonthlyJob(); },
    syncSettlementJob() { this.settlementJob = this.monthlyJob ? (this.settlementJobs || []).find(j => j.monthlyJobId === this.monthlyJob.id) || null : null; },
    async refreshSettlementJobs() { this.settlementJobs=(await this.call('/settlement-jobs')).jobs; this.syncSettlementJob(); },
    async pollJob(id) {
      for (;;) {
        await new Promise(resolve => setTimeout(resolve, 1000));
        this.job = (await this.call(`/jobs/${id}`)).job; this.render();
        if (['completed','failed'].includes(this.job.status)) break;
      }
      this.message = this.job.status === 'completed' ? '日報生成と検証が完了しました。' : `日報生成に失敗しました: ${this.job.error}`;
      await Promise.all([this.refreshJobs(),this.refreshMonthlyJobs()]); this.render();
    },
    async pollMonthlyJob(id) {
      for (;;) {
        await new Promise(resolve => setTimeout(resolve,1000));
        this.monthlyJob=(await this.call(`/monthly-jobs/${id}`)).job; this.render();
        if(['completed','failed'].includes(this.monthlyJob.status))break;
      }
      this.message=this.monthlyJob.status==='completed' ? '日報提出・月次承認の生成と検証が完了しました。' : `月次生成に失敗しました: ${this.monthlyJob.error}`;
      await this.refreshMonthlyJobs(); this.render();
    },
    async pollSettlementJob(id) {
      for (;;) {
        await new Promise(resolve => setTimeout(resolve,1000));
        this.settlementJob=(await this.call(`/settlement-jobs/${id}`)).job; this.render();
        if(['completed','failed'].includes(this.settlementJob.status))break;
      }
      this.message=this.settlementJob.status==='completed' ? '先払・請求・支払の生成と検証が完了しました。' : `精算生成に失敗しました: ${this.settlementJob.error}`;
      await this.refreshSettlementJobs(); this.render();
    },
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
      this.read();
      if (this.importPending) await this.applyMappings();
      const data = this.draft ? await this.call(`/drafts/${this.draft.id}`, { config: this.config, revision: this.draft.revision }, 'PUT') : await this.call('/drafts', { config: this.config });
      this.draft = data.draft; this.sample = null; this.shared = null; this.syncJob(); await this.refreshList();
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
      const jobHtml = this.draft?.approvedHash ? `<section class="panel"><h2>3. 日報生成</h2>
        <p>承認済み設定を専用検証DBへ登録し、現行の料金計算を実行します。通常DB・本番DBには接続しません。</p>
        ${button('generate','承認済みサンプルから日報を生成', this.job && ['queued','running'].includes(this.job.status))}
        ${this.job ? `<p role="status">状態: ${e(this.job.status)} / ${this.job.processed.toLocaleString()} / ${this.job.total.toLocaleString()}件</p>
        <progress value="${this.job.processed}" max="${Math.max(1,this.job.total)}"></progress>${this.job.error ? `<p class="error">${e(this.job.error)}</p>` : ''}` : ''}
        </section>` : '';
      const monthlyHtml = this.job?.status === 'completed' ? `<section class="panel"><h2>4. 日報提出・月次承認</h2>
        <p>完了月は原則承認済み、前月は承認済み・承認待ち・差戻し・未申請を混在、当月は提出途中とします。</p>
        ${button('generate-monthly','日報提出・月次承認を生成',this.monthlyJob && ['queued','running'].includes(this.monthlyJob.status))}
        ${this.monthlyJob ? `<p role="status">状態: ${e(this.monthlyJob.status)} / ${this.monthlyJob.processed.toLocaleString()} / ${this.monthlyJob.total.toLocaleString()}件</p>
        <progress value="${this.monthlyJob.processed}" max="${Math.max(1,this.monthlyJob.total)}"></progress>${this.monthlyJob.error ? `<p class="error">${e(this.monthlyJob.error)}</p>` : ''}` : ''}</section>` : '';
      const settlementHtml = this.monthlyJob?.status === 'completed' ? `<section class="panel"><h2>5. 先払・請求・支払</h2>
        <p>承認済み月次データだけを対象に、30名の3サイクル先払と請求・支払下書きを作ります。完了月は承認済み、前月は処理状態を混在させ、手入力調整も含めます。</p>
        ${button('generate-settlements','先払・請求・支払を生成',this.settlementJob && ['queued','running'].includes(this.settlementJob.status))}
        ${this.settlementJob ? `<p role="status">状態: ${e(this.settlementJob.status)} / ${this.settlementJob.processed.toLocaleString()} / ${this.settlementJob.total.toLocaleString()}件</p>
        <progress value="${this.settlementJob.processed}" max="${Math.max(1,this.settlementJob.total)}"></progress>${this.settlementJob.error ? `<p class="error">${e(this.settlementJob.error)}</p>` : ''}${this.settlementJob.manifest ? `<details><summary>生成結果</summary><pre>${e(JSON.stringify(this.settlementJob.manifest,null,2))}</pre></details>` : ''}` : ''}</section>` : '';
      this.ctx.app.innerHTML = this.kit.shell('検証データ作成', `<section class="panel"><h2>検証専用・日報サンプル設計</h2>
        <p>取込・設定・サンプル承認後、専用検証DBへ日報、日報提出、月次承認、先払、請求、支払を順に生成できます。帳票・銀行CSVは後続段階です。</p>
        <p role="status" class="td-status">${e(this.message || 'Excelを使う場合はファイル解析と列連携を行い、最後に「設定を保存してサンプル表示」を押してください。')}</p><p>${this.draft ? `設定 ${e(this.draft.id)} / 第${this.draft.revision}版 / ${this.draft.approvedHash ? '承認済み' : '未承認'}` : '新しい設定'}</p>
        <label>保存した設定<select id="td-saved"><option value="">選択</option>${(this.saved || []).map(d => `<option value="${e(d.draft_id)}">${e(d.draft_id)} / 第${d.revision}版</option>`).join('')}</select></label>${button('load','読み込む')}
        </section><section class="panel"><h2>1. 元データ</h2><p>原本は保存しません。維持した正規化値は設定保存時に検証DBへ保存します。各ファイル2MBまで。</p>
        <details class="td-import-help"><summary>Excelデータの取込方法</summary><ol><li>ファイルを選び「ファイルを解析」を押します。</li><li>Excelシートと「編集中の取込先」を選びます。</li><li>左の取込項目と右のExcel列を順に押して連携します。複数マスターは取込先を切り替えて繰り返します。</li><li>必要なら重複時の処理を選び、最後に「設定を保存してサンプル表示」を押します。</li></ol></details>
        <p>「マスターデータ取込」で完成Excelを登録済みの場合は、再度Excelを選ばずにその内容を利用できます。</p>
        <div class="btn-row">${button('registered','登録済みマスターを利用')}</div>
        <input type="file" id="td-files" multiple accept=".xlsx,.csv"><select id="td-encoding"><option value="utf8">UTF-8</option><option value="cp932">CP932</option></select>${button('import','ファイルを解析')}
        ${importHtml}</section>
        <section class="panel"><h2>2. 稼働パターン</h2><div class="form-grid">
        <label>基準日${input('asOf',c.asOf,'date')}</label><label>開始日${input('start',c.start,'date')}</label><label>乱数シード${input('seed',c.seed)}</label>
        <label>スタンス<select id="td-preset">${[['realistic','現実の稼働中心'],['coverage','境界・例外中心'],['mixed','混合']].map(([k,v]) => `<option value="${k}" ${c.preset === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
        ${Object.entries(this.meta.types).map(([k,v]) => `<label>${e(v)}件数${input(`count-${k}`,c.counts[k],'number')}</label>`).join('')}</div>
        <p>勤務割合は合計100。休日出勤は日曜の稼働確率、その他は平日の構成比として適用。実現件数を下のサンプルで確認してください。</p>
        <div class="td-case-grid">${this.meta.cases.map(s => `<fieldset><legend>${e(s.name)}</legend><p>${e(s.purpose)}</p>${s.id in c.weights ? `<label>割合${input(`weight-${s.id}`,c.weights[s.id],'number')}</label>` : ''}
          <label class="td-required-case" title="ONにすると、この勤務パターンをサンプルへ最低1件作ります"><input type="checkbox" data-required="${s.id}" ${c.required.includes(s.id) ? 'checked' : ''}>サンプルに必ず1件以上含める</label>
          <select id="td-decision-${s.id}">${[['accept','採用'],['adjust','要調整'],['exclude','除外']].map(([k,v]) => `<option value="${k}" ${(c.decisions[s.id]?.status || 'accept') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
          <label>コメント${input(`comment-${s.id}`,c.decisions[s.id]?.comment || '')}</label></fieldset>`).join('')}</div>
        <div class="td-confirm-fill"><label><input id="td-fill" type="checkbox" ${c.acceptFill ? 'checked' : ''}>不足する名称・関連先を仮の値で補うことを許可する</label><small>Excelに不足項目がある場合だけ使います。補完内容はサンプル表示後に確認できます。</small></div>
        <div class="btn-row">${button('preview','設定を保存してサンプル表示')}</div></section>${sampleHtml}
        ${jobHtml}${monthlyHtml}${settlementHtml}${this.shared ? `<section class="panel" id="td-share-panel"><h2>匿名共有内容の確認</h2><pre style="max-height:300px;overflow:auto">${e(JSON.stringify(this.shared,null,2))}</pre>${button('download','確認した匿名JSONを保存')}<a class="btn" href="/api/test-data/drafts/${e(this.draft.id)}/share?format=csv">匿名日報CSVを保存</a></section>` : ''}`, { wide: true });
      this.kit.bindShell(); this.bind();
    },
    bind() {
      const click = (id, fn) => document.getElementById(`td-${id}`)?.addEventListener('click', () => this.action(fn));
      click('preview', async () => { await this.save(); this.sample = (await this.call(`/drafts/${this.draft.id}/preview`, {})).preview; this.message = '設定を保存しました。補完内容と勤務サンプルを確認してください。'; });
      click('load', async () => { const id = document.getElementById('td-saved').value; if (!id) return; this.draft = (await this.call(`/drafts/${id}`)).draft; this.config = structuredClone(this.draft.config); this.syncJob(); this.sample = null; this.shared = null; this.sheets = []; this.importPending = false; });
      click('import', async () => { this.read(); const form = new FormData(); for (const file of document.getElementById('td-files').files) form.append('files', file); form.append('encoding', document.getElementById('td-encoding').value);
        this.sheets = window.LinksTestDataMapping.initialize(this, (await this.call('/imports', form)).sheets); this.sample = null; this.shared = null; });
      click('registered', async () => {
        this.read();
        const hasCatalog = Object.values(this.config.catalog || {}).some(rows => Array.isArray(rows) && rows.length);
        if (hasCatalog && !window.confirm('現在の取込カタログを、登録済みマスターの内容へ置き換えます。よろしいですか？')) return;
        const data = await this.call('/registered-masters');
        this.config.catalog = { ...this.config.catalog, ...data.catalog };
        this.config.counts = { ...this.config.counts, ...data.counts };
        this.config.importMappings = [{ source:'registered-master', label:'マスターデータ取込の登録済みデータ' }];
        this.config.acceptFill = false; this.sheets = []; this.importPending = false; this.sample = null; this.shared = null;
        this.message = `登録済みマスター ${Object.values(data.counts).reduce((a,b) => a + b, 0)}件を設定へ反映しました。設定を保存して日報サンプルを確認してください。`;
      });
      window.LinksTestDataMapping.bind(this); this.bindNormalize();
      click('approve', async () => { this.read(); if (this.importPending || JSON.stringify(this.config) !== JSON.stringify(this.draft.config)) throw new Error('変更後の設定を保存し、サンプルを再表示してください');
        this.draft = (await this.call(`/drafts/${this.draft.id}/approve`, { revision: this.draft.revision, hash: this.sample.hash })).draft; this.message = 'この設定版を承認しました。日報生成を実行できます。'; });
      click('generate', async () => {
        const data = await this.call(`/drafts/${this.draft.id}/generate`, {}); this.job = data.job;
        this.message = this.job.status === 'completed' ? 'この設定版の日報は生成済みです。' : '専用検証DBへの日報生成を開始しました。';
        if (!['completed','failed'].includes(this.job.status)) this.pollJob(this.job.id);
      });
      click('generate-monthly', async () => {
        const data=await this.call(`/jobs/${this.job.id}/generate-monthly`,{}); this.monthlyJob=data.job;
        this.message=this.monthlyJob.status==='completed' ? 'この日報の月次データは生成済みです。' : '日報提出・月次承認の生成を開始しました。';
        if(!['completed','failed'].includes(this.monthlyJob.status))this.pollMonthlyJob(this.monthlyJob.id);
      });
      click('generate-settlements', async () => {
        const data=await this.call(`/monthly-jobs/${this.monthlyJob.id}/generate-settlements`,{});this.settlementJob=data.job;
        this.message=this.settlementJob.status==='completed'?'この月次データの先払・請求・支払は生成済みです。':'先払・請求・支払の生成を開始しました。';
        if(!['completed','failed'].includes(this.settlementJob.status))this.pollSettlementJob(this.settlementJob.id);
      });
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
        this.read(); await this.applyMappings();
      });
    },
    async applyMappings() {
      const sheets = structuredClone(this.sheets.filter(s => s.enabled !== false).flatMap(s => s.targets
        .filter(t => t.enabled && t.mapping.some(m => m.field))
        .map(t => ({name:`${s.name} / ${this.meta.types[t.type]}`,headers:s.headers,rows:s.rows,type:t.type,mapping:t.mapping,duplicatePolicy:t.duplicatePolicy}))));
      if (!sheets.length) throw new Error('取り込むシートがありません。「このシートの扱い」を確認してください');
      const ignored = sheets.reduce((n,s) => n + s.headers.filter((h,i) => !s.mapping.some(m => m.column === i && m.field && m.mode !== 'unused')).length, 0);
      const result = await this.call('/normalize', { sheets });
      if (result.issues.length) throw new Error(result.issues.join(' / '));
      Object.assign(this.config.catalog, result.catalog); Object.assign(this.config.counts, result.counts);
      this.config.importMappings = window.LinksTestDataMapping.metadata(this.sheets);
      this.config.acceptFill = false; this.importPending = false; this.sample = null; this.shared = null;
      this.message = `${result.counts ? Object.values(result.counts).reduce((a,b) => a + b, 0) : 0}件を設定へ反映しました。未連携の${ignored}列は取り込んでいません。`;
    },
  };
})();
