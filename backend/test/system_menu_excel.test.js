const test=require('node:test');
const assert=require('node:assert/strict');
const {refreshRoleMatrix,featuresFromRoles,FEATURE_KEYS}=require('../src/permissions');
const {buildDbExport,previewDbExport,commitDbExport}=require('../src/services/master_data_db_export');
const {parseCompletedWorkbook}=require('../src/services/master_data_workbook');
const {previewFoundationRestore,commitFoundationRestore}=require('../src/services/foundation_master_restore');
const {loadCatalog}=require('../src/services/foundation_masters');
const express=require('express');
const {allocateOfficeNo}=require('../src/services/master_data_import');

test('役割別チェックは管理者の許可にも反映し、既定では管理者とシステム担当者に専用機能を出す',async()=>{
  await refreshRoleMatrix(async()=>[]);
  assert.equal(featuresFromRoles(['system']).includes('test_data'),true);
  assert.equal(featuresFromRoles(['soumu']).includes('db_import'),false);
  await refreshRoleMatrix(async()=>[{feature_key:'analytics',role_key:'admin',is_allowed:0},{feature_key:'db_export',role_key:'sales',is_allowed:1}]);
  assert.equal(featuresFromRoles(['admin']).includes('analytics'),false);
  assert.equal(featuresFromRoles(['sales']).includes('db_export'),true);
  assert.equal(FEATURE_KEYS.includes('menu_access_settings'),true);
  await refreshRoleMatrix(async()=>[]);
});

test('DB出力は手入力レコードを編集用Excelで返し、変更行だけ更新する',async()=>{
  const company={company_id:11,company_name:'初期企業',office_no:'00011',version:3,is_deleted:0};
  const snapshots=[]; const updates=[];
  const conn={async query(sql,params=[]){
    if(sql.startsWith('SELECT price_series_id'))return [[]];
    if(sql.startsWith('SELECT * FROM companies WHERE is_deleted'))return [[company]];
    if(sql.startsWith('SELECT * FROM')&&sql.includes('WHERE is_deleted=0 ORDER BY'))return [[]];
    if(sql.startsWith('INSERT INTO master_data_db_export_rows')){snapshots.push({export_key:params[0],batch_key:params[1],entity_type:params[2],record_id:params[3],record_version:params[4]});return [{affectedRows:1}];}
    if(sql.startsWith('SELECT export_key'))return [snapshots];
    if(sql.startsWith('SELECT transfer_fee_pattern_id'))return [[]];
    if(sql.startsWith('SELECT * FROM companies WHERE company_id='))return [[company]];
    if(sql.startsWith('UPDATE companies')){updates.push({sql,params});return [{affectedRows:1}];}
    throw new Error(`unexpected SQL: ${sql}`);
  }};
  const exported=await buildDbExport(conn,1);
  assert.equal(exported.summary['企業'],1);
  const parsed=await parseCompletedWorkbook(exported.buffer);
  assert.equal(parsed['企業'][0].company_name,'初期企業');
  assert.match(parsed['企業'][0].import_key,/^dbx:[0-9a-f]{32}:[0-9a-f]{16}$/);
  assert.equal(Object.keys(parsed['企業'][0]).some(key=>['company_id','version','extra_data'].includes(key)),false);
  parsed['企業'][0].company_name='修正企業';
  parsed['企業'][0].office_no='改ざん';
  const preview=await previewDbExport(conn,parsed);
  assert.equal(preview.counts.update,1);
  const result=await commitDbExport(conn,preview);
  assert.equal(result.updated,1);
  assert.equal(updates.length,1);
  assert.equal(updates[0].params.includes('修正企業'),true);
  assert.equal(updates[0].params.includes('改ざん'),false);
  company.version=4;
  const conflicted=await previewDbExport(conn,parsed);
  assert.equal(conflicted.counts.conflict,1);
});

test('車両IDが重複しても個別案件の所有元で参照キーを決める',async()=>{
  const rows={
    companies:[{company_id:1,company_name:'企業A',version:1}],
    company_vehicles:[{vehicle_id:5,company_id:1,vehicle_number:'会社車両',version:1}],
    partners:[{partner_id:2,partner_name:'パートナーB',version:1}],
    partner_vehicles:[{vehicle_id:5,partner_id:2,vehicle_number:'委託車両',version:1}],
    projects:[{project_id:3,company_id:1,partner_id:2,vehicle_id:5,vehicle_owner_type:'partner',version:1}],
  };
  const conn={async query(sql){
    if(sql.startsWith('SELECT price_series_id'))return [[]];
    const match=/^SELECT \* FROM ([a-z_]+) WHERE is_deleted=0 ORDER BY/.exec(sql);
    if(match)return [rows[match[1]]||[]];
    if(sql.startsWith('INSERT INTO master_data_db_export_rows'))return [{affectedRows:1}];
    throw new Error(`unexpected SQL: ${sql}`);
  }};
  const exported=await buildDbExport(conn,1);
  const partnerKey=exported.data['パートナー車両'][0].import_key;
  assert.equal(exported.data['個別案件'][0].vehicle_import_key,partnerKey);
  assert.equal(exported.data['個別案件'][0].vehicle_owner_type,'partner');
});

