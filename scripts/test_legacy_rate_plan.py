import unittest
from legacy_rate_plan import pair_sheet, rounding_for, fee_set

def row(side,label,unit,qcell,qformula=''):
    return {'side':side,'label':label,'unit_price':unit,'quantity_cell':qcell,'quantity_formula':qformula,
            'unit_cell':'C40','quantity':0,'amount':0,'amount_difference':0}

class RatePlanTests(unittest.TestCase):
    def test_reference_pair_beats_row_order(self):
        s={'rows':[row('billing','日極',10000,'D40'),row('billing','時間超過',2000,'D41'),row('payment','時間超過',1500,'D53','=D41'),row('payment','日極',8000,'D54','=D40')]}
        rates,issues=pair_sheet(s,{})
        self.assertEqual([(r['billing'],r['payment']) for r in rates],[(10000,8000),(2000,1500)])
        self.assertFalse(issues)
    def test_blank_is_not_a_zero_rate(self):
        rates,issues=pair_sheet({'rows':[row('billing','日極',None,'D40'),row('payment','日極',0,'D50','=D40')]},{})
        self.assertFalse(rates)
        self.assertEqual(issues[0]['issue'],'missing_numeric_unit')
    def test_explicit_zero_is_preserved(self):
        rates,_=pair_sheet({'rows':[row('billing','日極',0,'D40'),row('payment','日極',0,'D50','=D40')]},{})
        self.assertEqual(rates[0]['payment'],0)
    def test_mismatch_not_imported(self):
        b=row('billing','日極',10000,'D40');b['amount_difference']=10
        rates,issues=pair_sheet({'rows':[b,row('payment','日極',8000,'D50','=D40')]},{})
        self.assertFalse(rates)
        self.assertEqual(issues[0]['issue'],'amount_mismatch')
    def test_observed_quarters_not_half_hour_rounding(self):
        rounding,_=rounding_for({'header':'15分未満切捨・以上切上','rounding_observations':[{'raw_minutes':20,'rounded_minutes':15}]})
        self.assertEqual((rounding['time_mode'],rounding['time_unit_minutes']),('floor',15))
    def test_asymmetric_rounding_flagged(self):
        _,warnings=rounding_for({'header':'20分未満切捨・以上切上(30分単位)'})
        self.assertTrue(warnings)

if __name__=='__main__':unittest.main()
