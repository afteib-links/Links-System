const test=require('node:test');
const assert=require('node:assert/strict');
const {refreshRoleMatrix,featuresFromRoles,FEATURE_KEYS}=require('../src/permissions');
const {buildDbExport,previewDbExport,commitDbExport}=require('../src/services/master_data_db_export');
const {parseCompletedWorkbook}=require('../src/services/master_data_workbook');
const {previewFoundationRestore,commitFoundationRestore}=require('../src/services/foundation_master_restore');

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