test('DB出力Excelで車両の所有元を変えた場合は連動更新し、所有者違いは除外する',async()=>{
  const batch='a'.repeat(32);
  const key=(suffix)=>`dbx:${batch}:${suffix.repeat(16)}`;
  const snapshots=[
    ['project',3,'1'],['base_project',4,'2'],['company',1,'3'],['partner',2,'4'],
    ['company_vehicle',5,'5'],['partner_vehicle',5,'6'],['partner_vehicle',6,'7'],
  ].map(([entity_type,record_id,suffix])=>({export_key:key(suffix),entity_type,record_id,record_version:1}));
  const records={
    'projects:3':{project_id:3,base_project_id:4,company_id:1,partner_id:2,vehicle_id:5,vehicle_owner_type:'company',version:1},
    'base_projects:4':{base_project_id:4,company_id:1,version:1},
    'companies:1':{company_id:1,version:1},
    'partners:2':{partner_id:2,version:1},
    'company_vehicles:5':{vehicle_id:5,company_id:1,version:1},
    'partner_vehicles:5':{vehicle_id:5,partner_id:2,version:1},
    'partner_vehicles:6':{vehicle_id:6,partner_id:9,version:1},
  };
  const conn={async query(sql,params=[]){
    if(sql.startsWith('SELECT export_key'))return [snapshots];
    if(sql.startsWith('SELECT transfer_fee_pattern_id'))return [[]];
    const match=/^SELECT \* FROM ([a-z_]+) WHERE [a-z_]+\s*=\s*\? AND is_deleted=0 LIMIT 1/.exec(sql);
    if(match)return [records[`${match[1]}:${params[0]}`] ? [records[`${match[1]}:${params[0]}`]] : []];
    throw new Error(`unexpected SQL: ${sql}`);
  }};
  const row={import_key:key('1'),base_project_import_key:key('2'),company_import_key:key('3'),partner_import_key:key('4'),vehicle_import_key:key('6')};
  const parsed={'個別案件':[row]};
  const switched=await previewDbExport(conn,parsed);
  assert.equal(switched.counts.update,1);
  assert.equal(switched.rows[0].desired.vehicle_owner_type,'partner');
  assert.equal(switched.rows[0].desired.vehicle_id,5);
  row.vehicle_import_key=key('7');
  const invalid=await previewDbExport(conn,parsed);
  assert.equal(invalid.counts.dependency_error,1);
  assert.match(invalid.rows[0].errors.join(' '),/所有元/);
});

test('基盤初期値は選択した差分だけ登録する',async()=>{
  const inserted=[];
  const conn={async query(sql,params=[]){
    if(sql.startsWith('SELECT'))return [[]];
    if(sql.startsWith('INSERT')){inserted.push({sql,params});return [{insertId:1}];}
    throw new Error(`unexpected SQL: ${sql}`);
  }};
  const preview=await previewFoundationRestore(conn);
  assert.ok(preview.counts.new>0);
  const first=preview.rows.find(row=>row.status==='new');
  const result=await commitFoundationRestore(conn,preview,[`${first.sheet}:${first.key}`]);
  assert.equal(result.created,1);
  assert.equal(inserted.length,1);
});

test('採番の復旧は次番号を巻き戻さず、欠落ルールは自動復旧しない',async()=>{
  const source=(await loadCatalog())['採番'][0];
  const live={...source,numbering_rule_id:7,next_number:900,rule_label:'変更済み',version:2,is_deleted:0};
  const updates=[];
  const conn={async query(sql,params=[]){
    if(sql.startsWith('SELECT * FROM numbering_rules'))return [[live]];
    if(sql.startsWith('SELECT'))return [[]];
    if(sql.startsWith('UPDATE numbering_rules')){updates.push({sql,params});return [{affectedRows:1}];}
    throw new Error(`unexpected SQL: ${sql}`);
  }};
  const preview=await previewFoundationRestore(conn);
  const number=preview.rows.find((row)=>row.sheet==='採番'&&row.key===source.rule_key);
  assert.equal(number.status,'update');
  assert.equal(number.diff.includes('next_number'),false);
  await commitFoundationRestore(conn,preview,[`採番:${source.rule_key}`]);
  assert.equal(updates.length,1);
  assert.equal(updates[0].sql.includes('next_number'),false);
  assert.equal(updates[0].params.includes(900),false);
  const missing={async query(sql){if(sql.startsWith('SELECT'))return [[]];throw new Error(`unexpected SQL: ${sql}`);}};
  const missingPreview=await previewFoundationRestore(missing);
  assert.equal(missingPreview.rows.find((row)=>row.sheet==='採番'&&row.key===source.rule_key).status,'conflict');
});

