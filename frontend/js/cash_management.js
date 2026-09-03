(() => {
  const LinksCashManagement = {
    async open(ctx) {
      this.ctx = ctx;
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ym = this.kit.currentYearMonth();
      await this.show();
    },
    status(value) {
      return ({ planned:'予定作成済み', exported:'CSV出力済み', held:'保留', executed:'実行済み', cancelled:'取消済み', active:'有効' }[value] || value || '未設定');
    },
    async show(message = '') {
      this.ctx.renderLoading();
      const [cyclesResult, schedulesResult, exportsResult] = await Promise.all([
        this.ctx.api(`/api/cash-management/cycles?target_year_month=${this.ym}`),
        this.ctx.api(`/api/cash-management/schedules?target_year_month=${this.ym}`),
        this.ctx.api(`/api/cash-management/exports?target_year_month=${this.ym}`),
      ]);
      if (!cyclesResult.res.ok || !schedulesResult.res.ok) {
        this.ctx.app.innerHTML = this.kit.shell('入出金管理・CSV', '<section class="panel"><p class="error">データを取得できませんでした</p></section>');
        this.kit.bindShell();
        return;
      }
      const cycles = cyclesResult.data.cycles || [];
      const schedules = schedulesResult.data.schedules || [];
      const batches = exportsResult.data?.batches || [];
      const summary = {
        total:schedules.length,
        waiting:schedules.filter((s) => ['planned','exported','held'].includes(s.status)).length,
        done:schedules.filter((s) => s.status === 'executed').length,
        attention:schedules.filter((s) => ['held','cancelled'].includes(s.status)).length,
      };
      const cycleOptions = cycles.map((c) => `<option value="${c.cash_cycle_id}">${c.cycle_code === 'end' ? '末日' : Number(c.cycle_code)}日回（出金 ${String(c.planned_outgoing_date).slice(0,10)}）</option>`).join('');
      const rows = schedules.map((s) => {
        const actual = Number(s.executed_amount || 0);
        const difference = actual - Number(s.amount);
        const actions = [
          ['planned','held'].includes(s.status) ? `<button class="btn btn-ghost btn-small" data-edit="${s.cash_schedule_id}" data-date="${String(s.scheduled_date).slice(0,10)}">変更</button>` : '',
          ['planned','exported','held'].includes(s.status) ? `<button class="btn btn-ghost btn-small" data-exec="${s.cash_schedule_id}" data-amount="${s.amount}">実績</button>` : '',
        ].join('');
        return `<tr><td>${this.ctx.escapeHtml(s.cycle_code === 'end' ? '末日回' : `${Number(s.cycle_code)}日回`)}</td><td>${s.direction === 'outgoing' ? '出金' : '入金'}</td><td>${this.ctx.escapeHtml(String(s.scheduled_date).slice(0,10))}</td><td>${this.ctx.escapeHtml(s.counterparty_name)}</td><td>${this.ctx.escapeHtml(s.title)}</td><td class="num">${Number(s.amount).toLocaleString()}円</td><td class="num">${actual ? `${actual.toLocaleString()}円${difference ? `（差額 ${difference.toLocaleString()}円）` : ''}` : '-'}</td><td>${this.kit.statusBadge(s.status,this.status(s.status))}</td><td>${actions}</td></tr>`;
      }).join('');
      const batchRows = batches.map((b) => `<tr><td>#${b.cash_export_batch_id}</td><td>${b.cycle_code === 'end' ? '末日' : Number(b.cycle_code)}日回</td><td>${this.ctx.escapeHtml(b.file_name)}</td><td class="num">${b.item_count}件</td><td>${this.kit.statusBadge(b.status,this.status(b.status))}</td><td>${b.status === 'active' ? `<button class="btn btn-ghost btn-small" data-cancel-export="${b.cash_export_batch_id}">取消</button>` : ''}</td></tr>`).join('');
      const cards = this.kit.summaryCardsHtml([
        {label:'全件',value:summary.total},
        {label:'未完了・確認待ち',value:summary.waiting,tone:'waiting'},
        {label:'完了',value:summary.done,tone:'complete'},
        {label:'要対応',value:summary.attention,tone:'attention'},
      ]);
      this.ctx.app.innerHTML = this.kit.shell('入出金管理・CSV', `<section class="panel">${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}${this.kit.monthNavigatorHtml(this.ym,'cash-month')}${cards}<div class="section-head"><h2>予定一覧</h2><button class="btn" id="new-schedule">＋ 手動予定</button></div><div class="table-wrap"><table class="data-table data-table-compact"><thead><tr><th>管理回</th><th>区分</th><th>予定日</th><th>相手先</th><th>件名</th><th>予定額</th><th>実行額</th><th>状態</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="9">予定がありません</td></tr>'}</tbody></table></div><div class="btn-row"><select id="export-cycle">${cycleOptions}</select><button class="btn btn-secondary" id="export-csv">出金CSVを作成</button></div><h3 class="section-title">CSV出力履歴</h3><div class="table-wrap"><table class="data-table data-table-compact"><thead><tr><th>No</th><th>管理回</th><th>ファイル名</th><th>件数</th><th>状態</th><th>操作</th></tr></thead><tbody>${batchRows || '<tr><td colspan="6">出力履歴がありません</td></tr>'}</tbody></table></div></section><div id="cash-editor"></div>`, {wide:true});
      this.kit.bindShell();
      this.kit.bindMonthNavigator('cash-month', () => this.ym, (value) => { this.ym = value; }, () => this.show());
      document.getElementById('new-schedule').onclick = () => this.editor(cycleOptions);
      document.querySelectorAll('[data-exec]').forEach((button) => { button.onclick = () => this.transaction(Number(button.dataset.exec), Number(button.dataset.amount)); });
      document.querySelectorAll('[data-edit]').forEach((button) => { button.onclick = () => this.editSchedule(Number(button.dataset.edit), button.dataset.date, cycleOptions); });
      document.getElementById('export-csv').onclick = async () => {
        const id = document.getElementById('export-cycle').value;
        const response = await fetch('/api/cash-management/exports', { method:'POST', credentials:'include', headers:{'Content-Type':'application/json'}, body:JSON.stringify({cash_cycle_id:id}) });
        if (!response.ok) { const error = await response.json(); window.alert(error.message || 'CSV作成に失敗しました'); return; }
        const url = URL.createObjectURL(await response.blob());
        const link = document.createElement('a'); link.href = url; link.download = `cash-${this.ym.replace('-', '')}.csv`; link.click(); URL.revokeObjectURL(url);
        await this.show('CSVを作成しました');
      };
      document.querySelectorAll('[data-cancel-export]').forEach((button) => { button.onclick = async () => { if (!window.confirm('このCSV出力を取り消し、未実行予定を出力前へ戻しますか？')) return; const result = await this.ctx.api(`/api/cash-management/exports/${button.dataset.cancelExport}/cancel`, {method:'POST',body:'{}'}); if (!result.res.ok) return window.alert(result.data?.message || '取消失敗'); this.show('CSV出力を取り消しました'); }; });
    },
    editor(options) {
      const editor = document.getElementById('cash-editor');
      editor.innerHTML = `<section class="panel"><h2>手動予定</h2><form id="cash-form"><div class="form-grid"><div><label>管理回</label><select name="cash_cycle_id">${options}</select></div><div><label>区分</label><select name="direction"><option value="outgoing">出金</option><option value="incoming">入金</option></select></div><div><label>相手先</label><input name="counterparty_name" required></div><div><label>件名</label><input name="title" required></div><div><label>金額</label><input name="amount" type="number" min="1" required></div><div><label>個別予定日</label><input name="scheduled_date" type="date"></div><div class="full"><label>日付変更理由</label><input name="override_reason"></div></div><div class="btn-row"><button class="btn">登録</button></div></form></section>`;
      document.getElementById('cash-form').onsubmit = async (event) => { event.preventDefault(); const result = await this.ctx.api('/api/cash-management/schedules',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}); if (!result.res.ok) return window.alert(result.data?.message || '登録失敗'); this.show('予定を登録しました'); };
    },
    editSchedule(id, date, options) {
      const editor = document.getElementById('cash-editor');
      editor.innerHTML = `<section class="panel"><h2>予定変更</h2><form id="cash-edit-form"><div class="form-grid"><div><label>管理回</label><select name="cash_cycle_id">${options}</select></div><div><label>個別予定日</label><input name="scheduled_date" type="date" value="${date}" required></div><div class="full"><label>変更理由</label><input name="override_reason" required></div></div><button class="btn">変更を保存</button></form></section>`;
      document.getElementById('cash-edit-form').onsubmit = async (event) => { event.preventDefault(); const result = await this.ctx.api(`/api/cash-management/schedules/${id}`,{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(event.currentTarget)))}); if (!result.res.ok) return window.alert(result.data?.message || '変更失敗'); this.show('予定を変更しました'); };
    },
    transaction(id, plannedAmount) {
      const action = window.prompt('処理を選択: 1=実行、2=保留、3=取消', '1'); if (!action) return;
      const status = action === '2' ? 'held' : action === '3' ? 'cancelled' : 'executed';
      const today = new Date(); const localDate = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
      const date = status === 'executed' ? window.prompt('実行日（YYYY-MM-DD）',localDate) : localDate; if (!date) return;
      const amount = status === 'executed' ? window.prompt('実行額',String(plannedAmount)) : 0; if (amount == null) return;
      const reason = status === 'executed' ? '' : window.prompt(`${status === 'held' ? '保留' : '取消'}理由`,''); if (status !== 'executed' && !reason) return;
      this.ctx.api(`/api/cash-management/schedules/${id}/transaction`, {method:'POST',body:JSON.stringify({executed_date:date,executed_amount:amount,status,reason})}).then((result) => { if (!result.res.ok) window.alert(result.data?.message || '登録失敗'); else this.show(status === 'executed' ? '実績を登録しました' : status === 'held' ? '保留にしました' : '取消しました'); });
    },
  };
  window.LinksCashManagement = LinksCashManagement;
})();
