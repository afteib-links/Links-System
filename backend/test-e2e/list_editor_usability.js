const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const baseUrl = process.env.UI_BASE_URL || 'http://127.0.0.1:8082';

async function main() {
  let capturedPricePayload = null;
  const browser = await chromium.launch({
    headless:true,
    ...(process.env.PLAYWRIGHT_CHANNEL ? { channel:process.env.PLAYWRIGHT_CHANNEL } : {}),
  });
  const page = await browser.newPage({ viewport:{ width:1440, height:900 } });
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const json = (body) => route.fulfill({ status:200, contentType:'application/json', body:JSON.stringify(body) });
    if (url.pathname === '/api/auth/me') return json({
      ok:true,
      user:{ user_id:1, display_name:'テスト管理者', roles:['admin'], permissions:['projects','base_projects','price_sets','invoices','daily_reports'] },
      features:[
        {key:'base_projects',label:'基本案件',group:'master'},
        {key:'projects',label:'個別案件',group:'master'},
        {key:'price_sets',label:'金額データ',group:'master'},
        {key:'invoices',label:'請求',group:'billing'},
        {key:'daily_reports',label:'日報',group:'daily'},
      ],
      roles:[{key:'admin',label:'管理者'}],
    });
    if (url.pathname === '/api/dashboard/summary') return json({ok:true,cards:[]});
    if (url.pathname === '/api/masters/codes') return json({ok:true,codes:[
      {category_code:'closing_date',code_value:'20',code_label:'20日'},
      {category_code:'work_mode',code_value:'regular',code_label:'定期'},
      {category_code:'price_type',code_value:'basic',code_label:'基本'},
      {category_code:'price_calc_type',code_value:'daily',code_label:'日極'},
      {category_code:'price_calc_type',code_value:'hourly',code_label:'時間'},
      {category_code:'price_calc_type',code_value:'distance',code_label:'距離'},
      {category_code:'price_calc_type',code_value:'custom',code_label:'独自計算'},
    ]});
    if (url.pathname === '/api/lookups/companies') return json({ok:true,companies:[{company_id:1,company_name:'東都運送'}]});
    if (url.pathname === '/api/lookups/partners') return json({ok:true,partners:[{partner_id:2,partner_name:'山田運輸'}]});
    if (url.pathname === '/api/lookups/base-projects') return json({ok:true,base_projects:[{base_project_id:3,company_id:1,template_name:'定期便'}]});
    if (url.pathname === '/api/projects/base') return json({ok:true,base_projects:[{
      base_project_id:3,company_id:1,company_name:'東都運送',template_name:'定期便',default_manager:'担当A',business_type:'配送',closing_date:'20',
    }]});
    if (url.pathname === '/api/projects/base/3') return json({ok:true,base_project:{
      base_project_id:3,version:1,company_id:1,template_name:'定期便',default_manager:'担当A',business_type:'配送',payment_type:'normal',closing_date:'20',price_sets:[],
      linked_projects:[{project_id:7,partner_id:2,partner_name:'山田運輸',manager_name:'担当A',business_type:'配送',payment_type:'normal',closing_date:'20',operation_start_date:'2026-09-01'}],
    }});
    if (url.pathname === '/api/lookups/vehicles') {
      const company = url.searchParams.get('owner_type') === 'company';
      return json({ok:true,vehicles:[company
        ? {vehicle_id:10,vehicle_name:'企業トラック',vehicle_number:'品川100あ1'}
        : {vehicle_id:20,vehicle_name:'持込トラック',vehicle_number:'練馬200い2'}]});
    }
    if (url.pathname === '/api/projects') return json({ok:true,projects:[{
      project_id:7,company_id:1,partner_id:2,company_name:'東都運送',partner_name:'山田運輸',
      base_template_name:'定期便',payment_type:'normal',closing_date:'20',
    }]});
    if (url.pathname === '/api/projects/7') return json({ok:true,project:{
      project_id:7,version:1,company_id:1,partner_id:2,base_project_id:3,
      company_name:'東都運送',partner_name:'山田運輸',base_template_name:'定期便',
      vehicle_owner_type:'company',vehicle_id:10,manager_name:'担当A',business_type:'配送',
      payment_type:'normal',closing_date:'20',price_sets:[],revisions:[],
    }});
    if (url.pathname === '/api/price-sets/calculation-settings') return json({ok:true,settings:{}});
    if (url.pathname === '/api/price-sets' && route.request().method() === 'POST') {
      capturedPricePayload = route.request().postDataJSON();
      return json({ok:true,price_set:{price_set_id:13}});
    }
    if (url.pathname === '/api/price-sets') return json({ok:true,price_sets:[{
      price_set_id:12,price_set_no:'PS-TEST-012',price_set_name:'標準料金',company_id:1,company_name:'東都運送',base_project_id:3,base_template_name:'定期便',apply_start_date:'2026-09-01',line_count:2,
    }]});
    if (url.pathname === '/api/invoices/targets') return json({ok:true,targets:[{
      project_id:7,project_name:'定期便',company_id:1,company_name:'東都運送',billing_summary_no:'A',
      closing_date:'20',subtotal_amount:110000,target_status:'available',report_ids:[11],
    }]});
    if (url.pathname === '/api/invoices') return json({ok:true,invoices:[{
      invoice_id:5,company_id:1,company_name:'東都運送',billing_print_name:'東都運送',
      closing_date:'20',total_amount:120000,settlement_status:'finalized',
    }]});
    if (url.pathname === '/api/settlements/invoice/5') return json({ok:true,
      settlement:{invoice_id:5,company_id:1,billing_print_name:'東都運送',target_year_month:'2026-09',subtotal_amount:110000,tax_amount:10000,total_amount:120000},
      workflow:{status:'finalized'},lines:[],documents:[],
    });
    if (url.pathname === '/api/daily-report-imports/fields') return json({ok:true,fields:[]});
    if (url.pathname === '/api/daily-report-imports/mappings') return json({ok:true,mappings:[]});
    if (url.pathname === '/api/daily-report-imports') return json({ok:true,batches:[{
      daily_report_import_batch_id:9,original_filename:'日報.xlsx',target_year_month:'2026-09',
      status:'parsed',row_count:3,applied_count:0,created_by_name:'取込担当',
    }]});
    if (url.pathname === '/api/daily-report-imports/9') return json({ok:true,batch:{
      daily_report_import_batch_id:9,target_year_month:'2026-09',status:'parsed',row_count:3,
      valid_count:3,warning_count:0,error_count:0,applied_count:0,
    },files:[{daily_report_import_file_id:1,original_filename:'日報.xlsx'}],rows:[]});
    if (url.pathname === '/api/daily-reports/month-projects') return json({ok:true,summary:{project_count:6,workflow_groups:{not_started:1,working:2,waiting:1,complete:1,attention:1}},rows:[]});
    return json({ok:true});
  });

  try {
    await page.goto(baseUrl, { waitUntil:'networkidle' });
    await page.locator('[data-nav-feature="projects"]').click();
    await page.locator('#projects-table').waitFor();
    assert.equal(await page.getByText(/機能一覧へ/).count(), 0, '機能一覧へのボタンを表示しないこと');
    assert.equal(await page.locator('#projects-table thead tr').count(), 2);
    assert.equal(await page.locator('#projects-table th').filter({hasText:'締日'}).count() > 0, true);
    assert.equal(await page.locator('[data-copy-project="7"]').count(), 1, '個別案件一覧にコピーがあること');
    const row = page.locator('#projects-table tbody tr[data-row-key="7"]');
    await row.click();
    assert.equal(await row.getAttribute('aria-selected'), 'true');
    await row.dblclick();
    await page.locator('#project-form').waitFor();
    assert.equal(await page.locator('#back-history').count(), 1, '詳細画面の戻る導線は維持すること');
    assert.ok(await page.locator('#project-form .form-section-card').count() >= 4);
    assert.equal(await page.locator('[name="vehicle_id"]').inputValue(), '10');
    await page.locator('#vehicle-owner-type').selectOption('partner');
    await page.waitForFunction(() => document.querySelector('#project-vehicle .search-select-option')?.dataset.value === '20');
    await page.locator('#project-vehicle .search-select-input').fill('持込');
    await page.locator('#project-vehicle .search-select-option[data-value="20"]').click();
    assert.equal(await page.locator('[name="vehicle_id"]').inputValue(), '20');

    await page.locator('[data-nav-feature="base_projects"]').click();
    await page.locator('[data-copy-base="3"]').waitFor();
    assert.equal(await page.locator('[data-copy-base="3"]').count(), 1, '基本案件一覧にコピーがあること');
    await page.locator('[data-edit-base="3"]').click();
    const linked = page.locator('.linked-projects-section');
    await linked.waitFor();
    assert.equal(await linked.locator('[data-open-linked-project="7"]').count(), 1, '基本案件直下に紐づく個別案件の編集導線を表示すること');
    assert.equal(await linked.locator('.btn-danger').count(), 0, '埋め込み個別案件一覧に削除操作を置かないこと');
    const sectionOrder = await page.locator('.linked-projects-section, h3.section-title').allTextContents();
    assert.ok(sectionOrder.join('|').indexOf('紐づく個別案件') < sectionOrder.join('|').indexOf('金額データ'), '個別案件一覧を金額データ一覧より上に表示すること');

    await page.locator('[data-nav-feature="price_sets"]').click();
    await page.locator('.table-action-row').waitFor();
    assert.equal(await page.locator('.table-action-row').evaluate((element) => getComputedStyle(element).flexWrap), 'nowrap', '編集・コピー・削除を横並びにすること');
    await page.locator('#new').click();
    await page.locator('#add-fee-item').click();
    const addForm = page.locator('#add-fee-item-form');
    await addForm.waitFor();
    await addForm.locator('[name="name"]').fill('距離・独自料金');
    await addForm.locator('[value="daily"]').uncheck();
    await addForm.locator('[value="hourly"]').uncheck();
    await addForm.locator('[value="distance"]').check();
    await addForm.locator('[value="custom"]').check();
    await page.locator('#confirm-add-fee-item').click();
    const addedCard = page.locator('[data-fee-item]').last();
    await addedCard.getByText('計算未対応').first().waitFor();
    assert.equal(await addedCard.locator('[data-calc="distance"]').count(), 1, '距離計算行を新規追加できること');
    assert.equal(await addedCard.locator('[data-calc="custom"]').count(), 1, 'マスター追加計算種別を新規追加できること');
    await addedCard.locator('[data-calc="distance"] [data-f="billing"]').fill('25');
    await addedCard.locator('[data-calc="custom"] [data-f="billing"]').fill('300');
    await page.locator('#ps-form [name="price_set_name"]').fill('新規料金');
    await page.locator('#ps-form [name="apply_start_date"]').fill('2026-09-01');
    await page.locator('#ps-form button[type="submit"]').click();
    await page.locator('.table-action-row').waitFor();
    const addedExtra = capturedPricePayload.extra_data.fee_items.find((item) => item.name === '距離・独自料金');
    assert.deepEqual(addedExtra.calc_types, ['distance','custom'], '選択計算種別をextra_dataへ保持すること');
    assert.ok(capturedPricePayload.lines.some((line) => line.calc_type_code === 'distance' && line.weekday_code === 'all'), '距離行を全日として保存すること');
    assert.equal(capturedPricePayload.lines.filter((line) => line.calc_type_code === 'custom').length, 5, '距離以外の追加種別を選択曜日ごとに保存すること');

    await page.locator('[data-nav-feature="invoices"]').click();
    await page.locator('table.data-table').last().waitFor();
    assert.equal(await page.locator('[data-single="7"]').count(),1,'単独案件は請求可能ボタンから作成できること');
    assert.equal(await page.locator('table.data-table').last().locator('thead tr').count(), 2, '画面固有一覧にもヘッダーフィルターを追加すること');
    const invoiceRow = page.locator('[data-open="5"]').locator('xpath=ancestor::tr');
    await invoiceRow.click();
    assert.equal(await invoiceRow.getAttribute('aria-selected'), 'true');
    await invoiceRow.dblclick();
    await page.getByRole('heading', {name:'請求書 #5'}).waitFor();
    assert.equal(await page.locator('a[href="/api/settlements/invoice/5/preview"]').count(),1,'下書き前後で見本帳票を確認できること');
    assert.equal(await page.locator('#cancel').count(),1,'精算詳細に取消導線があること');

    await page.locator('[data-nav-feature="daily_reports"]').click();
    const topbar = await page.locator('.daily-list-topbar').evaluate((element) => {
      const month = element.querySelector('.month-navigator').getBoundingClientRect();
      const button = element.querySelector('#open-daily-import').getBoundingClientRect();
      return { monthCenter:month.top + month.height / 2, importCenter:button.top + button.height / 2, monthLeft:month.left, importLeft:button.left };
    });
    assert.ok(Math.abs(topbar.monthCenter - topbar.importCenter) < 8 && topbar.importLeft > topbar.monthLeft, '月選択とデータ取り込みを同じ行の左右に配置すること');
    const filteredRequest = page.waitForRequest((request) => request.url().includes('/api/daily-reports/month-projects') && request.url().includes('workflow_statuses=inputting%2Cready'));
    await page.getByRole('button', {name:/作業中/}).click();
    await filteredRequest;
    assert.equal(await page.getByRole('button', {name:/作業中/}).getAttribute('aria-pressed'), 'true', '選択中カードを視覚・属性で示すこと');
    await page.locator('#open-daily-import').click();
    const importTable = page.locator('table.data-table').last();
    await importTable.locator('.dt-filter-row').waitFor();
    const importRow = page.locator('[data-open-import="9"]').locator('xpath=ancestor::tr');
    await importRow.dblclick();
    await page.getByRole('heading', {name:'取込確認 #9'}).waitFor();
  } finally {
    await browser.close();
  }
  console.log('[list-editor-usability] 一覧操作・基本案件連携・料金項目追加・日報カードを確認しました');
}

main().catch((error) => { console.error(error); process.exit(1); });
