"""Build a reviewable, source-traceable, non-destructive DB change plan."""
from __future__ import annotations
import argparse
import csv
import hashlib
import json
import re
from collections import Counter, defaultdict
from copy import deepcopy
from datetime import date, timedelta
from pathlib import Path
from legacy_rate_recheck import load, dump, norm, sid, excluded, number, RATE_TYPES, DAYS

def extra(row):
    v=row.get('extra_data')
    return json.loads(v) if isinstance(v,str) and v else v or {}

def change_ids(db,evidence):
    tables=db['tables']; rejected={sid(x) for x in evidence['excluded_files']}
    companies={r['company_id'] for r in tables['companies'] if excluded(r['company_name'])}
    partners={r['partner_id'] for r in tables['partners'] if excluded(r['partner_name'])}
    projects={r['project_id'] for r in tables['projects'] if r['company_id'] in companies or r['partner_id'] in partners}
    sources=defaultdict(set)
    for r in tables['daily_reports']:
        s=extra(r).get('source_id')
        if s: sources[r['project_id']].add(s)
    projects.update(p for p,ss in sources.items() if ss and ss <= rejected)
    # A partner is removed only when all its active projects are removed.
    for r in tables['partners']:
        ps={p['project_id'] for p in tables['projects'] if not p['is_deleted'] and p['partner_id']==r['partner_id']}
        if ps and ps<=projects: partners.add(r['partner_id'])
    bases={r['base_project_id'] for r in tables['base_projects'] if r['company_id'] in companies or excluded(r['template_name'])}
    ids={'companies':companies,'partners':partners,'projects':projects,'base_projects':bases}
    ids['daily_reports']={r['daily_report_id'] for r in tables['daily_reports'] if r['project_id'] in projects or extra(r).get('source_id') in rejected}
    ids['invoices']={r['invoice_id'] for r in tables['invoices'] if r['company_id'] in companies or extra(r).get('source_id') in rejected}
    ids['payments']={r['payment_id'] for r in tables['payments'] if r['partner_id'] in partners or extra(r).get('source_id') in rejected}
    ids['price_sets']={r['price_set_id'] for r in tables['price_sets'] if r['project_id'] in projects or r['base_project_id'] in bases or r['company_id'] in companies}
    ids['price_series']={r['price_series_id'] for r in tables['price_series'] if r['project_id'] in projects or r['base_project_id'] in bases or r['company_id'] in companies}
    return {k:sorted(v) for k,v in ids.items()}

def taxonomy(out):
    result={}
    for p in sorted((out/'ollama_cache').glob('labels_*.json')):
        doc=load(p)
        expected={r['label'] for r in doc['request']['items']}
        rows=doc['response'].get('items',[])
        for r in rows:
            label=r.get('label')
            if label not in expected:
                matches=[x for x in expected if norm(x)==norm(label)]
                if len(matches)!=1: continue
                label=matches[0]
            result[label]={**r,'label':label}
    return result

