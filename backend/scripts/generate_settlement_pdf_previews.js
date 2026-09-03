const { writePdf } = require('../src/services/settlement_pdf');

const issuer = {
  name:'【検証】リンクスシステム株式会社',
  zip_code:'000-0000',
  address:'東京都サンプル区テスト1-2-3',
  registration_number:'T0000000000000',
  tel:'00-0000-0000',
  fax:'00-0000-0001',
  bank_accounts:[
    { bank_name:'検証銀行', branch_name:'本店', deposit_type:'普通', account_number:'0000000', account_name:'リンクスシステム（カ' },
  ],
};
const recipient = {
  name:'【検証】サンプル取引先株式会社',
  zip_code:'000-0001',
  address:'東京都テスト区匿名4-5-6',
  bank_name:'検証銀行',
  branch_name:'支店',
  deposit_type:'普通',
  account_number:'1111111',
  account_name:'ケンショウ タロウ',
};

function work(id, projectId, projectName, date, basic, overtime = 0) {
  const total = basic + overtime;
  const calculation = {
    fee_item:{ name:'基本料金' },
    billing:{ amounts:{ details:{
      basic:{ calc_type:'daily', minutes:480, rate:basic, amount:basic },
      overtime:{ calc_type:'hourly', minutes:overtime ? 60 : 0, rate:overtime, amount:overtime },
    } } },
    payment:{ amounts:{ details:{
      basic:{ calc_type:'daily', minutes:480, rate:basic, amount:basic },
      overtime:{ calc_type:'hourly', minutes:overtime ? 60 : 0, rate:overtime, amount:overtime },
    } } },
  };
  return {
    line_type:'work', project_id:projectId, daily_report_id:id, item_name:`稼働 ${date}`,
    quantity:1, unit_price:total, amount:total, tax_category:'taxable',
    snapshot_json:JSON.stringify({
      project_name:projectName, work_date:date, work_hours:8 + (overtime ? 1 : 0),
      calculation_detail:JSON.stringify(calculation),
    }),
  };
}

const lines = [
  work(1, 1, '都内配送便', '2026-05-01', 20000),
  work(2, 1, '都内配送便', '2026-05-02', 20000, 2900),
  work(3, 2, '定期センター便', '2026-05-03', 18000),
  { line_type:'deduction', item_name:'事務手数料', quantity:1, unit_price:-1100, amount:-1100, tax_category:'taxable' },
  { line_type:'deduction', item_name:'安全協力会費', quantity:1, unit_price:-8800, amount:-8800, tax_category:'non_taxable' },
  { line_type:'advance', item_name:'前払金額', quantity:1, unit_price:-12000, amount:-12000, tax_category:'non_taxable' },
];
const wideUnitPriceLine = {
  line_type:'adjustment', item_name:'単価表示確認（負号付き7桁）',
  quantity:0.01, unit_price:-1234567, amount:-12346, tax_category:'non_taxable',
};

const base = {
  issued_date:'2026-06-01',
  due_date:'2026-06-30',
  payment_date:'2026-06-30',
  target_year_month:'2026-05',
  issuer,
  recipient,
  company_name:recipient.name,
  partner_name:recipient.name,
  tax_rate:0.1,
};

async function main() {
  const invoiceLines = [...lines.slice(0, 3), wideUnitPriceLine];
  await writePdf({ ...base, settlement_type:'invoice', document_type:'invoice', document_number:'PREVIEW-INVOICE', subtotal_amount:48554, tax_amount:4855, total_amount:53409 }, invoiceLines);
  await writePdf({ ...base, settlement_type:'invoice', document_type:'invoice_summary', document_number:'PREVIEW-INVOICE-SUMMARY', subtotal_amount:48554, tax_amount:4855, total_amount:53409 }, invoiceLines);
  await writePdf({ ...base, settlement_type:'payment', document_type:'payment_statement', document_number:'PREVIEW-PAYMENT', gross_amount:60900, total_amount:39000 }, [...lines, wideUnitPriceLine]);
  await writePdf({ ...base, settlement_type:'payment', document_type:'salary_statement', document_number:'PREVIEW-SALARY', gross_amount:60900, total_amount:39000 }, lines);
  await writePdf({
    ...base,
    document_type:'cover_letter',
    document_number:'PREVIEW-COVER',
    subject:'給与明細書送付',
    body:'拝啓　時下ますますご清栄のこととお喜び申し上げます。\n以下の書類を送付致します。ご査収のほど、宜しくお願い申し上げます。',
    enclosures:[{ name:'給与明細', copies:1 }],
  }, []);
  console.log('[pdf-preview] 5種類の匿名帳票を生成しました');
}

main().catch((error) => {
  console.error('[pdf-preview] failed:', error);
  process.exit(1);
});
