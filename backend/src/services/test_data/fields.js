// Canonical import fields: Japanese labels belong to the field, not the sheet.
const field = (key, label, aliases = [], note = '') => ({ key, label, aliases: [key, label, ...aliases], note });
const common = [field('name', '名称', ['名前','氏名']), field('companyCode','企業番号（関連先）',['企業コード']),
  field('partnerCode','パートナー番号（関連先）',['パートナーコード']), field('baseCode','基本案件番号（関連先）',['基本案件コード'])];
const IMPORT_FIELDS = {
  companies: [
    field('managerName','担当',['営業担当','担当者','our_manager'],'元の値を保持します。営業担当マスターへの登録・紐付けは後続です。'),
    field('workMode','形態',['稼働形態','work_mode_code'],'元の値を保持します。稼働形態コードへの変換はまだ行いません。'),
    field('searchText','検索用',['検索名','検索キー'],'取込設定の補助情報として保持します。業務DBへの保存項目ではありません。'),
    field('code','企業番号',['企業No','企業コード','code','no','コード','番号','office_no']),
    field('name','企業名',['会社名','名称','名前','company_name']),
    field('nameKana','企業名カナ',['企業名フリガナ','会社名カナ','company_name_kana']),
    field('officeName','事業所名',['office_name']), field('postalCode','郵便番号',['zip_code']),
    field('address','住所',['所在地']), field('phone','電話番号',['電話','TEL','contact']), field('fax','FAX番号',['fax']),
    field('contractManager','契約担当者',['contract_manager']), field('businessContent','業務内容',['business_content']),
  ],
  partners: [field('managerName','担当',['営業担当','担当者']), field('closingDay','締日',['締め日']), field('workMode','形態',['稼働形態']),
    field('searchText','検索用',['検索名','検索キー']), field('code','パートナー番号',['パートナーコード','code','no','コード','番号']), field('name','氏名',['名前','名称','パートナー名']),
    field('companyCode','企業番号（関連先）',['企業コード']), field('companyName','稼働企業',['企業名','会社名']),
    field('paymentCategory','支払区分'), field('splitRate','分割単価'), field('nameKana','氏名カナ',['フリガナ','氏名フリガナ']),
    field('postalCode','郵便番号'), field('phone','電話番号',['電話','TEL']), field('address','住所'),
    field('bankName','振込口座',['銀行名']), field('bankBranch','振込支店',['支店名']), field('accountType','口座種類'),
    field('accountNumber','口座番号'), field('accountHolder','口座名義'), field('paymentDay','支払日'),
    field('contractPrice','契約単価'), field('outsourcingPrice','委託単価'), field('invoiceNumber','インボイス番号'),
    field('startDate','稼働開始日'), field('contractDate','基本契約日'), field('licenseExpiry','免許有効期限'),
    field('vehicleNumber','車両番号'), field('inspectionExpiry','車検有効期限'), field('insuranceExpiry','任意保険期限')],
  baseProjects: [field('code','基本案件番号',['基本案件コード','code','no','コード','番号']),field('name','基本案件名',['案件名','名称','名前']),common[1],field('managerName','担当',['営業担当'])],
  projects: [field('code','個別案件番号',['案件番号','案件コード','code','no','コード','番号']),field('name','個別案件名',['案件名','名称','名前']),...common.slice(1),field('managerName','担当',['営業担当'])],
  staff: [field('code','担当者番号',['社員番号','code','no','コード','番号']),field('name','担当者名',['氏名','名前','名称','営業担当']),field('area','エリア',['地域']),field('role','担当区分',['職種'])],
};
const normalizeHeader = s => String(s ?? '').normalize('NFKC').replace(/[\s_．.]/g,'').toLowerCase();
function suggest(headers, type) {
  const used = new Set();
  return headers.map((h,column) => {
    const matches = (IMPORT_FIELDS[type] || []).filter(f => f.aliases.some(a => normalizeHeader(a) === normalizeHeader(h)));
    const key = matches.length === 1 && !used.has(matches[0].key) ? matches[0].key : '';
    if (key) used.add(key);
    return {column,field:key,mode:'preserve'};
  });
}
module.exports = { IMPORT_FIELDS, suggest };