def classify(label,tax):
    item=deepcopy(tax.get(label,{})); text=norm(label)
    typ=item.get('item_type','unknown')
    # Enforce the explicit semantic boundaries against model drift.
    if re.search('会費|手数料|保険|車両|前払|調整|返済|差押',text) and not re.search('日極|料金|単価',text): typ='deduction'
    elif re.search('交通|駐車|燃料|ガソリン|定期代|通信|諸経費',text) or text in {'gs','etc'}: typ='expense'
    elif re.search('時間給|時給|遅早時間割',text): typ='hourly'
    elif '距離超過' in text: typ='distance'
    elif re.search('深夜.*(超過|残業)|残業.*深夜',text): typ='night_overtime'
    elif re.search('時間超過|超過|残業',text): typ='overtime'
    elif '深夜' in text: typ='night'
    elif re.search('日極|日額|日割|単価|基本料金|土.*料金|日.*料金|研修.*料金|半日料金',text): typ='daily_basic'
    days=item.get('day_types',['all'])
    if not isinstance(days,list) or any(x not in DAYS for x in days): days=['all']
    if re.search('土日祝',text): days=['sat','sun','holiday']
    elif re.search('水日祝',text): days=['wed','sun','holiday']
    elif re.search('日祝',text): days=['sun','holiday']
    elif re.search('土曜|^土料金|^土超過|^土時間',text): days=['sat']
    elif re.search('日曜',text): days=['sun']
    elif re.search('水日',text): days=['wed','sun']
    elif text.startswith('月/火/木'): days=['mon','tue','thu']
    elif text.startswith('金/土'): days=['fri','sat']
    elif text=='水' or text.startswith('水曜'): days=['wed']
    variant='normal'
    if re.search('研修|引継|同乗',text): variant='研修'
    elif re.search('キャンセル|外業中止',text): variant='キャンセル'
    elif text.startswith('初期'): variant='初期'
    elif text.startswith('am'): variant='AM'
    elif text.startswith('pm'): variant='PM'
    elif text.startswith('夜間'): variant='夜間'
    elif '遅番' in text: variant='2交代遅番' if '2交代' in text else '遅番'
    elif '早番' in text: variant='2交代早番' if '2交代' in text else '早番'
    elif '中番' in text: variant='中番'
    elif any(x in label for x in ['①','②']): variant=next(x for x in ['①','②'] if x in label)
    elif '(' in text and '日極' in text: variant=text[text.index('(')+1:].rstrip(')')
    elif typ in RATE_TYPES and not re.search('日極|時間|超過|深夜|単価|料金|残業|水日|金/土|月/火/木|全日',text): variant=label
    return {'item_type':typ,'day_types':days,'variant':variant,'ollama':item}

def pair_sheet(sheet,tax):
    rates=[]; review=[]
    source=[{**r,'semantic':classify(r['label'],tax)} for r in sheet['rows']]
    for r in source:
        if r.get('quantity_basis')=='minutes':
            if r['semantic']['item_type']=='daily_basic': r['semantic']['item_type']='hourly'
            if '法定外' in r['label']: r['semantic'].update(item_type='hourly',day_types=['sat'],variant='normal')
            elif '法定休日' in r['label']: r['semantic'].update(item_type='hourly',day_types=['sun','holiday'],variant='normal')
    source=[r for r in source if r['semantic']['item_type'] in RATE_TYPES]
    bill=[r for r in source if r['side']=='billing']; pay=[r for r in source if r['side']=='payment']; used=set()
    for b in bill:
        direct=[(i,r) for i,r in enumerate(pay) if i not in used and re.sub(r'[\s$]','',r['quantity_formula'])=='='+b['quantity_cell']]
        if len(direct)>1:
            same=[(i,r) for i,r in direct if norm(r['label'])==norm(b['label'])]
            if same: direct=same
        if not direct:
            direct=[(i,r) for i,r in enumerate(pay) if i not in used and r['semantic']['item_type']==b['semantic']['item_type'] and r['semantic']['day_types']==b['semantic']['day_types'] and r['semantic']['variant']==b['semantic']['variant']]
        if len(direct)!=1:
            review.append({'issue':'unpaired_billing','label':b['label'],'cell':b['unit_cell']}); continue
        i,p=direct[0];used.add(i)
        if b['unit_price'] is None or p['unit_price'] is None:
            review.append({'issue':'missing_numeric_unit','label':b['label'],'cell':b['unit_cell'],
                           'requires_review':any((r['quantity'] or 0)!=0 or (r['amount'] or 0)!=0 for r in [b,p])});continue
        if any(r['amount_difference'] is not None and abs(r['amount_difference'])>0.01 for r in [b,p]):
            review.append({'issue':'amount_mismatch','label':b['label']});continue
        if min(b['unit_price'],p['unit_price'])<0:
            review.append({'issue':'negative_work_rate','label':b['label']});continue
        rates.append({'label':b['label'],'item_type':b['semantic']['item_type'],'day_types':b['semantic']['day_types'],
                      'variant':b['semantic']['variant'],'billing':b['unit_price'],'payment':p['unit_price'],
                      'billing_evidence':b,'payment_evidence':p})
    for i,p in enumerate(pay):
        if i not in used and (p['unit_price'] or 0)!=0: review.append({'issue':'unpaired_payment','label':p['label'],'cell':p['unit_cell']})
    return rates,review