test('古い採番カウンターでも使用済み企業Noを飛ばして発行する',async()=>{
  const issued=[];
  const conn={async query(sql,params=[]){
    if(sql.startsWith('SELECT * FROM numbering_rules'))return [[{numbering_rule_id:1,prefix:'C',pad_digits:3,next_number:1,is_active:1}]];
    if(sql.startsWith('SELECT company_id AS id'))return [Number(params[0].slice(1))<=2?[{id:1}]:[]];
    if(sql.startsWith('UPDATE numbering_rules')){issued.push(params);return [{affectedRows:1}];}
    throw new Error(`unexpected SQL: ${sql}`);
  }};
  assert.equal(await allocateOfficeNo(conn),'C003');
  assert.deepEqual(issued,[[4,1]]);
});

test('メニュー権限を外した管理者は請求・支払・設定APIを直接呼べない',async()=>{
  const app=express();
  app.locals.rolePolicyQuery=async()=>[
    {feature_key:'invoices',role_key:'admin',is_allowed:0},
    {feature_key:'payments',role_key:'admin',is_allowed:0},
    {feature_key:'master_settings',role_key:'admin',is_allowed:0},
  ];
  app.use((req,_res,next)=>{req.session={user:{user_id:1,roles:['admin'],is_active:true}};next();});
  app.use('/api/settlements',require('../src/routes/settlements'));
  app.use('/api/master-settings/bank-export',require('../src/routes/bank_export_masters').router);
  const server=app.listen(0);
  try{
    for(const path of ['/api/settlements/invoice/1','/api/settlements/payment/1','/api/settlements/settings/deduction-rules','/api/settlements/documents','/api/master-settings/bank-export/catalog']){
      const response=await fetch(`http://127.0.0.1:${server.address().port}${path}`);
      assert.equal(response.status,403,path);
    }
  }finally{await new Promise((resolve)=>server.close(resolve));await refreshRoleMatrix(async()=>[]);}
});

test('過去料金改定版と料金行はExcelで閲覧できるが更新できない',async()=>{
  const batch='b'.repeat(32);const key=(suffix)=>`dbx:${batch}:${suffix.repeat(16)}`;
  const snapshots=[
    {export_key:key('1'),entity_type:'price_set',record_id:10,record_version:2},
    {export_key:key('2'),entity_type:'price_line',record_id:20,record_version:2},
    {export_key:key('3'),entity_type:'company',record_id:1,record_version:1},
  ];
  const set={price_set_id:10,company_id:1,price_set_name:'旧料金',is_current_revision:0,version:2};
  const line={price_set_line_id:20,price_set_id:10,weekday_code:'all',calc_type_code:'daily',price_type_code:'basic',billing_unit_price:100,payment_unit_price:50,version:2};
  const conn={async query(sql,params=[]){
    if(sql.startsWith('SELECT export_key'))return [snapshots];
    if(sql.startsWith('SELECT transfer_fee_pattern_id'))return [[]];
    if(sql.startsWith('SELECT is_current_revision FROM price_sets'))return [[{is_current_revision:set.is_current_revision}]];
    if(sql.startsWith('SELECT * FROM price_sets'))return [[set]];
    if(sql.startsWith('SELECT * FROM price_set_lines'))return [[line]];
    if(sql.startsWith('SELECT * FROM companies'))return [[{company_id:1,version:1}]];
    throw new Error(`unexpected SQL: ${sql}`);
  }};
  const parsed={
    '料金セット':[{import_key:key('1'),company_import_key:key('3'),note:'修正料金の備考'}],
    '料金行':[{import_key:key('2'),price_set_import_key:key('1'),weekday_code:'all',calc_type_code:'daily',price_type_code:'basic',billing_unit_price:200,payment_unit_price:50}],
  };
  const preview=await previewDbExport(conn,parsed);
  assert.equal(preview.counts.conflict,2);
  assert.equal(preview.counts.dependency_error,0);
  assert.equal(preview.counts.update,0);
  assert.match(preview.rows[0].errors.join(' '),/過去の料金改定版/);
  const lineOnly=await previewDbExport(conn,{'料金行':[parsed['料金行'][0]]});
  assert.equal(lineOnly.counts.conflict,1);
  assert.match(lineOnly.rows[0].errors.join(' '),/過去の料金改定版/);
  const forced={rows:[{sheet:'料金行',status:'update',recordId:20,recordVersion:2,current:line,desired:{billing_unit_price:200}}],counts:{unchanged:0}};
  await assert.rejects(commitDbExport(conn,forced),{code:'version_conflict'});
  const forcedSet={rows:[{sheet:'料金セット',status:'update',recordId:10,recordVersion:2,current:set,desired:{note:'不正な直接変更'}}],counts:{unchanged:0}};
  await assert.rejects(commitDbExport(conn,forcedSet),{code:'version_conflict'});
});
