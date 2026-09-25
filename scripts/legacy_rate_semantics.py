"""Translate imported rate evidence to named business calculations; never edit Excel.

Only the amount operation is executable. Quantity derivations are source-backed
descriptions, not a guessed general Excel evaluator or new contract policy.
"""
import argparse
import hashlib
import json
import re
from collections import Counter
from pathlib import Path
from legacy_rate_recheck import read_source, load, dump, number, norm, excluded

VERSION = 'business-calculation-v1'
TYPES = {
    'daily_basic': ('勤務日数', 'day', '日'),
    'hourly': ('通常勤務時間', 'hour', '時間'),
    'shortage': ('不足精算時間', 'hour', '時間'),
    'overtime': ('超過時間', 'hour', '時間'),
    'night': ('深夜時間', 'hour', '時間'),
    'night_overtime': ('深夜超過時間', 'hour', '時間'),
    'distance': ('超過距離', 'km', 'km'),
    'unit': ('作業・商品数量', 'unit', '個・回'),
}


def obj(x):
    return json.loads(x) if isinstance(x, str) else x or {}


def digest(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class QuantityTrace:
    def __init__(self, values, formulas, rows):
        self.values, self.formulas = values, formulas
        self.labels = {r['quantity_cell']: r['label'] for r in rows}

    def header(self, col):
        for row in (4, 3):
            value = self.values[f'{col}{row}'].value
            if isinstance(value, str) and value.strip():
                return value.strip()
        return '日別数量（項目名要確認）'

    def trace(self, ref, stack=()):
        if ref in stack or len(stack) > 12:
            return {'description': '参照循環または参照上限', 'inputs': [], 'issues': ['数量の参照連鎖を確認する']}
        raw = self.formulas[ref].value
        label = self.labels.get(ref, '調整数量')
        if not isinstance(raw, str) or not raw.startswith('='):
            return {'description': f'{label}の手入力数量', 'inputs': [label], 'issues': [], 'manual': True}
        expr = re.sub(r'[\s$]', '', raw).upper()
        single = re.fullmatch(r'=([A-Z]+\d+)', expr)
        if single:
            return self.trace(single[1], (*stack, ref))
        total = re.fullmatch(r'=SUM\(([A-Z]+)(\d+):\1(\d+)\)', expr)
        if total and 5 <= int(total[2]) <= int(total[3]) <= 35:
            header = self.header(total[1])
            daily = [self.formulas[f'{total[1]}{r}'].data_type == 'f' for r in range(int(total[2]), int(total[3])+1)]
            return {'description': f'日別の「{header}」を対象期間で合計', 'inputs': [header], 'issues': [],
                    'manual': not all(daily), 'aggregation': 'period_sum'}
        arithmetic = re.fullmatch(r'=([A-Z]+\d+)([+-][A-Z]+\d+)+', expr)
        if arithmetic:
            refs = re.findall(r'[A-Z]+\d+', expr)
            parts = [self.trace(r, (*stack, ref)) for r in refs]
            signs = re.findall(r'[+-]', expr)
            desc = parts[0]['description']
            for sign, part in zip(signs, parts[1:]):
                desc += (' から差し引く：' if sign == '-' else ' に加える：') + part['description']
            return {'description': desc, 'inputs': list(dict.fromkeys(x for p in parts for x in p['inputs'])),
                    'issues': list(dict.fromkeys(x for p in parts for x in p['issues'])),
                    'manual': any(p.get('manual') for p in parts), 'aggregation': 'period_sum'}
        issues = []
        if 'SUMPRODUCT' in expr:
            if re.search(r'[A-Z]+5:[A-Z]+35=1', expr) and re.search('超過|残業', label):
                issues.append('時間合計ではなく時間が1の行数を数える原本式。対象時間の算出を要確認')
            if 'ABS(' in expr and '>0' in expr:
                issues.append('不足時間ではなく不足発生日数を数える原本式。単位の不一致を要確認')
            if 'WEEKDAY(' in expr and 'ISNUMBER(MATCH(' in expr and ')+ISNUMBER' in expr and ')>0' not in expr:
                issues.append('日曜と祝日を加算する条件。重複日の二重計上を要確認')
        inputs = list(dict.fromkeys(self.header(col) for col in re.findall(r'([A-Z]+)(?:5):[A-Z]+35', expr)))
        if 'SUMIF' in expr:
            columns = re.findall(r',([A-Z]+):\1\)', expr)
            inputs = list(dict.fromkeys(self.header(col) for col in columns)) or inputs
            days = list(dict.fromkeys(re.findall(r'"([月火水木金土日祝])"', expr)))
            desc = '・'.join(days) + 'の「' + '・'.join(inputs) + '」を期間合計'
        elif 'SUMPRODUCT' in expr:
            desc = '曜日・休日と稼働条件を組み合わせた期間集計'
        else:
            desc = '条件付き数量計算（詳細な参照意味の確認が必要）'
        issues.append('条件付き数量の全参照と対象範囲は自動適用前に確認する')
        return {'description': desc, 'inputs': inputs or [label], 'issues': issues, 'manual': False,
                'aggregation': 'period_sum'}


def side_rule(evidence, kind, trace):
    basis = evidence.get('quantity_basis')
    label, unit, unit_label = TYPES[kind]
    if basis == 'minutes':
        unit, unit_label = 'minute', '分'
    quantity = evidence.get('quantity')
    deduction = kind == 'shortage'
    issues = []
    if deduction and quantity is not None and quantity > 0:
        issues.append('時間給精算が正数。控除か時間給加算か確認する')
    derived = trace.trace(evidence['quantity_cell'])
    issues += derived['issues']
    base = 'unit_price * quantity' + (' / 60' if unit == 'minute' else '')
    mode = evidence.get('amount_rounding')
    expression = {'floor': 'ROUNDDOWN', 'ceil': 'ROUNDUP', 'round': 'ROUND'}.get(mode)
    expression = f'{expression}({base}, 0)' if expression else base
    if deduction:
        expression = '-(' + expression + ')'
    operation = '控除' if deduction else '加算'
    amount_description = f'{label}（{unit_label}）' + (' ÷ 60' if unit == 'minute' else '') + ' × 単価'
    if deduction:
        amount_description = '−（' + amount_description + '）。不足数量は正の絶対値で扱う'
    amount_description += {'floor': '、円未満をゼロ方向へ切捨', 'ceil': '、円未満を絶対値切上', 'round': '、円未満を四捨五入'}.get(mode, '（行金額では丸めなし）')
    if mode:
        issues.append('原本は期間数量を集約後に金額丸め。現行日別計算との同等性を要確認')
    if quantity is None or evidence.get('amount') is None:
        issues.append('数量または原本金額が未記入のため検算できない')
    return {
        'quantity_name': label, 'quantity_unit': unit, 'quantity_unit_label': unit_label,
        'input_items': derived['inputs'], 'quantity_rule': derived['description'],
        'quantity_entry': 'manual_or_mixed' if derived.get('manual') else 'derived',
        'quantity_normalization': 'absolute_value' if deduction else 'identity',
        'unit_price': evidence['unit_price'], 'operation': operation,
        'amount_expression': expression, 'amount_description': amount_description,
        'aggregation_stage': 'source_period', 'amount_rounding': mode or 'none_at_line',
        'sample': {'quantity': abs(quantity) if deduction and quantity is not None else quantity,
                   'source_quantity': quantity, 'source_amount': evidence.get('amount')},
        'source': {k: evidence.get(k) for k in ('unit_cell', 'quantity_cell', 'amount_cell')},
        'issues': list(dict.fromkeys(issues)),
    }


def source_thresholds(values):
    result = {}
    # Only use a labeled helper trio, not an assumed fixed location.
    for row in range(36, min(values.max_row, 100)):
        for col in range(1, min(values.max_column, 25)-1):
            labels = [norm(values.cell(row, col+i).value) for i in range(3)]
            if labels == ['稼働時間', '拘束時間', '休憩時間']:
                nums = [number(values.cell(row+1, col+i).value) for i in range(3)]
                if all(n is not None for n in nums) and abs(nums[0] - nums[1] + nums[2]) < 0.001:
                    result = dict(zip(('net_hours', 'gross_hours', 'break_hours'), nums))
    return result


def build(snapshot_path, root, output):
    snapshot = load(snapshot_path)
    books, hashes, updates = {}, {}, []
    for record in snapshot['tables']['price_sets']:
        extra = obj(record['extra_data'])
        analysis = extra.get('legacy_analysis', {})
        if record['is_deleted'] or not analysis.get('import_key'):
            continue
        relative, sheet = analysis['source_file'], analysis['source_sheet']
        if excluded(relative, sheet):
            raise ValueError('Cancelled source is not allowed')
        path = (root / relative).resolve()
        if not path.is_relative_to(root.resolve()):
            raise ValueError('Source outside specified root')
        if relative not in books:
            books[relative] = read_source(path)
            hashes[relative] = digest(path)
        values, formulas = (book[sheet] for book in books[relative])
        trace = QuantityTrace(values, formulas, analysis['source_rows'])
        rules, blockers = [], []
        for index, rate in enumerate(analysis.get('rate_evidence', [])):
            kind = 'shortage' if '時間給精算' in norm(rate['label']) else rate['item_type']
            if kind not in TYPES:
                continue
            # Match the original row to a stable current fee-row id, not label alone.
            matches = [(card, row) for card in extra['fee_items'] for row in card['rows']
                       if row['item_name'] == rate['label'] and row['item_type'] == rate['item_type']
                       and float(row['billing']) == rate['billing'] and float(row['payment']) == rate['payment']
                       and {d for d, yes in card['weekdays'].items() if yes} == set(rate['day_types'])]
            linked = matches[0] if len(matches) == 1 else None
            issues = [] if linked else ['料金カードの対応が一意ではない']
            sides = {}
            for side in ('billing', 'payment'):
                evidence = rate[side + '_evidence']
                # Re-read original numeric evidence. Never normalize stale data silently.
                if number(values[evidence['unit_cell']].value) != evidence['unit_price']:
                    raise ValueError(f'Source rate changed: {record["price_set_id"]}/{index}/{side}')
                if values[evidence['quantity_cell']].value != evidence.get('quantity'):
                    # Blank and zero must remain distinct; parser normalizes numeric cells only.
                    if number(values[evidence['quantity_cell']].value) != evidence.get('quantity'):
                        raise ValueError('Source quantity changed')
                if number(values[evidence['amount_cell']].value) != evidence.get('amount'):
                    raise ValueError('Source amount changed')
                for key in ('unit', 'quantity', 'amount'):
                    cell = formulas[evidence[key + '_cell']]
                    actual = cell.value if cell.data_type == 'f' else ''
                    if actual != evidence.get(key + '_formula', ''):
                        raise ValueError('Source formula changed')
                sides[side] = side_rule(evidence, kind, trace)
                issues += sides[side]['issues']
            if kind in ('distance', 'unit', 'night', 'night_overtime'):
                issues.append('専用数量入力・対象条件と現行計算への接続を要確認')
            group = linked[0]['name'] if linked else '区分要確認'
            day_types = rate['day_types']
            if kind == 'shortage':
                current_row = int(re.search(r'\d+', rate['billing_evidence']['unit_cell'])[0])
                parents = [r for r in analysis['rate_evidence'] if r['item_type'] == 'daily_basic'
                           and int(re.search(r'\d+', r['billing_evidence']['unit_cell'])[0]) < current_row]
                if parents:
                    parent = max(parents, key=lambda r: int(re.search(r'\d+', r['billing_evidence']['unit_cell'])[0]))
                    group = parent['label'] + 'の不足精算'
                    day_types = parent['day_types']
                    if set(day_types) != set(rate['day_types']):
                        issues.append('不足控除の料金区分が先行する日額料金と異なる。既存カードの区分修正を要確認')
            rules.append({'id': f'rule_{index+1}', 'fee_item_id': linked[0]['id'] if linked else None,
                          'fee_row_id': linked[1]['id'] if linked else None,
                          'item_name': '不足時間控除' if kind == 'shortage' else rate['label'],
                          'source_label': rate['label'], 'item_type': kind, 'category': group,
                          'day_types': day_types, 'billing': sides['billing'], 'payment': sides['payment'],
                          'issues': list(dict.fromkeys(issues))})
            blockers += issues
        thresholds = source_thresholds(values)
        if thresholds and thresholds['gross_hours'] != thresholds['net_hours'] and any(r['item_type'] == 'overtime' for r in rules):
            blockers.append('拘束基準と実働基準が別。超過の基準と不足単価の除数を同じ基準時間へ統合しない')
        model = {'schema_version': 1, 'definition_version': VERSION,
                 'classification_model': analysis.get('model'),
                 'method': 'Ollamaの既存分類・代表分析を原本の参照関係と照合し名前付き項目へ正規化',
                 'source_sha256': hashes[relative], 'thresholds': thresholds, 'rules': rules,
                 'quantity_analysis_scope': '単純参照・日別合計・加減算を追跡。条件集計は確認事項を明記',
                 'execution_scope': '名前付き数量を与えた金額検算。未確認の数量自動算出は実行しない',
                 'issues': list(dict.fromkeys(blockers))}
        if not rules:
            raise ValueError('Imported set has no business rules')
        updates.append({'price_set_id': record['price_set_id'], 'version': record['version'],
                        'import_key': analysis['import_key'], 'semantic_model': model,
                        'calculation_status': 'review_required' if blockers else analysis['calculation_status']})
    result = {'snapshot_sha256': digest(snapshot_path), 'definition_version': VERSION, 'updates': updates}
    dump(output, result)
    print(json.dumps({'sets': len(updates), 'rules': sum(len(u['semantic_model']['rules']) for u in updates),
                      'sources': len(books), 'status': dict(Counter(u['calculation_status'] for u in updates))}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('snapshot', type=Path)
    parser.add_argument('source_root', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    build(args.snapshot, args.source_root, args.output)
