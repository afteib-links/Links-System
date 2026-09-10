(() => {
  const TYPE_LABELS = {
    company: '企業',
    base: '基本案件',
    project: '個別案件',
    price: '金額データ',
  };

  const LinksBaseManagement = {
    async open(ctx) {
      this.ctx = ctx;
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.state = {
        all: false,
        companyId: null,
        baseId: null,
        projectId: null,
        priceId: null,
        selected: null,
        includeEnded: false,
        sort: {
          company: ['name', 1],
          base: ['name', 1],
          project: ['name', 1],
          price: ['name', 1],
        },
      };
      await this.load();
    },

    async load() {
      this.ctx.renderLoading();
      const { res, data } = await this.ctx.api(`/api/base-management?include_ended=${this.state.includeEnded ? '1' : '0'}`);
      if (!res.ok || !data?.ok) {
        this.ctx.app.innerHTML = this.kit.shell(
          '基本管理',
          `<section class="panel"><p class="error">${this.ctx.escapeHtml(data?.message || '基本管理データを取得できませんでした')}</p></section>`,
          { wide: true, showHistoryBack: false }
        );
        this.kit.bindShell();
        return;
      }
      this.data = {
        companies: data.companies || [],
        bases: data.base_projects || [],
        projects: data.projects || [],
        prices: data.price_sets || [],
      };
      this.render();
    },

    esc(value) { return this.ctx.escapeHtml(value ?? ''); },
    date(value) { return value ? String(value).slice(0, 10) : '未設定'; },
    closing(value) {
      if (!value) return '未設定';
      const v = String(value);
      return v === 'end' || v === '末' || v === '末日' ? '末日' : `${v.replace('日', '')}日`;
    },
    money(value) { return `￥${Math.round(Number(value || 0)).toLocaleString('ja-JP')}`; },
    idOf(type, row) {
      return Number(row?.[`${type === 'base' ? 'base_project' : type === 'price' ? 'price_set' : type}_id`] || 0);
    },
    nameOf(type, row) {
      if (!row) return '';
      if (type === 'company') return row.company_name || `企業 #${row.company_id}`;
      if (type === 'base') return row.template_name || `基本案件 #${row.base_project_id}`;
      if (type === 'project') return row.project_name || row.partner_name || `個別案件 #${row.project_id}`;
      return row.price_set_name || `金額データ #${row.price_set_id}`;
    },
    company(id) { return this.data.companies.find((row) => Number(row.company_id) === Number(id)); },
    base(id) { return this.data.bases.find((row) => Number(row.base_project_id) === Number(id)); },
    project(id) { return this.data.projects.find((row) => Number(row.project_id) === Number(id)); },
    hasBasePrices(baseId) { return this.data.prices.some((row) => Number(row.base_project_id) === Number(baseId) && !row.project_id); },

    breadcrumbs() {
      const selected = this.state.selected;
      if (!selected) {
        const scopedCompany = this.company(this.state.companyId);
        return scopedCompany ? [this.nameOf('company', scopedCompany)] : [];
      }
      const { type, row } = selected;
      const project = type === 'project' ? row : type === 'price' ? this.project(row.project_id) : null;
      const base = type === 'base' ? row : this.base(project?.base_project_id || (type === 'price' ? row.base_project_id : null));
      const company = type === 'company' ? row : this.company(row.company_id || project?.company_id || base?.company_id);
      return [
        company && this.nameOf('company', company),
        base && this.nameOf('base', base),
        project && this.nameOf('project', project),
        type === 'price' && this.nameOf('price', row),
      ].filter(Boolean);
    },

    rows(type) {
      if (type === 'company') return this.data.companies;
      if (type === 'base') return this.data.bases.filter((row) => this.state.companyId ? Number(row.company_id) === Number(this.state.companyId) : this.state.all);
      if (type === 'project') return this.data.projects.filter((row) => {
        if (this.state.baseId) return Number(row.base_project_id) === Number(this.state.baseId);
        if (this.state.all && this.state.companyId) return Number(row.company_id) === Number(this.state.companyId);
        return this.state.all;
      });
      return this.data.prices.filter((row) => {
        if (this.state.all && this.state.companyId) {
          const project = this.project(row.project_id);
          const base = this.base(row.base_project_id || project?.base_project_id);
          return Number(row.company_id || project?.company_id || base?.company_id) === Number(this.state.companyId);
        }
        if (this.state.all) return true;
        if (this.state.projectId) return Number(row.project_id) === Number(this.state.projectId);
        if (this.state.baseId) return Number(row.base_project_id) === Number(this.state.baseId) && !row.project_id;
        return false;
      });
    },

    sorted(type, rows = this.rows(type)) {
      const [key, direction] = this.state.sort[type];
      const value = (row) => {
        if (key === 'closing') return String(row.closing_date_code || row.closing_date || '999');
        if (key === 'start') return String(row.apply_start_date || '9999-99-99');
        return this.nameOf(type, row).toLocaleLowerCase('ja');
      };
      return [...rows].sort((a, b) => value(a).localeCompare(value(b), 'ja', { numeric: true }) * direction);
    },

    columnHeader(type, title, count, controls) {
      const [key, direction] = this.state.sort[type];
      const button = (sortKey, label) => `<button type="button" class="bm-sort ${key === sortKey ? 'is-active' : ''}" data-sort-type="${type}" data-sort-key="${sortKey}">${this.esc(label)}${key === sortKey ? (direction > 0 ? ' ▲' : ' ▼') : ''}</button>`;
      return `<div class="bm-column-head"><div class="bm-column-title"><strong>${this.esc(title)}</strong><span data-count-type="${type}">${count}</span></div><div class="bm-column-controls">${controls || ''}${button('name', type === 'company' ? '企業名' : type === 'price' ? '名称' : '名称')}${button(type === 'price' ? 'start' : 'closing', type === 'price' ? '適用開始日' : '締日')}</div></div>`;
    },

    render() {
      const crumbs = this.breadcrumbs();
      const companyCount = this.data.companies.length;
      const baseCount = this.rows('base').length;
      const projectCount = this.rows('project').length;
      const priceCount = this.rows('price').length;
      const allCompany = `<button type="button" class="bm-sort ${this.state.all && !this.state.companyId ? 'is-active' : ''}" data-all="company">全対象</button>`;
      const allBase = `<button type="button" class="bm-sort ${this.state.all && this.state.companyId ? 'is-active' : ''}" data-all="base" ${this.state.companyId ? '' : 'disabled'}>全対象</button>`;
      const body = `
        <section class="bm-screen" aria-label="基本管理">
          <div class="bm-guide"><div class="bm-breadcrumb" id="bm-breadcrumb">${crumbs.length ? crumbs.map(this.esc.bind(this)).join('<span>›</span>') : '全企業'}</div><div><label class="check-item bm-include-ended"><input type="checkbox" id="bm-include-ended" ${this.state.includeEnded ? 'checked' : ''}><span>終了しているものも表示</span></label><strong>クリック</strong>で詳細 <span>／</span> <strong>ダブルクリック</strong>で編集画面</div></div>
          <div class="bm-workspace">
            <div class="bm-browser">
              <div class="bm-heads">
                ${this.columnHeader('company', '企業', companyCount, allCompany)}
                ${this.columnHeader('base', '基本案件', baseCount, allBase)}
                ${this.columnHeader('project', '個別案件', projectCount)}
                ${this.columnHeader('price', '金額データ', priceCount)}
              </div>
              ${this.state.all ? this.allTable() : this.normalColumns()}
            </div>
            <aside class="bm-preview"><div class="bm-preview-title">詳細プレビュー</div><div id="bm-preview-body">${this.preview()}</div></aside>
          </div>
        </section>`;
      this.ctx.app.innerHTML = this.kit.shell('基本管理', body, { wide: true, showHistoryBack: false, scrollBodyOnly: true });
      this.kit.bindShell();
      this.bindControls();
      this.bindRows();
      this.bindPreview();
    },

    normalColumns() {
      return `<div class="bm-columns">${['company', 'base', 'project', 'price'].map((type) => `<div class="bm-list" data-list="${type}">${this.listRows(type)}</div>`).join('')}</div>`;
    },

    createButton(type, label, context = {}) {
      const attrs = [
        ['company-id', context.companyId],
        ['base-id', context.baseId],
        ['project-id', context.projectId],
      ].filter(([, value]) => value).map(([key, value]) => ` data-${key}="${Number(value)}"`).join('');
      return `<button type="button" class="bm-empty-action" data-create-type="${type}"${attrs}><strong>${this.esc(label)}</strong><span>＋ 新規登録</span></button>`;
    },

    listRows(type) {
      const rows = this.sorted(type);
      if (!rows.length) {
        if (type === 'base' && this.state.companyId) return this.createButton('base', '基本案件なし', { companyId: this.state.companyId });
        if (type === 'project' && this.state.baseId) return this.createButton('project', '個別案件なし', { companyId: this.state.companyId, baseId: this.state.baseId });
        if (type === 'price' && (this.state.projectId || this.state.baseId)) return this.createButton('price', '金額データなし', { companyId: this.state.companyId, baseId: this.state.baseId, projectId: this.state.projectId });
        const empty = type === 'base' ? '企業を選択してください' : type === 'project' ? '基本案件を選択してください' : type === 'price' ? '個別案件を選択してください' : '企業がありません';
        return `<div class="bm-empty">${this.esc(empty)}</div>`;
      }
      return rows.map((row) => this.rowButton(type, row)).join('');
    },

    rowButton(type, row) {
      const id = this.idOf(type, row);
      const selected = this.state.selected?.type === type && this.idOf(type, this.state.selected.row) === id;
      let meta = '';
      if (type === 'company') meta = `${row.office_no ? `No ${row.office_no}　` : ''}締日 ${this.closing(row.closing_date_code)}`;
      if (type === 'base') meta = `締日 ${this.closing(row.closing_date)}　${this.data.projects.filter((p) => Number(p.base_project_id) === id).length}案件`;
      if (type === 'project') meta = `${row.partner_name || 'パートナー未設定'}　締日 ${this.closing(row.closing_date)}`;
      if (type === 'price') meta = `適用開始 ${this.date(row.apply_start_date)}`;
      const baseData = type === 'project' && this.hasBasePrices(row.base_project_id) ? '<em class="bm-base-data">基本データ</em>' : '';
      return `<button type="button" class="bm-row ${selected ? 'is-selected' : ''}" data-type="${type}" data-id="${id}"><strong>${this.esc(this.nameOf(type, row))}${baseData}</strong><span>${this.esc(meta)}</span><i aria-hidden="true">›</i></button>`;
    },

    hierarchy() {
      const companies = this.state.companyId ? this.sorted('company', [this.company(this.state.companyId)].filter(Boolean)) : this.sorted('company');
      const result = [];
      companies.forEach((company) => {
        const bases = this.sorted('base', this.data.bases.filter((b) => Number(b.company_id) === Number(company.company_id)));
        if (!bases.length) {
          result.push({ company, base: null, project: null, price: null, companyFirst: true, baseFirst: true, projectFirst: true, companySpan: 1, baseSpan: 1, projectSpan: 1 });
          return;
        }
        const companyRows = [];
        bases.forEach((base) => {
          const projects = this.sorted('project', this.data.projects.filter((p) => Number(p.base_project_id) === Number(base.base_project_id)));
          const baseRows = [];
          const addProject = (project) => {
            const prices = this.sorted('price', this.data.prices.filter((ps) => project ? Number(ps.project_id) === Number(project.project_id) : Number(ps.base_project_id) === Number(base.base_project_id) && !ps.project_id));
            const actual = prices.length ? prices : [null];
            actual.forEach((price, index) => baseRows.push({ company, base, project, price, projectFirst: index === 0, projectSpan: actual.length }));
          };
          const basePrices = this.data.prices.filter((ps) => Number(ps.base_project_id) === Number(base.base_project_id) && !ps.project_id);
          if (basePrices.length || !projects.length) addProject(null);
          projects.forEach(addProject);
          baseRows.forEach((item, index) => Object.assign(item, { baseFirst: index === 0, baseSpan: baseRows.length }));
          companyRows.push(...baseRows);
        });
        companyRows.forEach((item, index) => Object.assign(item, { companyFirst: index === 0, companySpan: companyRows.length }));
        result.push(...companyRows);
      });
      return result;
    },

    allTable() {
      const cell = (type, row, rowspan, emptyHtml) => {
        const selected = row && this.state.selected?.type === type && this.idOf(type, this.state.selected.row) === this.idOf(type, row);
        const baseData = type === 'project' && row && this.hasBasePrices(row.base_project_id) ? '<em class="bm-base-data">基本データ</em>' : '';
        return `<td rowspan="${rowspan}" class="${row ? `bm-group-cell ${selected ? 'is-selected' : ''}` : 'bm-placeholder'}" ${row ? `data-type="${type}" data-id="${this.idOf(type, row)}"` : ''}>${row ? `<strong>${this.esc(this.nameOf(type, row))}${baseData}</strong><span>${type === 'company' ? `締日 ${this.closing(row.closing_date_code)}` : type === 'price' ? `適用開始 ${this.date(row.apply_start_date)}` : `締日 ${this.closing(row.closing_date)}`}</span>` : emptyHtml}</td>`;
      };
      const rows = this.hierarchy().map((item) => `<tr>
        ${item.companyFirst ? cell('company', item.company, item.companySpan, '') : ''}
        ${item.baseFirst ? cell('base', item.base, item.baseSpan, this.createButton('base', '基本案件なし', { companyId: item.company?.company_id })) : ''}
        ${item.projectFirst ? cell('project', item.project, item.projectSpan, item.base ? this.createButton('project', '個別案件なし', { companyId: item.company?.company_id, baseId: item.base?.base_project_id }) : '個別案件なし') : ''}
        ${cell('price', item.price, 1, item.project || item.base ? this.createButton('price', '金額データなし', { companyId: item.company?.company_id, baseId: item.base?.base_project_id, projectId: item.project?.project_id }) : '金額データなし')}
      </tr>`).join('');
      return `<div class="bm-all-wrap"><table class="bm-all-table"><colgroup><col><col><col><col></colgroup><tbody>${rows || '<tr><td colspan="4" class="bm-empty">対象データがありません</td></tr>'}</tbody></table></div>`;
    },

    counts(type, row) {
      if (type === 'company') {
        const bases = this.data.bases.filter((b) => Number(b.company_id) === Number(row.company_id));
        const baseIds = new Set(bases.map((b) => Number(b.base_project_id)));
        return { bases: bases.length, projects: this.data.projects.filter((p) => baseIds.has(Number(p.base_project_id))).length };
      }
      if (type === 'base') return { projects: this.data.projects.filter((p) => Number(p.base_project_id) === Number(row.base_project_id)).length, prices: this.data.prices.filter((p) => Number(p.base_project_id) === Number(row.base_project_id) && !p.project_id).length };
      if (type === 'project') return { prices: this.data.prices.filter((p) => Number(p.project_id) === Number(row.project_id)).length };
      return {};
    },

    detailGrid(items) {
      return `<div class="bm-detail-grid">${items.map(([label, value]) => `<div><span>${this.esc(label)}</span><strong>${this.esc(value ?? '未設定')}</strong></div>`).join('')}</div>`;
    },

    preview() {
      const selected = this.state.selected;
      if (!selected) return '<div class="bm-preview-empty"><strong>項目を選択してください</strong><span>企業、基本案件、個別案件、金額データをクリックすると詳細を表示します。</span></div>';
      const { type, row } = selected;
      const counts = this.counts(type, row);
      let items;
      let next;
      let notice = '';
      if (type === 'company') {
        items = [['企業No', row.office_no || row.company_id], ['企業名', row.company_name], ['フリガナ', row.company_name_kana], ['締日', this.closing(row.closing_date_code)], ['支払日', this.closing(row.payment_date_code)], ['基本契約日', this.date(row.contract_date)], ['基本案件数', `${counts.bases}件`], ['個別案件数', `${counts.projects}件`]];
        next = counts.bases ? '基本案件の条件と担当を確認してください。' : '基本案件を作成し、契約条件を設定してください。';
      } else if (type === 'base') {
        const company = this.company(row.company_id);
        items = [['基本案件No', row.base_project_id], ['企業', company?.company_name], ['テンプレート名', row.template_name], ['担当', row.default_manager], ['業種', row.business_type], ['勤務条件', row.basic_work_hours ? `${row.basic_work_hours}時間／${row.work_time_type === 'actual' ? '実働' : '拘束'}` : '未設定'], ['締日', this.closing(row.closing_date)], ['個別案件数', `${counts.projects}件`], ['金額データ数', `${counts.prices}件`]];
        next = !counts.projects ? 'この基本案件から個別案件を作成してください。' : !counts.prices ? '基本案件に金額データを設定してください。' : '個別案件と金額データの適用期間を確認してください。';
      } else if (type === 'project') {
        const base = this.base(row.base_project_id);
        const company = this.company(row.company_id);
        const missing = [!row.partner_id && 'パートナー', !row.manager_name && '担当', !row.operation_start_date && '運用開始日'].filter(Boolean);
        items = [['案件No', row.project_id], ['企業', company?.company_name], ['基本案件', base?.template_name], ['パートナー', row.partner_name], ['担当', row.manager_name], ['業種', row.business_type], ['運用開始日', this.date(row.operation_start_date)], ['締日', this.closing(row.closing_date)], ['支払区分', row.payment_type === 'installment' ? '分割' : '通常'], ['金額データ数', `${counts.prices}件`]];
        if (missing.length) notice = `<div class="bm-alert">未設定：${this.esc(missing.join('、'))}</div>`;
        next = missing.length ? `${missing.join('、')}を設定してください。` : counts.prices ? '運用条件と適用中の金額データを確認してください。' : '案件用の金額データを設定してください。';
      } else {
        const project = this.project(row.project_id);
        const base = this.base(row.base_project_id || project?.base_project_id);
        const company = this.company(row.company_id || project?.company_id || base?.company_id);
        const today = '2026-09-08';
        const status = row.apply_start_date > today ? '適用予定' : row.apply_end_date && row.apply_end_date < today ? '適用終了' : '適用中';
        const billing = Number(row.billing_unit_total || 0);
        const payment = Number(row.payment_unit_total || 0);
        const difference = billing - payment;
        const margin = billing > 0 ? `${((difference / billing) * 100).toFixed(1)}%` : '算出不可';
        items = [['金額データNo', row.price_set_no || row.price_set_id], ['名称', row.price_set_name], ['企業', company?.company_name], ['基本案件', base?.template_name], ['個別案件', project ? this.nameOf('project', project) : '基本案件用'], ['適用開始日', this.date(row.apply_start_date)], ['適用終了日', this.date(row.apply_end_date)], ['料金行数', `${row.line_count || 0}件`], ['請求単価合計', this.money(billing)], ['支払単価合計', this.money(payment)], ['単価差額合計', this.money(difference)], ['参考利益率', margin], ['適用状態', status]];
        next = status === '適用終了' ? '必要に応じてコピーして次の改定を作成してください。' : '料金項目と適用期間を確認し、必要なら改定コピーしてください。';
      }
      const amountNote = type === 'price' ? '<p class="bm-amount-note">金額は登録されている料金行の単価を合算した確認用の参考値です。月次の請求額・支払額ではありません。</p>' : '';
      return `<div class="bm-preview-card"><div class="bm-preview-hero"><div><small>${TYPE_LABELS[type]}</small><h2>${this.esc(this.nameOf(type, row))}</h2><p>選択項目の登録内容と関連状況</p></div><button type="button" class="btn bm-edit" data-edit-type="${type}" data-edit-id="${this.idOf(type, row)}">編集を開く</button></div>${notice}${this.detailGrid(items)}${amountNote}<div class="bm-next"><span>次に確認・設定する内容</span><strong>${this.esc(next)}</strong></div><div class="bm-preview-actions"><button type="button" class="btn" data-edit-type="${type}" data-edit-id="${this.idOf(type, row)}">編集画面へ</button>${type === 'price' ? '<button type="button" class="btn btn-ghost" data-copy-price>コピーして改定</button>' : ''}</div><p class="bm-updated">最終更新 ${this.esc(row.updated_at ? String(row.updated_at).replace('T', ' ').slice(0, 16) : '未取得')}</p></div>`;
    },

    select(type, id) {
      const map = { company: 'companies', base: 'bases', project: 'projects', price: 'prices' };
      const row = this.data[map[type]].find((item) => this.idOf(type, item) === Number(id));
      if (!row) return;
      if (this.state.all) {
        this.state.selected = { type, row };
        this.updateSelection();
        return;
      }
      if (type === 'company') Object.assign(this.state, { companyId: row.company_id, baseId: null, projectId: null, priceId: null });
      if (type === 'base') Object.assign(this.state, { companyId: row.company_id, baseId: row.base_project_id, projectId: null, priceId: null });
      if (type === 'project') Object.assign(this.state, { companyId: row.company_id, baseId: row.base_project_id, projectId: row.project_id, priceId: null });
      if (type === 'price') Object.assign(this.state, { priceId: row.price_set_id });
      this.state.selected = { type, row };
      this.updateSelection(type);
    },

    edit(type, id) {
      if (type === 'company') return this.ctx.openFeature('companies', { company_id: id });
      if (type === 'base') return this.ctx.openFeature('base_projects', { base_project_id: id });
      if (type === 'project') return this.ctx.openFeature('projects', { project_id: id });
      return this.ctx.openFeature('price_sets', { price_set_id: id });
    },

    create(type, context) {
      const companyId = Number(context.companyId || 0) || null;
      const baseId = Number(context.baseId || 0) || null;
      const projectId = Number(context.projectId || 0) || null;
      if (type === 'base') return this.ctx.openFeature('base_projects', { new: true, company_id: companyId });
      if (type === 'project') return this.ctx.openFeature('projects', { new: true, company_id: companyId, base_project_id: baseId });
      return this.ctx.openFeature('price_sets', { new_with_owner: true, company_id: companyId, base_project_id: projectId ? null : baseId, project_id: projectId });
    },

    updateSelection(changedType = null) {
      const downstream = changedType === 'company' ? ['base', 'project', 'price'] : changedType === 'base' ? ['project', 'price'] : changedType === 'project' ? ['price'] : [];
      downstream.forEach((type) => {
        const list = document.querySelector(`[data-list="${type}"]`);
        if (!list) return;
        list.innerHTML = this.listRows(type);
        this.bindRows(list);
        const count = document.querySelector(`[data-count-type="${type}"]`);
        if (count) count.textContent = String(this.rows(type).length);
      });
      document.querySelectorAll('[data-type][data-id]').forEach((element) => {
        const selected = this.state.selected?.type === element.dataset.type && this.idOf(element.dataset.type, this.state.selected.row) === Number(element.dataset.id);
        element.classList.toggle('is-selected', selected);
      });
      const crumbs = this.breadcrumbs();
      const breadcrumb = document.getElementById('bm-breadcrumb');
      if (breadcrumb) breadcrumb.innerHTML = crumbs.length ? crumbs.map(this.esc.bind(this)).join('<span>›</span>') : '全企業';
      const preview = document.getElementById('bm-preview-body');
      if (preview) {
        preview.innerHTML = this.preview();
        preview.scrollTop = 0;
        this.bindPreview();
      }
    },

    bindRows(root = document) {
      root.querySelectorAll('[data-type][data-id]').forEach((element) => {
        element.addEventListener('click', () => {
          clearTimeout(this.clickTimer);
          this.clickTimer = setTimeout(() => this.select(element.dataset.type, element.dataset.id), 180);
        });
        element.addEventListener('dblclick', () => {
          clearTimeout(this.clickTimer);
          this.edit(element.dataset.type, Number(element.dataset.id));
        });
        element.addEventListener('pointerup', (event) => {
          if (event.pointerType === 'mouse') return;
          const now=Date.now(),previous=Number(element.dataset.lastTapAt||0);
          element.dataset.lastTapAt=String(now);
          if(now-previous>350)return;
          clearTimeout(this.clickTimer);
          element.dataset.lastTapAt='0';
          this.edit(element.dataset.type,Number(element.dataset.id));
        });
      });
      root.querySelectorAll('[data-create-type]').forEach((button) => button.addEventListener('click', (event) => {
        event.stopPropagation();
        this.create(button.dataset.createType, button.dataset);
      }));
    },

    bindControls() {
      document.getElementById('bm-include-ended')?.addEventListener('change', (event) => {
        this.state.includeEnded = event.target.checked;
        Object.assign(this.state, { all: false, companyId: null, baseId: null, projectId: null, priceId: null, selected: null });
        this.load();
      });
      document.querySelectorAll('[data-sort-type]').forEach((button) => button.addEventListener('click', () => {
        const type = button.dataset.sortType;
        const key = button.dataset.sortKey;
        const current = this.state.sort[type];
        this.state.sort[type] = [key, current[0] === key ? current[1] * -1 : 1];
        this.render();
      }));
      document.querySelector('[data-all="company"]')?.addEventListener('click', () => {
        const next = !(this.state.all && !this.state.companyId);
        Object.assign(this.state, { all: next, companyId: null, baseId: null, projectId: null, priceId: null, selected: null });
        this.render();
      });
      document.querySelector('[data-all="base"]')?.addEventListener('click', () => {
        if (!this.state.companyId) return;
        const next = !(this.state.all && this.state.companyId);
        Object.assign(this.state, { all: next, baseId: null, projectId: null, priceId: null, selected: null });
        this.render();
      });
    },

    bindPreview() {
      document.querySelectorAll('#bm-preview-body [data-edit-type]').forEach((button) => button.addEventListener('click', () => this.edit(button.dataset.editType, Number(button.dataset.editId))));
      document.querySelector('[data-copy-price]')?.addEventListener('click', () => this.ctx.openFeature('price_sets', { price_set_id: this.idOf('price', this.state.selected?.row) }));
    },
  };

  window.LinksBaseManagement = LinksBaseManagement;
})();
