import unittest
from types import SimpleNamespace
from legacy_rate_recheck import SourceSheet
from legacy_rate_semantics import QuantityTrace, side_rule
from openpyxl.utils.cell import coordinate_to_tuple


def sheet(entries):
    cells = {}
    for ref, value in entries.items():
        row, col = coordinate_to_tuple(ref)
        cells[ref] = SimpleNamespace(value=value, data_type='f' if str(value).startswith('=') else 'n', row=row, column=col)
    return SourceSheet(cells)


class SemanticsTest(unittest.TestCase):
    def test_period_quantity_minus_manual_holiday(self):
        s = sheet({'G4':'出勤日数', 'G36':'=SUM(G5:G35)', 'D39':'=G36-D42', 'D42':1})
        t = QuantityTrace(s,s,[{'quantity_cell':'D42','label':'日祝'}]).trace('D39')
        self.assertIn('出勤日数',t['description'])
        self.assertIn('日祝の手入力',t['description'])
        self.assertTrue(t['manual'])

    def test_shortage_and_zero(self):
        s = sheet({'D44':-7})
        e = dict(quantity_cell='D44',unit_cell='B44',amount_cell='E44',quantity=-7,unit_price=3375,amount=-23625)
        r = side_rule(e,'shortage',QuantityTrace(s,s,[]))
        self.assertEqual(r['sample']['quantity'],7)
        self.assertEqual(r['amount_expression'],'-(unit_price * quantity)')
        self.assertEqual(r['quantity_unit'],'hour')

    def test_full_column_dispatch(self):
        s = sheet({'H4':'勤務時間','E39':'=SUM(SUMIF(C:C,{"月","火"},H:H))'})
        r = QuantityTrace(s,s,[]).trace('E39')
        self.assertEqual(r['input_items'] if 'input_items' in r else r['inputs'],['勤務時間'])
        self.assertIn('月・火',r['description'])
        self.assertTrue(r['issues'])

    def test_count_is_not_hours(self):
        s = sheet({'D43':'=SUMPRODUCT((WEEKDAY(B5:B35,1)=7)*(F5:F35=1))'})
        r = QuantityTrace(s,s,[{'quantity_cell':'D43','label':'土曜超過'}]).trace('D43')
        self.assertTrue(any('行数' in x for x in r['issues']))

    def test_cycle_does_not_recurse_forever(self):
        s = sheet({'D39':'=D40','D40':'=D39'})
        self.assertTrue(QuantityTrace(s,s,[]).trace('D39')['issues'])


if __name__ == '__main__':
    unittest.main()