def rounding_for(sheet):
    text=norm(sheet['header']); warnings=[]
    mode,unit='floor',15
    if '30分単位' in text and '20分未満' in text:
        # Existing engine cannot express an asymmetric 20/30 threshold.
        warnings.append('20分未満切捨・20分以上切上の30分単位は個別条件の確認が必要')
    elif '15分単位' in text or ('15分未満' in text and not re.search('以上.*切上',text)):
        mode,unit='floor',15
    elif '20分単位' in text: mode,unit='floor',20
    elif '15分未満' in text and re.search('以上.*切上',text):
        mode,unit='floor',15
        observations=sheet.get('rounding_observations',[])
        if any(abs((x['raw_minutes']//15)*15-x['rounded_minutes'])>0.1 for x in observations):
            warnings.append('原本の時間数量に15分切捨と一致しない手入力あり（既存実績は維持）')
    elif text not in {'','なし','時間超過'}: warnings.append('時間丸めの条件を原本特記で確認: '+sheet['header'])
    return {'time_unit_minutes':unit,'time_mode':mode,'amount_mode':'floor','amount_stage':'detail'},warnings

def fee_set(sheet,rates,project,company_name,partner_name):
    grouped=defaultdict(list)
    for r in rates:
        variant=r['variant'] if r['item_type'] not in {'unit','distance'} else r['label']
        grouped[(tuple(r['day_types']),variant)].append(r)
    cards=[];warnings=[]
    for (days,variant),rows in grouped.items():
        by_type=defaultdict(list)
        for r in rows: by_type[r['item_type']].append(r)
        if any(len(v)>1 for v in by_type.values()):
            warnings.append('同一条件の複数料金行: '+', '.join(r['label'] for r in rows))
        if not any(r['item_type'] in {'daily_basic','hourly','distance','unit'} for r in rows):
            warnings.append('基本料金のない料金区分: '+','.join(r['label'] for r in rows))
        name={'all':'通常','sat':'土曜','sun':'日曜','holiday':'祝日','wed':'水曜'}.get(','.join(days),{'sun,holiday':'日祝','sat,sun,holiday':'土日祝'}.get(','.join(days),'・'.join(days)))
        if variant!='normal': name=variant+' '+name
        key=sid(sheet['source_file']+'|'+str(days)+'|'+variant)
        fr=[]
        for index,r in enumerate(rows):
            fr.append({'id':'lr_'+key+'_'+str(index),'item_name':r['label'],'item_type':r['item_type'],
                       'billing':r['billing'],'payment':r['payment'],'billing_detail_name':r['label'],
                       'payment_detail_name':r['payment_evidence']['label'],'condition_expression':'',
                       'billing_expression':'','payment_expression':'','sort_order':10*(index+1),'rule_state':'active'})
        cards.append({'id':'lf_'+key,'name':name,'weekdays':{d:d in days for d in DAYS},'rows':fr,'sort_order':0})
    # Specific weekday cards must precede the normal ALL fallback; manual variants follow it.
    cards.sort(key=lambda c:(any(v in c['name'] for v in ['研修','キャンセル','初期','AM','PM','早番','中番','遅番','①','②','夜間']),c['weekdays']['all']))
    for i,c in enumerate(cards): c['sort_order']=(i+1)*10
    standard=sheet['standard_minutes'] or sheet['gross_standard_minutes']
    if standard is None:
        standard=round(float(project.get('basic_work_hours') or 8)*60)
        warnings.append('原本の基準時間不足: 現行案件の基準時間を使用')
    rounding,rwarn=rounding_for(sheet);warnings+=rwarn
    night=any(r['item_type']=='night' and (r['billing'] or r['payment']) for r in rates)
    night_ot=any(r['item_type']=='night_overtime' and (r['billing'] or r['payment']) for r in rates)
    if night or night_ot: warnings.append('深夜単価の加算/排他方式・対象時間帯を要確認')
    if any(r['billing_evidence'].get('quantity_basis')=='minutes' for r in rates):
        warnings.append('派遣: 月合計分÷60×単価の切上。残業と深夜加算は日別排他計算と異なるため自動計算を保留')
    if any(r['item_type']=='unit' for r in rates): warnings.append('商品個数別の月次計算: 数量入力方式を要確認')
    if any(r['item_type']=='hourly' for r in rates) and not any(r['item_type']=='daily_basic' for r in rates):
        warnings.append('時間給のみの料金: 通常時間・超過・不足控除の適用範囲を要確認')
    ex={'fee_item_model':'fee_items_v2','fee_items':cards,
        'work_rules':{'standard_minutes':standard,'billing':{'standard_minutes':standard},'payment':{'standard_minutes':standard}},
        'rounding':{'billing':deepcopy(rounding),'payment':deepcopy(rounding)},
        'night_rules':{side:{'periods':[{'start':'22:00','end':'29:00'}],
                      'night_mode':'separate' if night else 'excluded','night_overtime_mode':'separate' if night_ot else 'excluded'} for side in ['billing','payment']}}
    distances=[r for r in rates if r['item_type']=='distance']
    if distances: warnings.append('距離単価あり: 基準距離・日次/月次方式の確認が必要')
    ex['legacy_analysis']={'source_file':sheet['source_file'],'source_sheet':sheet['source_sheet'],
       'source_id':sheet['source_id'],'sheet_index':sheet['sheet_index'],'target_year_month':sheet['target_year_month'],
       'rate_evidence':rates,'source_rows':sheet['rows'],'header':sheet['header'],'warnings':warnings,'distance_candidates':distances,
       'model':'qwen3.5:4b','calculation_status':'review_required' if warnings else 'ready'}
    return {'company_id':project['company_id'],'project_id':project['project_id'],'base_project_id':None,
            'price_set_name':f'{company_name} / {partner_name} 分析料金'[:190],
            'apply_start_date':sheet['target_year_month']+'-01','apply_end_date':None,
            'extra_data':ex,'note':'旧経理日報の単価・計算式を再照合。'+(' 要確認: '+' / '.join(warnings) if warnings else '')}

def build(out,seed_dir):
    evidence=load(out/'evidence.json');db=load(out/'db-before.json');tax=taxonomy(out)
    if set(x['label'] for x in evidence['labels'])-set(tax):
        raise ValueError('Ollama classification is incomplete')
    ids=change_ids(db,evidence);tables=db['tables'];projects={p['project_id']:p for p in tables['projects'] if not p['is_deleted'] and p['project_id'] not in ids['projects']}
    companies={x['company_id']:x['company_name'] for x in tables['companies']};partners={x['partner_id']:x['partner_name'] for x in tables['partners']}
    by_source=defaultdict(set)
    for r in tables['daily_reports']:
        if r['project_id'] in projects and not r['is_deleted']:
            s=extra(r).get('source_id')
            if s: by_source[s].add(r['project_id'])
    source_names={r['source_id']:r for r in csv.DictReader(open(seed_dir/'ollama_source_map.csv',encoding='utf-8-sig'))}
    sets=defaultdict(list);reviews=[];pair_count=0
    for sheet in sorted(evidence['sheets'],key=lambda s:(s['target_year_month'],s['source_file'],s['sheet_index'])):
        matches=by_source[sheet['source_id']]
        if not matches:
            names=source_names.get(sheet['source_id'],{})
            matches={p['project_id'] for p in projects.values() if norm(companies[p['company_id']])==norm(names.get('company_name')) and norm(partners[p['partner_id']])==norm(names.get('partner_name'))}
        if len(matches)!=1 or not sheet['target_year_month']:
            reviews.append({'source_file':sheet['source_file'],'source_sheet':sheet['source_sheet'],'issue':'project_or_month_unresolved','matches':sorted(matches)}); continue
        project=projects[next(iter(matches))]
        rates,issues=pair_sheet(sheet,tax);pair_count+=len(rates)
        reviews.extend({'source_file':sheet['source_file'],'source_sheet':sheet['source_sheet'],**r} for r in issues)
        data=fee_set(sheet,rates,project,companies[project['company_id']],partners[project['partner_id']])
        if any(x.get('requires_review',True) for x in issues):
            data['extra_data']['legacy_analysis']['warnings'].append('請求・支払の未対応行または単価空欄あり: 元セルを確認')
            data['extra_data']['legacy_analysis']['calculation_status']='review_required'
        if not data['extra_data']['fee_items']:
            reviews.append({'source_file':sheet['source_file'],'source_sheet':sheet['source_sheet'],'issue':'no_complete_rate_cards'});continue
        # Compare business values, not changing source cell/sheet IDs.
        body=deepcopy({k:v for k,v in data['extra_data'].items() if k!='legacy_analysis'})
        for c in body['fee_items']:
            c.pop('id',None)
            for r in c['rows']: r.pop('id',None)
        data['signature']=hashlib.sha256(json.dumps(body,sort_keys=True,ensure_ascii=False).encode()).hexdigest()
        sets[project['project_id']].append(data)
    revisions=[]
    for project_id,versions in sets.items():
        last=None;seen_month={}
        for v in versions:
            start=v['apply_start_date']
            if start in seen_month:
                if seen_month[start]!=v['signature']:
                    reviews.append({'project_id':project_id,'issue':'same_month_conflicting_rates','source_file':v['extra_data']['legacy_analysis']['source_file'],'source_sheet':v['extra_data']['legacy_analysis']['source_sheet']})
                    target=next(x for x in reversed(revisions) if x['project_id']==project_id)
                    analysis=target['extra_data']['legacy_analysis']
                    analysis.setdefault('alternate_sources',[]).append(v['extra_data']['legacy_analysis'])
                    analysis['warnings'].append('同月に異なる料金一式あり: 代替資料も表示。適用区分の確認が必要')
                    analysis['calculation_status']='review_required'
                continue
            seen_month[start]=v['signature']
            if last and last['signature']==v['signature']:continue
            if last: last['apply_end_date']=(date.fromisoformat(start)-timedelta(days=1)).isoformat()
            revisions.append(v);last=v
    basics=[]
    by_company=defaultdict(list)
    for v in revisions: by_company[v['company_id']].append(v)
    for company_id,versions in by_company.items():
        v=min(versions,key=lambda v:(v['apply_start_date'],v['extra_data']['legacy_analysis']['source_file'],v['extra_data']['legacy_analysis']['sheet_index']))
        base=next((b for b in tables['base_projects'] if b['company_id']==company_id and not b['is_deleted'] and b['base_project_id'] not in ids['base_projects']),None)
        if not base: reviews.append({'company_id':company_id,'issue':'base_project_missing'});continue
        basic=deepcopy(v);basic['base_project_id']=base['base_project_id'];basic['project_id']=None;basic['apply_end_date']=None
        basic['price_set_name']=companies[company_id]+' 企業基本料金'
        basic['note']='最初のデータを企業基本料金として採用（適用年月、元ファイル名、元シート順）。'+v['note']
        basic['extra_data']['legacy_analysis']['base_source_project_id']=v['project_id']
        basics.append(basic)
    allsets=basics+revisions
    for v in allsets:
        owner='base:'+str(v['base_project_id']) if v['base_project_id'] else 'project:'+str(v['project_id'])
        v['import_key']='legacy-rate-v2:'+owner+':'+v['apply_start_date']+':'+v['signature'][:16]
        v['extra_data']['legacy_analysis']['import_key']=v['import_key']
    summary={'source_sheets':len(evidence['sheets']),'excluded_files':len(evidence['excluded_files']),
             'delete':{k:len(v) for k,v in ids.items()},'paired_rates':pair_count,'company_base_sets':len(basics),
             'project_rate_revisions':len(revisions),'projects_with_rates':len(sets),'active_projects_remaining':len(projects),
             'review_counts':dict(Counter(x['issue'] for x in reviews)),'source_issues':dict(Counter(x['issue'] for x in evidence['issues']))}
    plan={'version':2,'summary':summary,'delete_ids':ids,'price_sets':allsets,'reviews':reviews,
          'projects_without_rates':[p for p in projects.values() if p['project_id'] not in sets],
          'snapshot_sha256':hashlib.sha256((out/'db-before.json').read_bytes()).hexdigest()}
    dump(out/'db-plan.json',plan);dump(out/'recheck-summary.json',summary)
    print(json.dumps(summary,ensure_ascii=False,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True);p.add_argument('--seed',type=Path,required=True)
    a=p.parse_args();build(a.output,a.seed)
