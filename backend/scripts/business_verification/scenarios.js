// All names and banking details are fictional. This module does not connect to a DB.
const VERSION = 'business-verification-v1';
const DEFAULT_AS_OF = '2026-09-07';
const START = '2025-11-01';
const number = (prefix, index) => `${prefix}${String(index + 1).padStart(5, '0')}`;
const json = JSON.stringify;
const addDays = (date, days) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const lastDay = (ym) => new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5, 7), 0)).toISOString().slice(0, 10);
const months = (asOf) => {
  const result = [];
  for (let ym = START.slice(0, 7); ym <= asOf.slice(0, 7);) {
    result.push(ym);
    ym = addDays(lastDay(ym), 1).slice(0, 7);
  }
  return result;
};
const HOLIDAYS = {
  '2025-11-03':'文化の日','2025-11-23':'勤労感謝の日','2025-11-24':'振替休日',
  '2026-01-01':'元日','2026-01-12':'成人の日','2026-02-11':'建国記念の日','2026-02-23':'天皇誕生日',
  '2026-03-20':'春分の日','2026-04-29':'昭和の日','2026-05-03':'憲法記念日','2026-05-04':'みどりの日',
  '2026-05-05':'こどもの日','2026-05-06':'振替休日','2026-07-20':'海の日','2026-08-11':'山の日',
  '2026-09-21':'敬老の日','2026-09-22':'国民の休日','2026-09-23':'秋分の日',
};
const AREAS = ['東都','青葉','みなと','北辰','武蔵野','彩都','京浜','多摩','城南','湘南','阪神','なにわ','淀川','六甲','泉州','相模','常総','上総','東葛','北摂'];
const SECTORS = [
  {count:25, label:'食品', names:['食品','青果','水産','食肉加工','食材卸'], jobs:['企業車両による食品（米・油・調味料等）の配送業務','企業車両による青果物の配送業務','企業車両による鮮魚・水産加工物の配送業務','企業冷凍車両による食肉の配送業務','企業車両による食肉加工品の配送業務'], driving:true, start:5},
  {count:20, label:'建材・製造', names:['建材','金属工業','照明機器','住設資材','ステンレス製作所'], jobs:['企業車両によるステンレス製品等の配送業務','企業車両による照明器具の配送業務','建築資材の配送及び現場搬入補助業務'], driving:true,start:8},
  {count:20, label:'調査・分析・点検', names:['環境分析','地質調査','道路技術','設備調査','測定サービス'], jobs:['鉄道沿線近接樹木調査における助手業務及び付帯業務','道路施設点検助手','都内23区内のJKK及び都営住宅のPCB事前調査業務','分析会社での事務作業と仕分け及び付帯業務','ボーリング調査の準備、ロットの付け替え、洗浄その他補助業務','橋梁点検調査補助業務','金属探知機を使用しての調査補助および付帯作業','空気・採水・土壌等の試料採取及び測定業務'],driving:false,start:8},
  {count:20,label:'物流・倉庫',names:['流通','倉庫','運輸','ロジスティクス','配送サービス'],jobs:['フォークリフトを用いた入出荷、倉庫内作業、その他付随する業務','倉庫内商品検品、棚卸し及び付帯業務','企業車両による消耗品（モップ・マット等）の配送業務'],driving:true,start:8},
  {count:15,label:'IT・設備・その他',names:['情報サービス','設備保守','セレモニー','事務支援','イベント企画'],jobs:['パソコンサポート及びトラブル・アフターサポート業務','商業施設設備点検における作業補助業務','企業車両による葬儀用装飾品の配送業務','事務所内の資料整理及び付帯業務','展示会・イベント用品の搬入搬出及び付帯業務'],driving:false,start:9},
];
const SURNAMES = ['山田','佐藤','鈴木','高橋','田中','伊藤','渡辺','山本','中村','小林','加藤','吉田','山口','松本','井上','木村','林','清水','斎藤','阿部','森','池田','橋本','山下','石川','中島','前田','藤田','後藤','岡田','長谷川','村上','近藤','石井','坂本','遠藤','青木','藤井','西村','福田','太田','三浦','藤原','岡本','松田','中川','原田','小野','竹内','田村'];
const GIVEN = ['拓也','美咲','翔太','直樹','雅人','陽子','優太','亮介','大輔','真由美','智也','修平','裕介','誠','恵','達也','浩二','圭一','拓真','隆','隼人','悠人','章','孝之','俊介','明','祐樹','英樹','淳','大樹','結衣','健太','彩香','和也','沙織','直美','裕子','仁','聡','由佳'];
const EXCEPTIONS = [
  {project:70,month:'2025-11',state:'unsubmitted',reason:'月末分の日報確認が未完了'},
  {project:71,month:'2026-01',state:'rejected',reason:'勤務時間の確認依頼で差戻し'},
  {project:72,month:'2026-03',state:'submitted',reason:'営業担当の承認待ち'},
  {project:73,month:'2026-05',state:'payment_held',reason:'支払内容の照会により振込保留'},
  {project:74,month:'2026-06',state:'invoice_draft',reason:'請求調整の確認待ち'},
  {project:75,month:'2026-07',state:'payment_draft',reason:'支払明細の追加内容を確認中'},
];
function catalog() {
  const companies=[];
  for (const sector of SECTORS) for (let k=0;k<sector.count;k++) {
    const i=companies.length, area=i%5===0?'関西':'関東', location=area==='関西'?['大阪','神戸','堺'][i%3]:['東京','横浜','さいたま','千葉','川崎'][i%5];
    const job=sector.jobs[k%sector.jobs.length];
    companies.push({index:i,no:number('C',i),name:`${k>=20?'新':''}${AREAS[k%AREAS.length]}${sector.names[k%sector.names.length]}株式会社`,sector:sector.label,job,location,area,driving:/配送/.test(job),start:/事務/.test(job)?9:sector.start});
  }
  const partners=Array.from({length:130},(_,i)=>({index:i,no:number('P',i),name:`${SURNAMES[i%50]} ${GIVEN[(i+Math.floor(i/50)*7)%40]}`,ended:i<10,endedOn:i<10?addDays(['2026-02-01','2026-04-16','2026-07-01'][i%3],-1):null,advance:i>=20&&i<50}));
  const staff=Array.from({length:15},(_,i)=>({no:number('S',i),name:`${SURNAMES[(i+30)%50]} ${GIVEN[(i+11)%40]}`,role:i<11?'営業':i<14?'事務':'その他',area:i>=8&&i<11?'関西':'関東'}));
  const projects=companies.map((c,i)=>({index:i,no:number('J',i),base:i,partner:i,start:START,end:i<10?partners[i].endedOn:i<20?addDays(['2025-12-01','2026-04-01','2026-06-16'][i%3],-1):null,change:null}));
  for(let i=0;i<20;i++) projects.push({index:100+i,no:number('J',100+i),base:i,partner:i<10?100+i:i,start:addDays(projects[i].end,1),end:null,predecessor:i,change:i<10?'担当者交代':'勤務条件改定'});
  return {companies,partners,staff,projects};
}
function matrix(bill,pay) {
  const c=(b,p)=>({billing:b,payment:p});
  return {daily:{basic:c(bill,pay)},hourly:{shortage:c(bill/8,pay/8),overtime:c(Math.round(bill/8*1.25),Math.round(pay/8*1.25)),night:c(Math.round(bill/8*.25),Math.round(pay/8*.25)),night_overtime:c(Math.round(bill/8*1.5),Math.round(pay/8*1.5))}};
}
function price(project, company, revision=false) {
  const i=project.index, bill=16000+(i%9)*800+(revision?1600:0),pay=bill-4000;
  const name=(label)=>`${label}（${company.name}：${company.job.replace(/企業.*?による/,'').slice(0,18)}）`;
  const item=(id,label,days,m=1)=>({id,name:name(label),mode:'weekdays',calc_types:['daily','hourly'],weekdays:Object.fromEntries(days.flatMap(d=>d==='weekday'?['mon','tue','wed','thu','fri']:[d]).map(d=>[d,true])),matrix:matrix(Math.round(bill*m/8)*8,Math.round(pay*m/8)*8)});
  const sat=i%10<5,trainingSat=i%10<4, holiday=i%10!==9;
  const items=[item('weekday','平日料金',['weekday'])];
  if(sat)items.push(item('sat','土曜料金',['sat'],1.1));
  if(holiday)items.push(item('holiday','休日料金',sat?['sun','holiday']:['sat','sun','holiday'],1.2));
  if(i%10<8){items.push(item('training-weekday','研修平日料金',['weekday'],.8));if(trainingSat)items.push(item('training-sat','研修土曜料金',['sat'],.85));items.push(item('training-holiday','研修日曜料金',trainingSat?['sun','holiday']:['sat','sun','holiday'],.9));}
  const distance=i%10!==9;
  if(distance)items.push({id:'distance',name:name('距離超過料金'),mode:'distance',calc_types:['distance'],matrix:{distance:{basic:{billing:80,payment:50}}}});
  const mode=['daily_excess','monthly_excess','tiered'][i%3];
  const rule=(side)=>({mode,base_distance:mode==='monthly_excess'?1800:100,unit_price:side==='billing'?80:50,tier_mode:'progressive',tiers:mode==='tiered'?[{upper_distance:100,unit_price:0},{upper_distance:180,unit_price:side==='billing'?80:50},{upper_distance:null,unit_price:side==='billing'?100:70}]:[],rounding:{amount_mode:'floor',amount_stage:mode==='monthly_excess'?'month':'day'}});
  return {seed_key:VERSION,fee_items:items,night_rules:{billing:{periods:[{start:'22:00',end:'29:00'}],night_mode:'separate',night_overtime_mode:'separate'},payment:{periods:[{start:i%12===0?'23:00':'22:00',end:'29:00'}],night_mode:'separate',night_overtime_mode:'separate'}},work_rules:{billing:{standard_minutes:480},payment:{standard_minutes:480}},rounding:{billing:{time_unit_minutes:[1,5,15][i%3],time_mode:'floor',amount_mode:'floor',amount_stage:'detail'},payment:{time_unit_minutes:15,time_mode:i%2?'round':'floor',amount_mode:'floor',amount_stage:'detail'}},distance_rules:distance?{billing:rule('billing'),payment:rule('payment')}:{}};
}
function input(project,company,date,seed=93) {
  const day=+date.slice(8),dow=new Date(`${date}T12:00:00Z`).getUTCDay(),r=(day*17+project.index*13+seed)%100;
  const off=date<project.start || (project.end&&date>project.end) || (project.index===49&&date>='2026-08-01'&&date<='2026-08-10') || ((dow===0||dow===6||HOLIDAYS[date]) && !(project.index%10!==9&&day%3===0));
  const absent=!off&&r===12;
  const training=!off&&!absent&&project.index%10<8&&(date<=addDays(project.start,5)||r===21);
  let start=company.start*60+(project.change==='勤務条件改定'?60:0),end=start+540,scenario=off?'不要':absent?'欠勤':training?'研修':'通常';
  if(!off&&!absent&&!training){if(r<10){end+=90;scenario='残業';}else if(r<15){end-=120;scenario='早退';}else if(r<20&&/点検|調査|配送/.test(company.job)){start=1200;end=1740;scenario='深夜';}}
  const time=(m)=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
  const data={work_date:date,target_year_month:date.slice(0,7),start_time:off||absent?null:time(start),end_time:off||absent?null:time(end),break_minutes:off||absent?0:60,is_absent:off||absent?1:0,is_training:training?1:0,total_distance:!off&&!absent&&company.driving?80+(r%17)*10:0,night_break_minutes_billing:!off&&!absent&&start===1200?30:0,night_break_minutes_payment:!off&&!absent&&start===1200?30:0,row_comment:`${scenario}｜${company.location}｜${company.job}`,input_source_type:'manual',memo:`検証 ${project.no} ${scenario}`};
  if(!off&&!absent&&r===35){data.rate_overrides={billing:{basic:24000},payment:{basic:19200}};data.rate_override_reason='臨時作業範囲の追加（当日限り）';}
  // Expense inputs are retained for input testing; this version of the application
  // does not automatically settle them. Do not invent contractual expense rules.
  if(!off&&!absent&&r===40){data.toll_fee=company.driving?1200:0;data.parking_fee=company.driving?600:0;data.transport_fee=company.driving?0:880;data.memo+=' 経費入力検証（現行の自動精算対象外）';}
  return {data,scenario};
}
function intentionallyMissing(p,date){return (p.index===70&&date==='2025-11-30')||(p.index>=60&&p.index<65&&date==='2026-08-31')||(p.index>=90&&p.index<93&&date==='2026-09-07');}
function monthState(project,ym){const ex=EXCEPTIONS.find(e=>e.project===project.index&&e.month===ym);if(ex)return ex.state;if(ym<'2026-08')return 'complete';if(ym==='2026-08'){if(project.index>=60&&project.index<65)return 'unsubmitted';return ['complete','submitted','invoice_draft','payment_draft'][project.index%4];}return 'inputting';}
module.exports={VERSION,DEFAULT_AS_OF,START,number,json,addDays,lastDay,months,HOLIDAYS,EXCEPTIONS,catalog,price,input,monthState,intentionallyMissing};
