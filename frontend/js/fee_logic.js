(() => {
  const LABELS = { basic: '通常料金（勤務日数／通常時間）', shortage: '不足時間控除', overtime: '時間超過', night: '深夜', night_overtime: '深夜時間超過', distance: '距離数量', unit: 'その他数量（入力元の確認が必要）' };
  const API = '/api/fee-logic';
  window.LinksFeeLogic = {
    async open(ctx, onBack, message = '') {
      const kit = window.LinksFeatureKit.createFeatureKit(ctx);
      const result = await ctx.api(API);
      if (!result.res.ok) return window.alert(result.data?.message || 'マスターを取得できませんでした');
      const masters = result.data.masters;
      const esc = ctx.escapeHtml;
      const cards = (kind) => masters.filter((m) => m.kind === kind).map((m) => {
        const v = m.versions[0];
        const content = kind === 'logic' ? `<code>${esc(v.definition_json.expression)}</code>` : `<ul>${Object.entries(v.definition_json.members).map(([component, code]) => `<li>${esc(LABELS[component])} → ${esc(masters.find((logic) => logic.code === code)?.name || code)}</li>`).join('')}</ul>`;
        return `<section class="panel"><h3>${esc(m.name)}</h3>${content}<p>最新公開版 v${v.version_no} ／ 適用開始日 ${esc(v.effective_from)}</p><p class="muted">${esc(v.reason)}</p>${kind === 'logic' && result.data.can_edit ? `<button class="btn" data-revise="${esc(m.code)}">検算して新版を登録</button>` : ''}<details><summary>版の履歴（勤務日で選択）</summary>${m.versions.map((version) => `<p>v${version.version_no} ／ ${esc(version.effective_from)}～ ／ ${esc(version.definition_json.expression || 'グループ構成')} ／ ${esc(version.reason)}</p>`).join('')}</details></section>`;
      }).join('');
      ctx.app.innerHTML = kit.shell('料金計算ロジック・グループマスター', `<section class="panel"><p>料金カード → グループ → 共通ロジック の順で参照します。単価は料金カード、数量は日報、丸めは既存設定から取得します。</p><p>新版は適用開始日以降の勤務分に使用します。未確定データは再計算操作後に反映され、確定済み金額は変更しません。</p><p class="warning">数量料金の入力元や月間集約条件が未確認のカードは、グループに連携しても自動計算の確認待ちを継続します。</p>${message ? `<p class="flash">${esc(message)}</p>` : ''}</section><h2>計算ロジック（2種類）</h2>${cards('logic')}<h2>ロジックグループ</h2>${cards('group')}<div id="modal-host"></div>`, { onBack });
      kit.bindShell({ onBack });
      document.querySelectorAll('[data-revise]').forEach((button) => button.addEventListener('click', () => {
        const master = masters.find((m) => m.code === button.dataset.revise);
        const previous = master.versions[0];
        document.getElementById('modal-host').innerHTML = kit.modalHtml(`${master.name} の新版`, `<div class="form-grid"><div class="full"><label>金額算式（数量 quantity・単価 unit_price）</label><input id="logic-expression" value="${esc(previous.definition_json.expression)}" maxlength="500"></div><div><label>適用開始日</label><input type="date" id="logic-date"></div><div><label>検算の数量</label><input type="number" step="any" min="0" id="logic-quantity" value="18"></div><div><label>検算の単価</label><input type="number" step="any" min="0" id="logic-rate" value="17500"></div><div><label>期待する金額</label><input type="number" step="any" id="logic-expected" value="${master.code === 'deduct' ? -315000 : 315000}"></div><div class="full"><label>変更理由・確認記録</label><textarea id="logic-reason" maxlength="1000"></textarea></div><p class="full" id="logic-validation" role="status"></p></div>`, '<button class="btn btn-secondary" id="logic-preview">検算</button><button class="btn" id="logic-publish" disabled>検算済みの新版を公開</button>', 'modal-wide');
        kit.bindModal();
        let verified = null;
        const payload = () => ({ previous_version: previous.version_no, effective_from: document.getElementById('logic-date').value, definition: { expression: document.getElementById('logic-expression').value }, reason: document.getElementById('logic-reason').value, samples: [{ quantity: document.getElementById('logic-quantity').value, unit_price: document.getElementById('logic-rate').value, expected: document.getElementById('logic-expected').value }] });
        document.getElementById('modal-host').addEventListener('input', () => { verified = null; document.getElementById('logic-publish').disabled = true; });
        document.getElementById('logic-preview').addEventListener('click', async () => {
          const body = JSON.stringify(payload());
          const check = await ctx.api(`${API}/${master.code}/preview`, { method: 'POST', body });
          const current = document.getElementById('logic-validation');
          if (!current) return;
          current.textContent = check.res.ok ? `検算一致：${check.data.results[0].actual}円` : check.data.message;
          verified = check.res.ok && body === JSON.stringify(payload()) ? body : null;
          document.getElementById('logic-publish').disabled = !verified;
        });
        document.getElementById('logic-publish').addEventListener('click', async () => {
          if (!verified || verified !== JSON.stringify(payload())) return;
          if (!window.confirm(`${payload().effective_from}以降の勤務分で、連携するすべての料金カードの計算が変わります。公開しますか？`)) return;
          const button = document.getElementById('logic-publish');
          button.disabled = true;
          const saved = await ctx.api(`${API}/${master.code}/versions`, { method: 'POST', body: verified });
          if (!saved.res.ok) { document.getElementById('logic-validation').textContent = saved.data.message; button.disabled = false; return; }
          await this.open(ctx, onBack, `v${saved.data.version_no}を公開しました。既存金額の一括更新は行っていません。`);
        });
      }));
    },
  };
})();
