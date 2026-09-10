(() => {
  'use strict';

  const chapters = [...document.querySelectorAll('[data-chapter]')];
  const navLinks = [...document.querySelectorAll('[data-nav]')];
  const flowButtons = [...document.querySelectorAll('[data-flow]')];
  const flowResult = document.querySelector('[data-flow-result]');
  const dialog = document.querySelector('[data-image-dialog]');
  const dialogImage = document.querySelector('[data-dialog-image]');
  const dialogCaption = document.querySelector('[data-dialog-caption]');

  const featureSummary = {
    base_management: '企業から金額データまでの関係を横断確認し、編集する正本画面へ案内します。',
    companies: '請求先となる企業情報を登録し、基本案件・個別案件・請求へ渡します。',
    partners: '委託先情報を登録し、個別案件・日報・先払い・支払へ渡します。',
    base_projects: '繰り返し使う業務のひな形を作り、個別案件へ独立コピーします。',
    projects: '実際の契約、担当、期間を確定し、日報の入力単位を作ります。',
    price_sets: '期間別の請求単価と支払単価を管理し、日報計算へ渡します。',
    office_work: '日報・請求・支払の進捗を横断し、止まっている工程へ移動します。',
    daily_reports: '勤務実績を入力・承認し、請求と支払の確定根拠を作ります。',
    daily_report_submissions: '紙・FAX・メール等の日報原本が届いた事実を管理します。',
    advances: '月途中の前払いを3サイクルで管理し、支払と入出金へ反映します。',
    invoices: '承認済み日報から企業向け売上を確定し、請求帳票と入金予定を作ります。',
    payments: '承認済み日報からパートナー向け支払を確定し、控除と出金予定を作ります。',
    cash_management: '銀行で動かす入出金予定、CSV出力、実績を分けて管理します。',
    analytics: '請求・支払の結果を集計し、利益率や稼働状況を確認します。',
    master_settings: '祝日、銀行、区分など会社共通の業務値を管理します。',
    help_settings: '各画面に表示する短いヘルプ文を管理します。',
    ui_builder: '一覧の表示列と順序を会社共通で整えます。',
    users: 'ログインする利用者、所属、権限、有効状態を管理します。',
  };

  function currentChapter() {
    const hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    return chapters.find((chapter) => chapter.id === hash) || chapters[0];
  }

  function markCurrent() {
    const current = currentChapter();
    chapters.forEach((chapter) => chapter.classList.toggle('is-current', chapter === current));
    navLinks.forEach((link) => {
      const active = link.dataset.nav === current.id;
      link.classList.toggle('is-active', active);
      if (active) link.setAttribute('aria-current', 'page');
      else link.removeAttribute('aria-current');
    });
  }

  function selectFlow(button) {
    const selected = button.dataset.flow;
    const related = new Set((button.dataset.links || '').split(',').filter(Boolean));
    flowButtons.forEach((candidate) => {
      const key = candidate.dataset.flow;
      candidate.classList.toggle('is-selected', key === selected);
      candidate.classList.toggle('is-related', related.has(key));
      candidate.classList.toggle('is-dimmed', key !== selected && !related.has(key));
    });
    if (flowResult) {
      const names = flowButtons.filter((candidate) => related.has(candidate.dataset.flow)).map((candidate) => candidate.textContent.trim());
      flowResult.innerHTML = `<strong>${button.textContent.trim()}</strong>：${featureSummary[selected] || ''}<br><span>関連する機能：${names.join('、') || 'なし'}</span>`;
    }
  }

  function clearFlow() {
    flowButtons.forEach((button) => button.classList.remove('is-selected', 'is-related', 'is-dimmed'));
    if (flowResult) flowResult.textContent = '機能を選択すると、ここに役割と前後関係が表示されます。';
  }

  function preparePrint(scope) {
    document.body.dataset.printScope = scope;
    chapters.forEach((chapter) => chapter.classList.toggle('print-target', scope === 'chapter' && chapter === currentChapter()));
    window.print();
  }

  function openImage(source, caption) {
    if (!dialog || !dialogImage) return;
    dialogImage.src = source;
    if (dialogCaption) dialogCaption.textContent = caption || '';
    dialog.showModal();
  }

  flowButtons.forEach((button) => button.addEventListener('click', () => selectFlow(button)));
  document.querySelectorAll('[data-action="clear-flow"]').forEach((button) => button.addEventListener('click', clearFlow));
  document.querySelectorAll('[data-action="overview"]').forEach((button) => button.addEventListener('click', () => { location.hash = 'overview'; }));
  document.querySelectorAll('[data-action="print-chapter"]').forEach((button) => button.addEventListener('click', () => preparePrint('chapter')));
  document.querySelectorAll('[data-action="print-all"]').forEach((button) => button.addEventListener('click', () => preparePrint('all')));
  document.querySelectorAll('[data-action="close-image"]').forEach((button) => button.addEventListener('click', () => dialog?.close()));
  document.querySelectorAll('figure img').forEach((image) => {
    image.tabIndex = 0;
    image.setAttribute('role', 'button');
    image.setAttribute('aria-label', `${image.alt}を拡大`);
    const show = () => openImage(image.src, image.closest('figure')?.querySelector('figcaption')?.textContent);
    image.addEventListener('click', show);
    image.addEventListener('keydown', (event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); show(); } });
  });
  document.querySelectorAll('[data-zoom]').forEach((button) => button.addEventListener('click', () => openImage(button.dataset.zoom, button.querySelector('img')?.alt)));
  dialog?.addEventListener('click', (event) => { if (event.target === dialog) dialog.close(); });
  window.addEventListener('hashchange', markCurrent);
  window.addEventListener('afterprint', () => {
    delete document.body.dataset.printScope;
    chapters.forEach((chapter) => chapter.classList.remove('print-target'));
  });
  markCurrent();
})();
