"""Ask local Ollama to explain observed formulas, retaining the complete audit trail."""
import argparse
from collections import Counter
from pathlib import Path
from legacy_rate_recheck import load, dump, ollama

def main(out):
    evidence=load(out/'evidence.json')
    observations=Counter()
    for s in evidence['sheets']:
        if '15分未満' in s['header']:
            observations.update((round(x['raw_minutes'],2),round(x['rounded_minutes'],2)) for x in s['rounding_observations'])
    task={'task':'実際の旧Excel数式から計算ロジックを説明し、現行エンジンに直結できるか評価。JSON patterns配列(id,meaning,compatible,cautions)。契約条件を推測しない。',
      'current_engine':'日額＋基準時間超過×時間外単価－不足時間×控除時給。通常/時間外/深夜は排他的区分。時間丸めfloor/ceil/round。金額は日別丸め。',
      'patterns':[
       {'id':'product','formula':'=C40*D40','meaning':'C40日極単価,D40稼働日数。同じ月の合計。'},
       {'id':'overtime','formula':'=C42*D42','meaning':'C42時間超過単価,D42=SUM(F5:F35)。Fは時間（小数）。'},
       {'id':'dispatch_minutes','formula':'=IFERROR(ROUNDUP(D39/60*E39,0),"")','quantity':'E39=SUM(平日H5:H35)、H=MAX(FLOOR(MAX(F-G-M,0),10),0)。F拘束分,G休憩分,Mその他控除分。残業行も同じ式、単価=通常単価*1.25、数量=MAX(FLOOR(MAX(F-G-M-$B$4,0),10),0)。深夜は通常単価*0.25を別に加算。'},
       {'id':'floor15','header':'15分未満切捨・以上切上','observed_raw_and_result_minutes':[{'raw':k[0],'result':k[1],'count':v} for k,v in observations.most_common(30)]},
       {'id':'threshold20','header':'20分未満切捨・以上切上(30分単位)'},
       {'id':'unit','formula':'=PRODUCT(C40,E40)','meaning':'C40フィルター1個の単価、E40月合計個数'},
       {'id':'distance','formula':'=C43*D43','meaning':'距離超過単価×月超過距離。無料基準距離と日別/月別の数量算出を別途確認必要。'}]}
    target=out/'ollama_cache'/'logic_review.json'
    if not target.exists(): dump(target,{'request':task,**ollama(task)})
    print('logic_review_complete')

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--output',type=Path,required=True)
    main(p.parse_args().output)
