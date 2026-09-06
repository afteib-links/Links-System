(() => {
  const CODE_CATEGORIES = [
    { key: 'price_type', label: '料金種別' },
    { key: 'overtime_calc', label: '残業計算区分' },
    { key: 'price_calc_type', label: '料金計算区分' },
  ];

  const MASTER_HELP = {
    staff: {
      title: '営業担当者マスタの登録方法',
      how: ['氏名は必須です。カナと役割は任意です。', '並び順は選択リストの表示順です。', '無効にすると、企業マスタの担当履歴で新規選択できなくなります。既存の履歴は残ります。'],
      affects: ['企業マスタの担当履歴（営業担当・契約担当）'],
    },
    offices: {
      title: '事業所マスタの登録方法',
      how: ['事業所Noは採番ルールに従い保存時に自動採番されます。手入力できません。', '事業所名は任意です。空欄のまま登録できます。'],
      affects: ['事業所Noの採番', '企業マスタの事業所名は企業画面の入力が正です'],
    },
    numbering: {
      title: '採番ルールの記載方法',
      how: ['キーは追加後に変更できません。', '次番号は「接頭辞＋ゼロ埋め桁」で組み立てます。例: 桁4・次12 → 0012。', '無効にすると、そのキーの新規採番を停止します。'],
      affects: ['当面は事業所Noの自動採番'],
    },
    codes: {
      title: '区分マスタの記載方法',
      how: ['値は保存キー、表示名が画面の表示です。値は追加後に変えません。', '無効化しても、すでに保存されたデータはその値のまま残ります。', '料金計算区分の未知の値は金額データに保存できますが、日報の自動計算には使いません。'],
      affects: ['料金種別 → 金額データの料金項目', '残業計算区分 → 基本案件・個別案件の残業計算', '料金計算区分 → 金額データの計算種別と日報自動計算'],
    },
    settings: {
      title: 'システム設定の記載方法',
      how: ['日報の色は #RRGGBB の6桁で入力します。色見本とカラーコードを両方確認してください。', '料金自動計算の倍率・利益率は0以上の数値です。', '請求・支払摘要の表示順は basic,overtime,night,night_overtime,distance,shortage を重複なく6つ並べます。', 'PDFロゴは PNG・JPEG・WebP です。縦横比を維持して帳票へ出します。'],
      affects: ['日報入力画面の文字サイズ・曜日色・増減単位', '金額データの自動計算と利益率警告', '請求・支払明細の摘要順', 'PDF帳票の会社ロゴ'],
    },
    holidays: {
      title: '祝日・案件休日の登録方法',
      how: ['日付と休日名は必須です。', '適用範囲は全案件共通、または案件独自です。案件独自では案件を選択してください。', '登録日は実際の曜日より休日判定を優先します。同じ日に両方があれば案件独自を判定根拠として残し、休日料金は1つだけ適用します。'],
      affects: ['日報の休日判定と料金区分の自動候補', '入出金の予定日・振込指定日の営業日シフト'],
    },
    'transfer-fees': {
      title: '振込手数料マスターの登録方法',
      how: ['名称と0円以上の整数円は必須です。', '無効にすると、新規の先払・支払では選べません。すでに作成した予定のスナップショットは変わりません。'],
      affects: ['先払の手数料初期値（案件 → パートナー → 0円の順）', '支払明細の手数料控除'],
    },
    'bank-profiles': {
      title: '銀行CSVフォーマットの登録方法',
      how: ['公開済み版は上書きしません。改定するときは新しい下書き版を作り、確認記録を書いてから公開します。', '列キー、参照項目、文字コード、区切り、ファイル名規則を版ごとに保存します。', '過去の出力バッチは、当時の列定義のまま再生成します。'],
      affects: ['入出金管理の銀行CSVプレビューと生成'],
    },
    'source-accounts': {
      title: '振込元口座マスターの登録方法',
      how: ['表示名、CSVプロファイル、銀行コード4桁、支店コード3桁、口座番号、口座名義カナは必須です。', '期首預金残高は0円以上の整数円です。', '口座番号は画面では末尾以外を伏せて表示します。', '有効な口座だけがCSV出力と預金残高の対象になります。'],
      affects: ['入出金管理の振込元口座選択と銀行CSV出力'],
    },
  };

  function hubCardHtml(ctx, key, title, count) {
    return `<div class="hub-card-wrap">
      <button type="button" class="hub-card" data-hub="${key}">
        <strong>${title}</strong>
        <span>${ctx.escapeHtml(count ?? 0)} 件</span>
      </button>
      <button type="button" class="hub-help" data-master-help="${key}" aria-label="${title}のヘルプ">?</button>
    </div>`;
  }

  const PRICE_MATRIX_SETTINGS = [
    { key: 'price_matrix_profit_warning_percent', label: '利益率警告基準（%）', defaultValue: '10', step: '0.1' },
    { key: 'price_matrix_overtime_multiplier', label: '時間外倍率', defaultValue: '1.25', step: '0.01' },
    { key: 'price_matrix_night_multiplier', label: '深夜倍率', defaultValue: '1.35', step: '0.01' },
    { key: 'price_matrix_night_overtime_multiplier', label: '深夜超過倍率', defaultValue: '1.6', step: '0.01' },
  ];

  const DAILY_REPORT_SETTINGS = [
    { key: 'daily_report_input_font_size_px', label: '入力文字サイズ（px）', type: 'number', defaultValue: '16', min: '12', max: '24', step: '1' },
    { key: 'daily_report_reference_text_color', label: '未入力欄の文字色', type: 'color', defaultValue: '#A7B0BE' },
    { key: 'daily_report_saturday_background_color', label: '土曜の背景色', type: 'color', defaultValue: '#EAF4FF' },
    { key: 'daily_report_saturday_text_color', label: '土曜の文字色', type: 'color', defaultValue: '#1D4ED8' },
    { key: 'daily_report_holiday_background_color', label: '日曜・祝日の背景色', type: 'color', defaultValue: '#FDECEC' },
    { key: 'daily_report_holiday_text_color', label: '日曜・祝日の文字色', type: 'color', defaultValue: '#B42318' },
    { key: 'daily_report_fallback_time_step_minutes', label: '時間の代替刻み（分）', type: 'number', defaultValue: '5', min: '1', max: '60', step: '1' },
    { key: 'daily_report_distance_step', label: '距離の増減単位', type: 'number', defaultValue: '1', min: '1', max: '1000', step: '1' },
    { key: 'daily_report_expense_step', label: '通行料・駐車料・交通費の増減単位', type: 'number', defaultValue: '100', min: '1', max: '100000', step: '1' },
  ];

  const LinksMasterSettings = {
    async open(ctx) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      await this.showHub();
    },

    helpButtonHtml(key) {
      return `<button type="button" class="btn btn-ghost" data-master-help="${key}">ヘルプ</button>`;
    },

    bindHelp(root = document) {
      root.querySelectorAll('[data-master-help]').forEach((button) => {
        button.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.openHelp(button.getAttribute('data-master-help'));
        });
      });
    },

    ensureModalHost() {
      let host = document.getElementById('modal-host');
      if (host) return host;
      host = document.createElement('div');
      host.id = 'modal-host';
      document.querySelector('main .panel')?.appendChild(host);
      return host;
    },

    openHelp(key) {
      const help = MASTER_HELP[key];
      if (!help || !this.kit) return;
      const host = this.ensureModalHost();
      const how = help.how.map((line) => `<li>${this.ctx.escapeHtml(line)}</li>`).join('');
      const affects = help.affects.map((line) => `<li>${this.ctx.escapeHtml(line)}</li>`).join('');
      host.innerHTML = this.kit.modalHtml(
        help.title,
        `<div class="master-help-body"><h4>記載方法</h4><ul>${how}</ul><h4>影響する画面</h4><ul>${affects}</ul></div>`,
        '',
        'modal-wide'
      );
      this.kit.bindModal();
    },

    async showHub() {
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api('/api/master-settings/hub');
      const hub = data?.hub || {};
      const canEditBankExport = (this.ctx.currentUser?.roles || []).some((role) => ['admin', 'system'].includes(role));
      this.ctx.app.innerHTML = this.kit.shell(
        'マスター設定（仮組）',
        `<section class="panel">
          <p class="muted">共通小口マスタへの入口です。各カードの「？」で登録方法と影響画面を確認できます。</p>
          <div class="hub-grid">
            ${hubCardHtml(this.ctx, 'staff', '営業担当者マスタ', hub.staff_masters)}
            ${hubCardHtml(this.ctx, 'offices', '事業所マスタ', hub.office_masters)}
            ${hubCardHtml(this.ctx, 'numbering', '採番ルール', hub.numbering_rules)}
            ${hubCardHtml(this.ctx, 'codes', '区分マスタ', hub.code_masters)}
            ${hubCardHtml(this.ctx, 'settings', 'システム設定', hub.system_settings)}
            ${hubCardHtml(this.ctx, 'holidays', '祝日・案件休日', hub.holidays)}
            ${hubCardHtml(this.ctx, 'transfer-fees', '振込手数料マスター', hub.transfer_fee_patterns)}
            ${canEditBankExport ? `${hubCardHtml(this.ctx, 'bank-profiles', '銀行CSVフォーマット', hub.bank_export_profiles)}${hubCardHtml(this.ctx, 'source-accounts', '振込元口座マスター', hub.source_bank_accounts)}` : ''}
          </div>
          <div id="modal-host"></div>
        </section>`
      );
      this.kit.bindShell();
      this.bindHelp();
      document.querySelectorAll('[data-hub]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const key = btn.getAttribute('data-hub');
          this.kit.pushNav(() => this.showHub());
          if (key === 'staff') this.showStaff();
          else if (key === 'offices') this.showOffices();
          else if (key === 'numbering') this.showNumberingRules();
          else if (key === 'codes') this.showCodes();
          else if (key === 'holidays') this.showHolidays();
          else if (key === 'transfer-fees') this.showTransferFees();
          else if (key === 'bank-profiles') window.LinksBankExportMaster.openProfiles(this.ctx, () => this.showHub());
          else if (key === 'source-accounts') window.LinksBankExportMaster.openAccounts(this.ctx, () => this.showHub());
          else this.showSettings();
        });
      });
    },

    async showTransferFees(message = '') {
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api('/api/master-settings/transfer-fees');
      if (!res.ok || !data?.ok) return window.alert(data?.message || '振込手数料マスターを取得できませんでした');
      this._transferFees = data.transfer_fees || [];
      const rows = this._transferFees.map((row) => `<tr><td>${this.ctx.escapeHtml(row.pattern_name)}</td><td class="num">${this.kit.money(row.amount)}</td><td>${row.is_active ? '有効' : '無効'}</td><td>${row.sort_order}</td><td><button class="btn btn-ghost btn-small" data-fee-edit="${row.transfer_fee_pattern_id}">編集</button> <button class="btn btn-danger btn-small" data-fee-delete="${row.transfer_fee_pattern_id}">削除</button></td></tr>`).join('');
      this.ctx.app.innerHTML = this.kit.shell('振込手数料マスター', `<section class="panel">${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}<p class="muted">先払・支払処理で共通利用する固定手数料パターンです。</p><div class="toolbar">${this.helpButtonHtml('transfer-fees')}<button class="btn" id="new-transfer-fee">＋ 追加</button></div><div class="table-wrap"><table class="data-table data-table-compact"><thead><tr><th>名称</th><th>固定金額</th><th>状態</th><th>並び順</th><th>操作</th></tr></thead><tbody>${rows || '<tr><td colspan="5">登録がありません</td></tr>'}</tbody></table></div><div id="modal-host"></div></section>`, { onBack:() => this.showHub() });
      this.kit.bindShell({ onBack:() => this.showHub() });
      this.bindHelp();
      document.getElementById('new-transfer-fee')?.addEventListener('click', () => this.openTransferFeeModal(null));
      document.querySelectorAll('[data-fee-edit]').forEach((button) => button.addEventListener('click', () => this.openTransferFeeModal(this._transferFees.find((row) => Number(row.transfer_fee_pattern_id) === Number(button.dataset.feeEdit)))));
      document.querySelectorAll('[data-fee-delete]').forEach((button) => button.addEventListener('click', async () => { if (!window.confirm('この手数料パターンを削除しますか？')) return; const result = await this.ctx.api(`/api/master-settings/transfer-fees/${button.dataset.feeDelete}`, { method:'DELETE' }); if (!result.res.ok) return window.alert(result.data?.message || '削除失敗'); this.showTransferFees('削除しました'); }));
    },

    openTransferFeeModal(row) {
      const isNew = !row;
      document.getElementById('modal-host').innerHTML = this.kit.modalHtml(isNew ? '振込手数料追加' : '振込手数料編集', `<div class="form-grid"><div class="full"><label>名称</label><input id="fee-name" value="${this.ctx.escapeHtml(row?.pattern_name || '')}"></div><div><label>固定金額</label><input id="fee-amount" type="number" min="0" value="${Number(row?.amount || 0)}"></div><div><label>並び順</label><input id="fee-sort" type="number" value="${Number(row?.sort_order || 0)}"></div><div class="full"><label class="check-item"><input id="fee-active" type="checkbox" ${row?.is_active !== 0 ? 'checked' : ''}><span>有効</span></label></div></div>`, '<button class="btn" id="fee-save">保存</button>', 'modal-wide');
      this.kit.bindModal();
      document.getElementById('fee-save')?.addEventListener('click', async () => {
        const payload = { pattern_name:document.getElementById('fee-name').value.trim(), amount:Number(document.getElementById('fee-amount').value), sort_order:Number(document.getElementById('fee-sort').value || 0), is_active:document.getElementById('fee-active').checked, version:Number(row?.version || 0) };
        if (!payload.pattern_name || !Number.isFinite(payload.amount) || payload.amount < 0) return window.alert('名称と0円以上の固定金額を入力してください');
        const result = await this.ctx.api(isNew ? '/api/master-settings/transfer-fees' : `/api/master-settings/transfer-fees/${row.transfer_fee_pattern_id}`, { method:isNew ? 'POST' : 'PUT', body:JSON.stringify(payload) });
        if (!result.res.ok) return window.alert(result.data?.message || '保存失敗'); document.getElementById('modal-backdrop')?.remove(); this.showTransferFees(isNew ? '追加しました' : '更新しました');
      });
    },

    async showStaff(message = '') {
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api('/api/master-settings/staff');
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '営業担当者マスタ',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`,
          { onBack: () => this.showHub() }
        );
        this.kit.bindShell({ onBack: () => this.showHub() });
        return;
      }
      const rows = (data.staff || [])
        .map(
          (s) => `
          <tr>
            <td>${this.ctx.escapeHtml(s.staff_master_id)}</td>
            <td>${this.ctx.escapeHtml(s.staff_name)}</td>
            <td>${this.ctx.escapeHtml(s.staff_name_kana || '-')}</td>
            <td>${this.ctx.escapeHtml(s.role_label || '-')}</td>
            <td>${s.is_active ? '有効' : '無効'}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-edit="${s.staff_master_id}">編集</button>
              <button type="button" class="btn btn-danger btn-small" data-del="${s.staff_master_id}">削除</button>
            </td>
          </tr>`
        )
        .join('');
      this._staff = data.staff || [];
      this.ctx.app.innerHTML = this.kit.shell(
        '営業担当者マスタ',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar">${this.helpButtonHtml('staff')}<button type="button" class="btn" id="new-staff">＋ 追加</button></div>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead><tr><th>No</th><th>氏名</th><th>カナ</th><th>役割</th><th>状態</th><th>操作</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="6">なし</td></tr>'}</tbody>
            </table>
          </div>
          <div id="modal-host"></div>
        </section>`,
        { onBack: () => this.showHub() }
      );
      this.kit.bindShell({ onBack: () => this.showHub() });
      this.bindHelp();
      document.getElementById('new-staff')?.addEventListener('click', () => this.openStaffModal(null));
      document.querySelectorAll('[data-edit]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const row = this._staff.find((s) => Number(s.staff_master_id) === Number(btn.getAttribute('data-edit')));
          this.openStaffModal(row);
        })
      );
      document.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!window.confirm('削除しますか？')) return;
          await this.ctx.api(`/api/master-settings/staff/${btn.getAttribute('data-del')}`, { method: 'DELETE' });
          await this.showStaff('削除しました');
        })
      );
    },

    openStaffModal(row) {
      const isNew = !row;
      document.getElementById('modal-host').innerHTML = this.kit.modalHtml(
        isNew ? '担当者追加' : '担当者編集',
        `<section class="form-section-card"><div class="form-grid form-grid-compact">
          <div><label>氏名</label><input id="m_name" value="${this.ctx.escapeHtml(row?.staff_name || '')}" /></div>
          <div><label>カナ</label><input id="m_kana" value="${this.ctx.escapeHtml(row?.staff_name_kana || '')}" /></div>
          <div><label>役割</label><input id="m_role" value="${this.ctx.escapeHtml(row?.role_label || '')}" /></div>
          <div><label>並び順</label><input type="number" id="m_sort" value="${this.ctx.escapeHtml(row?.sort_order ?? 0)}" /></div>
          <div class="full"><label class="check-item"><input type="checkbox" id="m_active" ${row?.is_active !== 0 ? 'checked' : ''} /><span>有効</span></label></div>
        </div></section>`,
        `<button type="button" class="btn" id="modal-save">保存</button>`,
        'modal-wide'
      );
      this.kit.bindModal();
      document.getElementById('modal-save')?.addEventListener('click', async () => {
        const payload = {
          staff_name: document.getElementById('m_name').value.trim(),
          staff_name_kana: document.getElementById('m_kana').value,
          role_label: document.getElementById('m_role').value,
          sort_order: Number(document.getElementById('m_sort').value || 0),
          is_active: document.getElementById('m_active').checked,
        };
        if (!payload.staff_name) {
          window.alert('氏名は必須です');
          return;
        }
        const result = isNew
          ? await this.ctx.api('/api/master-settings/staff', { method: 'POST', body: JSON.stringify(payload) })
          : await this.ctx.api(`/api/master-settings/staff/${row.staff_master_id}`, {
              method: 'PUT',
              body: JSON.stringify(payload),
            });
        if (!result.res.ok) {
          window.alert(result.data?.message || '保存失敗');
          return;
        }
        document.getElementById('modal-backdrop')?.remove();
        await this.showStaff(isNew ? '追加しました' : '更新しました');
      });
    },

    async showOffices(message = '') {
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api('/api/master-settings/offices');
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '事業所マスタ',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`,
          { onBack: () => this.showHub() }
        );
        this.kit.bindShell({ onBack: () => this.showHub() });
        return;
      }
      this._offices = data.offices || [];
      const rows = this._offices
        .map(
          (o) => `
          <tr>
            <td>${this.ctx.escapeHtml(o.office_no)}</td>
            <td>${this.ctx.escapeHtml(o.office_name)}</td>
            <td>${o.is_active ? '有効' : '無効'}</td>
            <td>${this.ctx.escapeHtml(o.sort_order ?? 0)}</td>
            <td>
              <button type="button" class="btn btn-ghost btn-small" data-edit="${o.office_id}">編集</button>
              <button type="button" class="btn btn-danger btn-small" data-del="${o.office_id}">削除</button>
            </td>
          </tr>`
        )
        .join('');
      this.ctx.app.innerHTML = this.kit.shell(
        '事業所マスタ',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <p class="muted">事業所Noは採番ルールに従い自動採番されます。事業所名は任意です。</p>
          <div class="toolbar">${this.helpButtonHtml('offices')}<button type="button" class="btn" id="new-office">＋ 追加</button></div>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead><tr><th>事業所No</th><th>事業所名</th><th>状態</th><th>並び</th><th>操作</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="5">なし</td></tr>'}</tbody>
            </table>
          </div>
          <div id="modal-host"></div>
        </section>`,
        { onBack: () => this.showHub() }
      );
      this.kit.bindShell({ onBack: () => this.showHub() });
      this.bindHelp();
      document.getElementById('new-office')?.addEventListener('click', () => this.openOfficeModal(null));
      document.querySelectorAll('[data-edit]').forEach((btn) =>
        btn.addEventListener('click', () => {
          const row = this._offices.find((o) => Number(o.office_id) === Number(btn.getAttribute('data-edit')));
          this.openOfficeModal(row);
        })
      );
      document.querySelectorAll('[data-del]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          if (!window.confirm('削除しますか？')) return;
          await this.ctx.api(`/api/master-settings/offices/${btn.getAttribute('data-del')}`, {
            method: 'DELETE',
          });
          await this.showOffices('削除しました');
        })
      );
    },

    openOfficeModal(row) {
      const isNew = !row;
      document.getElementById('modal-host').innerHTML = this.kit.modalHtml(
        isNew ? '事業所追加' : '事業所編集',
        `<section class="form-section-card"><div class="form-grid form-grid-compact">
          ${
            isNew
              ? `<div class="full"><p class="muted">事業所Noは保存時に自動採番されます。事業所名は任意です。</p></div>`
              : `<div><label>事業所No</label><input value="${this.ctx.escapeHtml(row.office_no)}" disabled /></div>`
          }
          <div class="full"><label>事業所名</label><input id="m_office_name" value="${this.ctx.escapeHtml(
            row?.office_name || ''
          )}" placeholder="任意（入力なし可）" /></div>
          <div><label>並び順</label><input type="number" id="m_sort" value="${this.ctx.escapeHtml(
            row?.sort_order ?? 0
          )}" /></div>
          <div class="full"><label class="check-item"><input type="checkbox" id="m_active" ${
            row?.is_active !== 0 ? 'checked' : ''
          } /><span>有効</span></label></div>
        </div></section>`,
        `<button type="button" class="btn" id="modal-save">保存</button>`,
        'modal-wide'
      );
      this.kit.bindModal();
      document.getElementById('modal-save')?.addEventListener('click', async () => {
        const payload = {
          office_name: document.getElementById('m_office_name').value.trim(),
          sort_order: Number(document.getElementById('m_sort').value || 0),
          is_active: document.getElementById('m_active').checked,
        };
        const result = isNew
          ? await this.ctx.api('/api/master-settings/offices', {
              method: 'POST',
              body: JSON.stringify(payload),
            })
          : await this.ctx.api(`/api/master-settings/offices/${row.office_id}`, {
              method: 'PUT',
              body: JSON.stringify(payload),
            });
        if (!result.res.ok) {
          window.alert(result.data?.message || '保存失敗');
          return;
        }
        document.getElementById('modal-backdrop')?.remove();
        const msg = isNew
          ? `追加しました（No: ${result.data?.office_no || ''}）`
          : '更新しました';
        await this.showOffices(msg);
      });
    },

    async showNumberingRules(message = '') {
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api('/api/master-settings/numbering-rules');
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '採番ルール',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '取得失敗')}</p></section>`,
          { onBack: () => this.showHub() }
        );
        this.kit.bindShell({ onBack: () => this.showHub() });
        return;
      }
      const rows = (data.rules || [])
        .map(
          (r) => `
          <tr>
            <td>${this.ctx.escapeHtml(r.rule_key)}</td>
            <td><input data-id="${r.numbering_rule_id}" data-f="rule_label" value="${this.ctx.escapeHtml(
              r.rule_label || ''
            )}" /></td>
            <td><input data-id="${r.numbering_rule_id}" data-f="prefix" value="${this.ctx.escapeHtml(
              r.prefix || ''
            )}" style="width:5rem" /></td>
            <td><input type="number" data-id="${r.numbering_rule_id}" data-f="pad_digits" value="${this.ctx.escapeHtml(
              r.pad_digits ?? 4
            )}" style="width:4rem" /></td>
            <td><input type="number" data-id="${r.numbering_rule_id}" data-f="next_number" value="${this.ctx.escapeHtml(
              r.next_number ?? 1
            )}" style="width:5rem" /></td>
            <td><label class="check-item"><input type="checkbox" data-id="${
              r.numbering_rule_id
            }" data-f="is_active" ${r.is_active ? 'checked' : ''} /><span>有効</span></label></td>
            <td><button type="button" class="btn btn-ghost btn-small" data-save-rule="${
              r.numbering_rule_id
            }">保存</button></td>
          </tr>`
        )
        .join('');
      this.ctx.app.innerHTML = this.kit.shell(
        '採番ルール',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <p class="muted">接頭辞＋ゼロ埋め桁で次番号を組み立てます（例: 桁4・次12 → 0012）。キーは変更できません。</p>
          <div class="toolbar">
            ${this.helpButtonHtml('numbering')}
            <input id="new-rule-key" placeholder="キー（例: office）" />
            <input id="new-rule-label" placeholder="表示名" />
            <input id="new-rule-prefix" placeholder="接頭辞" style="width:5rem" />
            <input type="number" id="new-rule-pad" placeholder="桁" value="4" style="width:4rem" />
            <input type="number" id="new-rule-next" placeholder="次番号" value="1" style="width:5rem" />
            <button type="button" class="btn" id="add-rule">＋ 追加</button>
          </div>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead><tr><th>キー</th><th>表示名</th><th>接頭辞</th><th>桁</th><th>次番号</th><th>状態</th><th></th></tr></thead>
              <tbody>${rows || '<tr><td colspan="7">なし</td></tr>'}</tbody>
            </table>
          </div>
          <div id="modal-host"></div>
        </section>`,
        { onBack: () => this.showHub() }
      );
      this.kit.bindShell({ onBack: () => this.showHub() });
      this.bindHelp();
      document.getElementById('add-rule')?.addEventListener('click', async () => {
        const result = await this.ctx.api('/api/master-settings/numbering-rules', {
          method: 'POST',
          body: JSON.stringify({
            rule_key: document.getElementById('new-rule-key').value.trim(),
            rule_label: document.getElementById('new-rule-label').value.trim(),
            prefix: document.getElementById('new-rule-prefix').value,
            pad_digits: Number(document.getElementById('new-rule-pad').value || 4),
            next_number: Number(document.getElementById('new-rule-next').value || 1),
          }),
        });
        if (!result.res.ok) {
          window.alert(result.data?.message || '追加失敗');
          return;
        }
        await this.showNumberingRules('追加しました');
      });
      document.querySelectorAll('[data-save-rule]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-save-rule');
          const payload = {
            rule_label: document.querySelector(`[data-id="${id}"][data-f="rule_label"]`)?.value,
            prefix: document.querySelector(`[data-id="${id}"][data-f="prefix"]`)?.value,
            pad_digits: Number(document.querySelector(`[data-id="${id}"][data-f="pad_digits"]`)?.value || 4),
            next_number: Number(document.querySelector(`[data-id="${id}"][data-f="next_number"]`)?.value || 1),
            is_active: document.querySelector(`[data-id="${id}"][data-f="is_active"]`)?.checked,
          };
          const result = await this.ctx.api(`/api/master-settings/numbering-rules/${id}`, {
            method: 'PUT',
            body: JSON.stringify(payload),
          });
          if (!result.res.ok) window.alert(result.data?.message || '保存失敗');
          else this.ctx.showToast('保存しました');
        })
      );
    },

    async showCodes() {
      this.ctx.renderLoading();
      this.codeCategory = this.codeCategory || 'price_type';
      const { res, data } = await this.ctx.api(`/api/master-settings/codes/${this.codeCategory}`);
      const rows = (data?.codes || [])
        .map(
          (c) => `
          <tr>
            <td>${this.ctx.escapeHtml(c.code_value)}</td>
            <td><input data-id="${c.code_master_id}" data-f="code_label" value="${this.ctx.escapeHtml(c.code_label)}" /></td>
            <td><input type="number" data-id="${c.code_master_id}" data-f="sort_order" value="${this.ctx.escapeHtml(c.sort_order ?? 0)}" style="width:5rem" /></td>
            <td><label class="check-item"><input type="checkbox" data-id="${c.code_master_id}" data-f="is_active" ${c.is_active ? 'checked' : ''} /><span>有効</span></label></td>
            <td><button type="button" class="btn btn-ghost btn-small" data-save-code="${c.code_master_id}">保存</button></td>
          </tr>`
        )
        .join('');
      this.ctx.app.innerHTML = this.kit.shell(
        '区分マスタ',
        `<section class="panel">
          <div class="toolbar">
            ${this.helpButtonHtml('codes')}
            ${CODE_CATEGORIES.map(
              (c) =>
                `<button type="button" class="btn ${this.codeCategory === c.key ? '' : 'btn-ghost'} btn-small" data-cat="${c.key}">${this.ctx.escapeHtml(c.label)}</button>`
            ).join('')}
          </div>
          <div class="toolbar">
            <input id="new-value" placeholder="値" />
            <input id="new-label" placeholder="表示名" />
            <button type="button" class="btn" id="add-code">＋ 追加</button>
          </div>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead><tr><th>値</th><th>表示名</th><th>並び</th><th>状態</th><th></th></tr></thead>
              <tbody>${rows || '<tr><td colspan="5">なし</td></tr>'}</tbody>
            </table>
          </div>
          <div id="modal-host"></div>
        </section>`,
        { onBack: () => this.showHub() }
      );
      this.kit.bindShell({ onBack: () => this.showHub() });
      this.bindHelp();
      document.querySelectorAll('[data-cat]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.codeCategory = btn.getAttribute('data-cat');
          this.showCodes();
        })
      );
      document.getElementById('add-code')?.addEventListener('click', async () => {
        const result = await this.ctx.api('/api/master-settings/codes', {
          method: 'POST',
          body: JSON.stringify({
            category_code: this.codeCategory,
            code_value: document.getElementById('new-value').value.trim(),
            code_label: document.getElementById('new-label').value.trim(),
          }),
        });
        if (!result.res.ok) {
          window.alert(result.data?.message || '追加失敗');
          return;
        }
        await this.showCodes();
      });
      document.querySelectorAll('[data-save-code]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const id = btn.getAttribute('data-save-code');
          const label = document.querySelector(`[data-id="${id}"][data-f="code_label"]`)?.value;
          const sort = document.querySelector(`[data-id="${id}"][data-f="sort_order"]`)?.value;
          const active = document.querySelector(`[data-id="${id}"][data-f="is_active"]`)?.checked;
          const result = await this.ctx.api(`/api/master-settings/codes/${id}`, {
            method: 'PUT',
            body: JSON.stringify({ code_label: label, sort_order: Number(sort || 0), is_active: active }),
          });
          if (!result.res.ok) window.alert(result.data?.message || '保存失敗');
          else this.ctx.showToast('保存しました');
        })
      );
    },

    async showHolidays(message = '') {
      this.ctx.renderLoading();
      const [holidayResult, projectResult] = await Promise.all([
        this.ctx.api('/api/master-settings/holidays'),
        this.ctx.api('/api/master-settings/holidays/projects'),
      ]);
      if (!holidayResult.res.ok || !holidayResult.data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '祝日・案件休日',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(holidayResult.data?.message || '取得失敗')}</p></section>`,
          { onBack: () => this.showHub() }
        );
        this.kit.bindShell({ onBack: () => this.showHub() });
        return;
      }
      this._holidays = holidayResult.data.holidays || [];
      this._holidayProjects = projectResult.data?.projects || [];
      const rows = this._holidays.map((holiday) => `
        <tr>
          <td>${this.ctx.escapeHtml(String(holiday.holiday_date || '').slice(0, 10))}</td>
          <td>${this.ctx.escapeHtml(holiday.holiday_name)}</td>
          <td>${holiday.project_id == null
            ? '全案件共通'
            : this.ctx.escapeHtml(`${holiday.company_name || ''} / ${holiday.project_name || holiday.business_type || `案件#${holiday.project_id}`}`)}</td>
          <td>${holiday.is_active ? '有効' : '無効'}</td>
          <td>
            <button type="button" class="btn btn-ghost btn-small" data-edit-holiday="${holiday.holiday_id}">編集</button>
            <button type="button" class="btn btn-danger btn-small" data-delete-holiday="${holiday.holiday_id}">削除</button>
          </td>
        </tr>`).join('');
      this.ctx.app.innerHTML = this.kit.shell(
        '祝日・案件休日',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <p class="muted">全案件共通の祝日、または特定案件だけの休日を登録します。登録日は曜日より休日設定を優先します。</p>
          <div class="toolbar">${this.helpButtonHtml('holidays')}<button type="button" class="btn" id="new-holiday">＋ 追加</button></div>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead><tr><th>日付</th><th>休日名</th><th>適用範囲</th><th>状態</th><th>操作</th></tr></thead>
              <tbody>${rows || '<tr><td colspan="5">登録なし</td></tr>'}</tbody>
            </table>
          </div>
          <div id="modal-host"></div>
        </section>`,
        { onBack: () => this.showHub() }
      );
      this.kit.bindShell({ onBack: () => this.showHub() });
      this.bindHelp();
      document.getElementById('new-holiday')?.addEventListener('click', () => this.openHolidayModal(null));
      document.querySelectorAll('[data-edit-holiday]').forEach((button) => button.addEventListener('click', () => {
        const row = this._holidays.find((item) => Number(item.holiday_id) === Number(button.getAttribute('data-edit-holiday')));
        this.openHolidayModal(row);
      }));
      document.querySelectorAll('[data-delete-holiday]').forEach((button) => button.addEventListener('click', async () => {
        if (!window.confirm('この休日を削除しますか？')) return;
        const result = await this.ctx.api(`/api/master-settings/holidays/${button.getAttribute('data-delete-holiday')}`, { method: 'DELETE' });
        if (!result.res.ok) window.alert(result.data?.message || '削除失敗');
        else await this.showHolidays('削除しました');
      }));
    },

    openHolidayModal(row) {
      const isNew = !row;
      document.getElementById('modal-host').innerHTML = this.kit.modalHtml(
        isNew ? '休日追加' : '休日編集',
        `<section class="form-section-card"><div class="form-grid form-grid-compact">
          <div><label>日付</label><input type="date" id="holiday-date" value="${this.ctx.escapeHtml(String(row?.holiday_date || '').slice(0, 10))}" /></div>
          <div><label>休日名</label><input id="holiday-name" value="${this.ctx.escapeHtml(row?.holiday_name || '')}" /></div>
          <div><label>適用範囲</label><select id="holiday-scope"><option value="global" ${row?.project_id == null ? 'selected' : ''}>全案件共通</option><option value="project" ${row?.project_id != null ? 'selected' : ''}>案件独自</option></select></div>
          <div class="field-md"><label>案件</label><div id="holiday-project-picker">${this.kit.searchSelectHtml('holiday_project_id', this._holidayProjects, 'project_id', 'company_name', row?.project_id, {
            formatLabel: (project) => [project.company_name, project.manager_name || project.business_type, project.partner_name].filter(Boolean).join(' / ') || `案件#${project.project_id}`,
            aliasKeys: ['manager_name', 'business_type', 'partner_name'],
          })}</div></div>
          <div class="full"><label class="check-item"><input type="checkbox" id="holiday-active" ${row?.is_active !== 0 ? 'checked' : ''} /><span>有効</span></label></div>
        </div></section>`,
        '<button type="button" class="btn" id="holiday-save">保存</button>',
        'modal-wide'
      );
      this.kit.bindModal();
      this.kit.bindSearchSelects(document.getElementById('modal-host'));
      const scope = document.getElementById('holiday-scope');
      const project = document.querySelector('[name="holiday_project_id"]');
      const projectSearch = document.querySelector('#holiday-project-picker .search-select-input');
      const syncScope = () => {
        const disabled = scope.value !== 'project';
        project.disabled = disabled;
        projectSearch.disabled = disabled;
      };
      scope.addEventListener('change', syncScope);
      syncScope();
      document.getElementById('holiday-save')?.addEventListener('click', async () => {
        const payload = {
          holiday_date: document.getElementById('holiday-date').value,
          holiday_name: document.getElementById('holiday-name').value.trim(),
          project_id: scope.value === 'project' ? Number(project.value || 0) || null : null,
          is_active: document.getElementById('holiday-active').checked,
        };
        if (!payload.holiday_date || !payload.holiday_name) {
          window.alert('日付と休日名は必須です');
          return;
        }
        if (scope.value === 'project' && !payload.project_id) {
          window.alert('案件独自休日では案件を選択してください');
          return;
        }
        const result = isNew
          ? await this.ctx.api('/api/master-settings/holidays', { method: 'POST', body: JSON.stringify(payload) })
          : await this.ctx.api(`/api/master-settings/holidays/${row.holiday_id}`, { method: 'PUT', body: JSON.stringify(payload) });
        if (!result.res.ok) {
          window.alert(result.data?.message || '保存失敗');
          return;
        }
        document.getElementById('modal-backdrop')?.remove();
        await this.showHolidays(isNew ? '追加しました' : '更新しました');
      });
    },

    async showSettings() {
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api('/api/master-settings/settings');
      const allSettings = data?.settings || [];
      const priceMatrixKeys = new Set(PRICE_MATRIX_SETTINGS.map((setting) => setting.key));
      const dailyReportKeys = new Set(DAILY_REPORT_SETTINGS.map((setting) => setting.key));
      const values = new Map(allSettings.map((setting) => [setting.setting_key, setting.setting_value]));
      const logoSettingKey = 'document_issuer_logo_data_url';
      let currentLogoDataUrl = values.get(logoSettingKey) || '';
      const priceMatrixFields = PRICE_MATRIX_SETTINGS.map(
        (setting) => `
          <label>${this.ctx.escapeHtml(setting.label)}
            <input type="number" min="0" step="${setting.step}" data-price-matrix-setting="${setting.key}" value="${this.ctx.escapeHtml(values.get(setting.key) ?? setting.defaultValue)}" />
          </label>`
      ).join('');
      const dailyReportFields = DAILY_REPORT_SETTINGS.map((setting) => {
        const value = values.get(setting.key) ?? setting.defaultValue;
        const constraints = setting.type === 'number'
          ? `min="${setting.min}" max="${setting.max}" step="${setting.step}"`
          : '';
        if (setting.type === 'color') {
          return `<label>${this.ctx.escapeHtml(setting.label)}
            <span class="color-setting-control">
              <input type="color" data-daily-report-setting="${setting.key}" value="${this.ctx.escapeHtml(value)}" aria-label="${this.ctx.escapeHtml(setting.label)}の色見本" />
              <input class="color-setting-code" data-color-code="${setting.key}" value="${this.ctx.escapeHtml(value)}" maxlength="7" aria-label="${this.ctx.escapeHtml(setting.label)}のカラーコード" />
              <span class="color-setting-preview" data-color-preview="${setting.key}" style="background:${this.ctx.escapeHtml(value)}"></span>
            </span>
          </label>`;
        }
        return `<label>${this.ctx.escapeHtml(setting.label)}
          <input type="${setting.type}" ${constraints} data-daily-report-setting="${setting.key}" value="${this.ctx.escapeHtml(value)}" />
        </label>`;
      }).join('');
      const rows = allSettings
        .filter((setting) => !priceMatrixKeys.has(setting.setting_key) && !dailyReportKeys.has(setting.setting_key) && setting.setting_key !== logoSettingKey)
        .map(
          (s) => `
          <tr>
            <td>${this.ctx.escapeHtml(s.setting_key)}</td>
            <td>${this.ctx.escapeHtml(s.setting_label || '-')}</td>
            <td><input data-key="${this.ctx.escapeHtml(s.setting_key)}" value="${this.ctx.escapeHtml(s.setting_value || '')}" /></td>
            <td><button type="button" class="btn btn-ghost btn-small" data-save-setting="${this.ctx.escapeHtml(s.setting_key)}">保存</button></td>
          </tr>`
        )
        .join('');
      this.ctx.app.innerHTML = this.kit.shell(
        'システム設定',
        `<section class="panel">
          <div class="toolbar">${this.helpButtonHtml('settings')}</div>
          <section class="panel price-matrix-settings-panel">
            <h3>料金自動計算</h3>
            <p class="muted">金額データの自動計算と利益率警告に共通で使用します。</p>
            <div class="form-grid form-grid-compact">${priceMatrixFields}</div>
            <div class="btn-row"><button type="button" class="btn" id="save-price-matrix-settings">料金自動計算設定を保存</button></div>
          </section>
          <section class="panel daily-report-settings-panel">
            <h3>日報入力画面</h3>
            <p class="muted">入力文字、元単価表示、曜日色、入力欄の増減単位に共通で使用します。祝日・案件休日の日付は「祝日・案件休日」で登録します。</p>
            <div class="form-grid form-grid-compact">${dailyReportFields}</div>
            <div class="btn-row"><button type="button" class="btn" id="save-daily-report-settings">日報入力画面設定を保存</button></div>
          </section>
          <section class="panel">
            <h3>請求・支払摘要の表示順</h3>
            <p class="muted">日付料金、時間料金の各まとまりで使用する順番です。カンマ区切りで basic,overtime,night,night_overtime,distance,shortage を並べます。</p>
            <input id="settlement-line-order" class="full" value="${this.ctx.escapeHtml(values.get('settlement_line_display_order')||'basic,overtime,night,night_overtime,distance,shortage')}">
            <label>表示名（同じ順のカンマ区切り）<input id="settlement-line-labels" class="full" value="${this.ctx.escapeHtml(values.get('settlement_line_display_labels')||'基本料金,時間超過,深夜料金,深夜時間外,その他,不足時間')}"></label>
            <div class="btn-row"><button type="button" class="btn" id="save-settlement-line-order">摘要表示順を保存</button></div>
          </section>
          <section class="panel document-logo-settings-panel">
            <h3>PDF帳票の会社ロゴ</h3>
            <p class="muted">PNG・JPEG・WebP画像を選択するか、下の枠を選んでクリップボードから貼り付けてください。帳票内では縦横比を維持して表示します。</p>
            <div class="document-logo-uploader" id="document-logo-uploader" tabindex="0" role="button" aria-label="会社ロゴ画像を選択または貼り付け">
              <img id="document-logo-preview" src="${this.ctx.escapeHtml(currentLogoDataUrl)}" alt="会社ロゴのプレビュー" ${currentLogoDataUrl ? '' : 'hidden'} />
              <span id="document-logo-placeholder" ${currentLogoDataUrl ? 'hidden' : ''}>画像を選択、ドロップ、または貼り付け</span>
            </div>
            <input id="document-logo-file" type="file" accept="image/png,image/jpeg,image/webp" hidden />
            <div class="btn-row">
              <button type="button" class="btn btn-secondary" id="choose-document-logo">画像を選択</button>
              <button type="button" class="btn btn-ghost" id="clear-document-logo">画像を削除</button>
              <button type="button" class="btn" id="save-document-logo">会社ロゴを保存</button>
            </div>
          </section>
          <div class="toolbar">
            <input id="new-key" placeholder="キー" />
            <input id="new-label" placeholder="ラベル" />
            <input id="new-value" placeholder="値" />
            <button type="button" class="btn" id="add-setting">＋ 追加</button>
          </div>
          <div class="table-wrap">
            <table class="data-table data-table-compact">
              <thead><tr><th>キー</th><th>ラベル</th><th>値</th><th></th></tr></thead>
              <tbody>${rows || '<tr><td colspan="4">なし</td></tr>'}</tbody>
            </table>
          </div>
          <div id="modal-host"></div>
        </section>`,
        { onBack: () => this.showHub() }
      );
      this.kit.bindShell({ onBack: () => this.showHub() });
      this.bindHelp();
      const logoUploader = document.getElementById('document-logo-uploader');
      const logoInput = document.getElementById('document-logo-file');
      const logoPreview = document.getElementById('document-logo-preview');
      const logoPlaceholder = document.getElementById('document-logo-placeholder');
      const showLogoPreview = (dataUrl) => {
        currentLogoDataUrl = dataUrl || '';
        logoPreview.src = currentLogoDataUrl;
        logoPreview.hidden = !currentLogoDataUrl;
        logoPlaceholder.hidden = Boolean(currentLogoDataUrl);
      };
      const prepareLogo = (file) => new Promise((resolve, reject) => {
        if (!file || !['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
          reject(new Error('PNG、JPEG、WebP画像を選択してください'));
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          reject(new Error('元画像は5MB以下にしてください'));
          return;
        }
        const reader = new FileReader();
        reader.onerror = () => reject(new Error('画像を読み込めませんでした'));
        reader.onload = () => {
          const image = new Image();
          image.onerror = () => reject(new Error('画像を読み込めませんでした'));
          image.onload = () => {
            const scale = Math.min(1, 720 / image.width, 240 / image.height);
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(image.width * scale));
            canvas.height = Math.max(1, Math.round(image.height * scale));
            canvas.getContext('2d').drawImage(image, 0, 0, canvas.width, canvas.height);
            const outputType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
            const dataUrl = canvas.toDataURL(outputType, 0.88);
            if (dataUrl.length > 750000) {
              reject(new Error('画像容量が大きすぎます。より小さい画像を選択してください'));
              return;
            }
            resolve(dataUrl);
          };
          image.src = String(reader.result || '');
        };
        reader.readAsDataURL(file);
      });
      const acceptLogoFile = async (file) => {
        try {
          showLogoPreview(await prepareLogo(file));
        } catch (error) {
          window.alert(error.message || '会社ロゴを読み込めませんでした');
        }
      };
      logoUploader?.addEventListener('click', () => logoInput?.click());
      logoUploader?.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); logoInput?.click(); }
      });
      logoUploader?.addEventListener('paste', (event) => {
        const file = [...(event.clipboardData?.files || [])].find((item) => item.type.startsWith('image/'));
        if (file) { event.preventDefault(); acceptLogoFile(file); }
      });
      logoUploader?.addEventListener('dragover', (event) => event.preventDefault());
      logoUploader?.addEventListener('drop', (event) => {
        event.preventDefault();
        acceptLogoFile([...(event.dataTransfer?.files || [])][0]);
      });
      logoInput?.addEventListener('change', () => acceptLogoFile(logoInput.files?.[0]));
      document.getElementById('choose-document-logo')?.addEventListener('click', () => logoInput?.click());
      document.getElementById('clear-document-logo')?.addEventListener('click', () => showLogoPreview(''));
      document.getElementById('save-document-logo')?.addEventListener('click', async () => {
        const result = await this.ctx.api(`/api/master-settings/settings/${logoSettingKey}`, {
          method: 'PUT',
          body: JSON.stringify({ setting_value:currentLogoDataUrl, setting_label:'帳票 会社ロゴ画像' }),
        });
        if (!result.res.ok) window.alert(result.data?.message || '会社ロゴの保存に失敗しました');
        else this.ctx.showToast(currentLogoDataUrl ? '会社ロゴを保存しました' : '会社ロゴを削除しました');
      });
      DAILY_REPORT_SETTINGS.filter((setting) => setting.type === 'color').forEach((setting) => {
        const picker = document.querySelector(`[data-daily-report-setting="${setting.key}"]`);
        const code = document.querySelector(`[data-color-code="${setting.key}"]`);
        const preview = document.querySelector(`[data-color-preview="${setting.key}"]`);
        const applyColor = (value) => {
          if (!/^#[0-9a-f]{6}$/i.test(value || '')) return;
          const normalized = value.toUpperCase();
          picker.value = normalized;
          code.value = normalized;
          preview.style.background = normalized;
        };
        picker?.addEventListener('input', () => applyColor(picker.value));
        code?.addEventListener('input', () => {
          if (/^#[0-9a-f]{6}$/i.test(code.value)) applyColor(code.value);
        });
        code?.addEventListener('change', () => {
          if (!/^#[0-9a-f]{6}$/i.test(code.value)) code.value = picker.value.toUpperCase();
        });
      });
      document.getElementById('save-price-matrix-settings')?.addEventListener('click', async () => {
        const settings = PRICE_MATRIX_SETTINGS.map((setting) => ({
          ...setting,
          value: document.querySelector(`[data-price-matrix-setting="${setting.key}"]`)?.value,
        }));
        if (settings.some((setting) => setting.value === '' || !Number.isFinite(Number(setting.value)) || Number(setting.value) < 0)) {
          window.alert('料金自動計算の設定値は0以上の数値で入力してください');
          return;
        }
        const results = await Promise.all(
          settings.map((setting) =>
            this.ctx.api(`/api/master-settings/settings/${encodeURIComponent(setting.key)}`, {
              method: 'PUT',
              body: JSON.stringify({ setting_value: setting.value, setting_label: setting.label }),
            })
          )
        );
        if (results.some((result) => !result.res.ok)) {
          window.alert('料金自動計算設定の保存に失敗しました');
          return;
        }
        this.ctx.showToast('料金自動計算設定を保存しました');
      });
      document.getElementById('save-daily-report-settings')?.addEventListener('click', async () => {
        const settings = DAILY_REPORT_SETTINGS.map((setting) => ({
          ...setting,
          value: document.querySelector(`[data-daily-report-setting="${setting.key}"]`)?.value,
        }));
        const invalid = settings.some((setting) => {
          if (setting.type === 'color') return !/^#[0-9a-f]{6}$/i.test(setting.value || '');
          const value = Number(setting.value);
          return !Number.isFinite(value) || value < Number(setting.min) || value > Number(setting.max);
        });
        if (invalid) {
          window.alert('日報入力画面の設定値を指定範囲で入力してください');
          return;
        }
        const results = await Promise.all(
          settings.map((setting) =>
            this.ctx.api(`/api/master-settings/settings/${encodeURIComponent(setting.key)}`, {
              method: 'PUT',
              body: JSON.stringify({ setting_value: setting.value, setting_label: setting.label }),
            })
          )
        );
        if (results.some((result) => !result.res.ok)) {
          window.alert('日報入力画面設定の保存に失敗しました');
          return;
        }
        this.ctx.showToast('日報入力画面設定を保存しました');
      });
      document.getElementById('save-settlement-line-order')?.addEventListener('click',async()=>{
        const value=document.getElementById('settlement-line-order').value.trim(),labels=document.getElementById('settlement-line-labels').value.trim();
        const allowed=['basic','overtime','night','night_overtime','distance','shortage'];
        const parts=value.split(',').map(x=>x.trim());
        if(parts.length!==allowed.length||new Set(parts).size!==allowed.length||parts.some(x=>!allowed.includes(x)))return window.alert('6項目を重複なく指定してください');
        const labelParts=labels.split(',').map(x=>x.trim());if(labelParts.length!==6||labelParts.some(x=>!x))return window.alert('表示名を6項目入力してください');
        const results=await Promise.all([this.ctx.api('/api/master-settings/settings/settlement_line_display_order',{method:'PUT',body:JSON.stringify({setting_value:parts.join(','),setting_label:'請求・支払摘要の表示順'})}),this.ctx.api('/api/master-settings/settings/settlement_line_display_labels',{method:'PUT',body:JSON.stringify({setting_value:labelParts.join(','),setting_label:'請求・支払摘要の表示名'})})]);
        if(results.some(x=>!x.res.ok))return window.alert('保存に失敗しました');this.ctx.showToast('摘要表示順と表示名を保存しました');
      });
      document.getElementById('add-setting')?.addEventListener('click', async () => {
        const key = document.getElementById('new-key').value.trim();
        if (!key) return;
        await this.ctx.api(`/api/master-settings/settings/${encodeURIComponent(key)}`, {
          method: 'PUT',
          body: JSON.stringify({
            setting_value: document.getElementById('new-value').value,
            setting_label: document.getElementById('new-label').value,
          }),
        });
        await this.showSettings();
      });
      document.querySelectorAll('[data-save-setting]').forEach((btn) =>
        btn.addEventListener('click', async () => {
          const key = btn.getAttribute('data-save-setting');
          const value = document.querySelector(`input[data-key="${key}"]`)?.value;
          const result = await this.ctx.api(`/api/master-settings/settings/${encodeURIComponent(key)}`, {
            method: 'PUT',
            body: JSON.stringify({ setting_value: value }),
          });
          if (!result.res.ok) window.alert(result.data?.message || '保存失敗');
          else this.ctx.showToast('保存しました');
        })
      );
    },
  };

  LinksMasterSettings.HELP = MASTER_HELP;
  window.LinksMasterSettings = LinksMasterSettings;
})();
