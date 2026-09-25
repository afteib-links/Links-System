(() => {
  const folder = document.getElementById('project-folder');
  const editor = document.getElementById('editor-choice');
  const link = document.getElementById('open-editor');
  const output = document.getElementById('resolved-path');
  const status = document.getElementById('source-status');
  const relative = document.getElementById('source-path').textContent;
  const key = 'links-system-design-editor';
  try {
    const saved = JSON.parse(localStorage.getItem(key) || '{}');
    folder.value = typeof saved.folder === 'string' ? saved.folder : '';
    editor.value = saved.editor === 'cursor' ? 'cursor' : 'vscode';
  } catch { /* 記憶できない環境でも開く・コピーは利用できる。 */ }

  function update(save) {
    const base = folder.value.trim().replaceAll('\\', '/').replace(/\/+$/, '');
    const valid = /^[a-z]:\//i.test(base) || base.startsWith('/');
    const full = valid ? `${base}/${relative}` : relative;
    output.value = /^[a-z]:\//i.test(base) || base.startsWith('//') ? full.replaceAll('/', '\\') : full;
    link.hidden = !valid;
    if (valid) {
      const scheme = editor.value === 'cursor' ? 'cursor' : 'vscode';
      const encoded = full.split('/').map(encodeURIComponent).join('/').replace(/^([a-z])%3A/i, '$1:');
      link.href = `${scheme}://file/${encoded.replace(/^\/(?!\/)/, '')}`;
      status.textContent = '編集元ファイルへのリンクを用意しました。フォルダーが正しいことを確認して開いてください。';
    } else {
      link.removeAttribute('href');
      status.textContent = '編集用フォルダーを指定すると、元ファイルを開けます。未設定時はプロジェクト内の相対パスをコピーできます。';
    }
    if (save) {
      try { localStorage.setItem(key, JSON.stringify({ folder: folder.value, editor: editor.value })); }
      catch { status.textContent += ' このブラウザでは設定を記憶できません。'; }
    }
  }
  folder.addEventListener('input', () => update(true));
  editor.addEventListener('change', () => update(true));
  document.getElementById('copy-path').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(output.value);
      status.textContent = 'パスをコピーしました。編集ソフトの「ファイルを開く」に貼り付けてください。';
    } catch {
      output.focus();
      output.select();
      status.textContent = 'パスを選択しました。Ctrl+C（Macは⌘C）でコピーしてください。';
    }
  });
  update(false);
})();
