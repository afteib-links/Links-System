(() => {
  function createFeatureKit(ctx) {
    return {
      ctx,
      dateValue(value) {
        if (!value) return '';
        const s = String(value);
        return s.length >= 10 ? s.slice(0, 10) : s;
      },
      timeValue(value) {
        if (!value) return '';
        const s = String(value);
        return s.length >= 5 ? s.slice(0, 5) : s;
      },
      shell(title, bodyHtml) {
        return `
          <div class="app-shell">
            ${ctx.headerHtml()}
            <main class="app-main">
              <div class="back-row">
                <button type="button" class="btn btn-ghost" id="back-launcher">← 機能一覧へ戻る</button>
              </div>
              <h2 class="page-title">${ctx.escapeHtml(title)}</h2>
              ${bodyHtml}
            </main>
          </div>`;
      },
      bindShell() {
        ctx.bindLogout();
        document.getElementById('back-launcher')?.addEventListener('click', () => ctx.showHome());
      },
      optionsFromList(list, valueKey, labelKey, selected) {
        return [`<option value="">（未選択）</option>`]
          .concat(
            (list || []).map((row) => {
              const val = row[valueKey];
              const label = row[labelKey];
              return `<option value="${ctx.escapeHtml(val)}" ${
                String(val) === String(selected) ? 'selected' : ''
              }>${ctx.escapeHtml(label)} (#${ctx.escapeHtml(val)})</option>`;
            })
          )
          .join('');
      },
      codeOptions(codes, selected) {
        return [`<option value="">（未選択）</option>`]
          .concat(
            (codes || []).map(
              (c) =>
                `<option value="${ctx.escapeHtml(c.code_value)}" ${
                  c.code_value === selected ? 'selected' : ''
                }>${ctx.escapeHtml(c.code_label)}</option>`
            )
          )
          .join('');
      },
      codeLabel(codes, value) {
        if (!value) return '-';
        const hit = (codes || []).find((c) => c.code_value === value);
        return hit ? hit.code_label : value;
      },
      async loadCodes() {
        const { res, data } = await ctx.api('/api/masters/codes');
        const grouped = {};
        if (res.ok && data?.ok) {
          for (const row of data.codes || []) {
            if (!grouped[row.category_code]) grouped[row.category_code] = [];
            grouped[row.category_code].push(row);
          }
        }
        return grouped;
      },
      currentYearMonth() {
        const d = new Date();
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      },
    };
  }

  window.LinksFeatureKit = { createFeatureKit };
})();
