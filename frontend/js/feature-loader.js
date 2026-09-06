(() => {
  const version = '20260906r';
  const pending = new Map();
  const common = [['feature-kit', 'LinksFeatureKit'], ['data-table', 'LinksDataTable'], ['list_screens', 'LinksListScreens']];
  const modules = {
    companies: [['companies', 'LinksCompanies']],
    partners: [['partners', 'LinksPartners']],
    base_projects: [['projects', 'LinksProjects']],
    projects: [['projects', 'LinksProjects']],
    price_sets: [['price_set_fee_model', 'LinksPriceSetFeeModel'], ['price_sets', 'LinksPriceSets']],
    daily_reports: [['daily_report_imports', 'LinksDailyReportImports'], ['daily_reports', 'LinksDailyReports']],
    daily_report_submissions: [['daily_report_submissions', 'LinksDailyReportSubmissions']],
    advances: [['advances_matrix', 'LinksAdvances']],
    invoices: [['invoices', 'LinksInvoices']],
    payments: [['invoices', 'LinksInvoices'], ['payments', 'LinksPayments']],
    cash_management: [['cash_management', 'LinksCashManagement']],
    master_settings: [['bank_export_master', 'LinksBankExportMaster'], ['master_settings', 'LinksMasterSettings']],
    ui_builder: [['ui_builder', 'LinksUiBuilder']],
    users: [],
  };

  function load([file, exportName]) {
    if (window[exportName]) return Promise.resolve(window[exportName]);
    if (pending.has(file)) return pending.get(file);
    const promise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      let timer;
      const finish = (error) => {
        clearTimeout(timer);
        script.onload = script.onerror = null;
        if (error) {
          script.remove();
          reject(error);
        } else resolve(window[exportName]);
      };
      script.src = `/js/${file}.js?v=${version}`;
      script.onload = () => finish(window[exportName] ? null : new Error('画面の初期化に失敗しました。'));
      script.onerror = () => finish(new Error('画面ファイルを取得できませんでした。接続を確認して再試行してください。'));
      timer = setTimeout(() => finish(new Error('画面ファイルの読み込みがタイムアウトしました。再試行してください。')), 8000);
      document.head.appendChild(script);
    });
    pending.set(file, promise);
    promise.catch(() => pending.delete(file));
    return promise;
  }

  window.LinksFeatureLoader = {
    async openModule(key) {
      if (!Object.hasOwn(modules, key)) throw new Error('この機能は利用できません。');
      await Promise.all(common.map(load));
      let result;
      for (const entry of modules[key]) result = await load(entry);
      return result;
    },
  };
})();
