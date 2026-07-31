(() => {
  const DEFAULT_BLOCKS = [
    { key: 'header', label: 'ヘッダー' },
    { key: 'basic', label: '基本情報' },
    { key: 'detail', label: '詳細' },
    { key: 'actions', label: '操作ボタン' },
  ];

  const LinksUiBuilder = {
    async open(ctx, options = {}) {
      this.kit = window.LinksFeatureKit.createFeatureKit(ctx);
      this.ctx = ctx;
      this.screenKey = options.screen_key || 'companies';
      await this.showEditor();
    },

    async showEditor(message = '') {
      this.ctx.renderLoading();
      const saved = await this.kit.loadLayout(this.screenKey);
      const layoutJson = saved?.layout_json;
      this.blocks =
        Array.isArray(layoutJson?.blocks) && layoutJson.blocks.length
          ? layoutJson.blocks.map((b) => ({ ...b }))
          : DEFAULT_BLOCKS.map((b) => ({ ...b }));

      const list = this.blocks
        .map(
          (b, idx) => `
          <li class="ui-block-item" data-idx="${idx}">
            <span class="ui-block-key">${this.ctx.escapeHtml(b.key)}</span>
            <input class="ui-block-label" value="${this.ctx.escapeHtml(b.label || b.key)}" />
            <button type="button" class="btn btn-ghost btn-small" data-up="${idx}">↑</button>
            <button type="button" class="btn btn-ghost btn-small" data-down="${idx}">↓</button>
            <button type="button" class="btn btn-danger btn-small" data-remove="${idx}">削除</button>
          </li>`
        )
        .join('');

      this.ctx.app.innerHTML = this.kit.shell(
        'UIビルダー（仮組）',
        `<section class="panel">
          ${message ? `<p class="flash">${this.ctx.escapeHtml(message)}</p>` : ''}
          <div class="toolbar">
            <label>画面キー</label>
            <input id="screen-key" value="${this.ctx.escapeHtml(this.screenKey)}" />
            <button type="button" class="btn" id="load-screen">読込</button>
            <button type="button" class="btn" id="add-block">＋ ブロック追加</button>
            <button type="button" class="btn" id="save-layout">保存</button>
          </div>
          <p class="muted">ブロックの並びを上下で変更し、画面レイアウトとして保存します。</p>
          <ul class="ui-block-list" id="block-list">${list || '<li class="muted">ブロックなし</li>'}</ul>
        </section>`
      );
      this.kit.bindShell();
      document.getElementById('load-screen')?.addEventListener('click', () => {
        this.screenKey = document.getElementById('screen-key').value.trim() || 'companies';
        this.showEditor();
      });
      document.getElementById('add-block')?.addEventListener('click', () => {
        this.collect();
        const key = `block_${this.blocks.length + 1}`;
        this.blocks.push({ key, label: `ブロック${this.blocks.length + 1}` });
        this.rerenderList();
      });
      document.getElementById('save-layout')?.addEventListener('click', async () => {
        this.collect();
        this.screenKey = document.getElementById('screen-key').value.trim() || this.screenKey;
        const result = await this.kit.saveLayout(this.screenKey, null, { blocks: this.blocks });
        if (!result.res.ok || !result.data?.ok) {
          window.alert(result.data?.message || '保存失敗');
          return;
        }
        await this.showEditor('レイアウトを保存しました');
      });
      this.bindList();
    },

    collect() {
      document.querySelectorAll('.ui-block-item').forEach((li) => {
        const idx = Number(li.getAttribute('data-idx'));
        if (!this.blocks[idx]) return;
        this.blocks[idx].label = li.querySelector('.ui-block-label')?.value || this.blocks[idx].key;
      });
    },

    rerenderList() {
      const list = document.getElementById('block-list');
      if (!list) return;
      list.innerHTML = this.blocks
        .map(
          (b, idx) => `
          <li class="ui-block-item" data-idx="${idx}">
            <span class="ui-block-key">${this.ctx.escapeHtml(b.key)}</span>
            <input class="ui-block-label" value="${this.ctx.escapeHtml(b.label || b.key)}" />
            <button type="button" class="btn btn-ghost btn-small" data-up="${idx}">↑</button>
            <button type="button" class="btn btn-ghost btn-small" data-down="${idx}">↓</button>
            <button type="button" class="btn btn-danger btn-small" data-remove="${idx}">削除</button>
          </li>`
        )
        .join('');
      this.bindList();
    },

    bindList() {
      document.querySelectorAll('[data-up]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.collect();
          const i = Number(btn.getAttribute('data-up'));
          if (i <= 0) return;
          const tmp = this.blocks[i - 1];
          this.blocks[i - 1] = this.blocks[i];
          this.blocks[i] = tmp;
          this.rerenderList();
        })
      );
      document.querySelectorAll('[data-down]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.collect();
          const i = Number(btn.getAttribute('data-down'));
          if (i >= this.blocks.length - 1) return;
          const tmp = this.blocks[i + 1];
          this.blocks[i + 1] = this.blocks[i];
          this.blocks[i] = tmp;
          this.rerenderList();
        })
      );
      document.querySelectorAll('[data-remove]').forEach((btn) =>
        btn.addEventListener('click', () => {
          this.collect();
          this.blocks.splice(Number(btn.getAttribute('data-remove')), 1);
          this.rerenderList();
        })
      );
    },
  };

  window.LinksUiBuilder = LinksUiBuilder;
})();
