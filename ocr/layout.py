"""Conservative layout proposals. A person confirms every template before OCR."""
import re
import numpy as np
import cv2
from geometry import ink

HEADERS = [('work_date', ['日付']), ('work_interval', ['業務稼働時間','稼働時間']),
           ('start_time',['開始時間','開始','始業']),('end_time',['終了時間','終了','終業']),
           ('break_minutes',['休憩']),('reported_overtime',['時間超過']),
           ('reported_excess_distance',['距離超過']),('total_distance',['走行距離']),
           ('business_expense',['業務経費']),('alcohol_check',['酒気帯び']),
           ('row_comment',['備考']),('confirmation_mark',['確認印'])]


def compact(value):
    return re.sub(r'\s+', '', str(value))


def orientation(image, engine):
    if engine is None:
        return image, 0
    # Dense portrait tables contain tiny headings. OCR only the upper half at
    # near-source resolution; a whole-page thumbnail destroys those characters.
    angles=(0,180) if image.height>=image.width else (90,270,0,180)
    best=(0,angles[0])
    for angle in angles:
        rotated=image.rotate(-angle,expand=True)
        sample=rotated.crop((0,0,rotated.width,rotated.height*.5))
        sample.thumbnail((1800,1800))
        result=next(iter(engine.predict(np.asarray(sample))))
        joined=compact(' '.join(result.get('rec_texts',[])))
        score=sum(word in joined for word in ['日付','稼働','委託','受託','備考','確認印','時間超過'])
        sample.close();rotated.close()
        if score>best[0]:best=(score,angle)
        if score>=4:break
    # Weak recognition must not turn a readable portrait sideways.
    angle=best[1] if best[0]>=2 else angles[0]
    return (image.rotate(-angle,expand=True) if angle else image),angle


def propose(image, geometry, engine):
    edges = geometry.get('row_edges', [])
    proposal = {'page_kind':'pending','columns':{},'column_labels':{},'header_text':[], 'needs_confirmation':True}
    if len(edges) < 10:
        proposal['page_kind'] = 'pending'
        return proposal
    proposal.update(page_kind='daily',top=edges[1],bottom=edges[-1],row_edges=edges[1:],row_count=len(edges)-2)
    if engine is None:
        return proposal
    # Preserve full-page header text separately from table mapping.
    header = image.crop((0,0,image.width,int(edges[min(3,len(edges)-1)]*image.height)))
    result = next(iter(engine.predict(np.asarray(header))))
    texts = result.get('rec_texts', [])
    boxes = result.get('rec_polys', [])
    proposal['header_text'] = [str(t) for t in texts]
    # The grid may include an extra rule above the column headings. Locate
    # the actual heading band from several recognized labels, not its ordinal.
    scores=[]
    for top,bottom in zip(edges[:3],edges[1:4]):
        score=sum(any(alias in compact(t) for _,aliases in HEADERS for alias in aliases)
                  for t,b in zip(texts,boxes) if top*image.height<=np.asarray(b).mean(axis=0)[1]<bottom*image.height)
        scores.append(score)
    heading=int(np.argmax(scores)) if max(scores,default=0)>=2 else 0
    proposal.update(top=edges[heading+1],row_edges=edges[heading+1:],row_count=len(edges)-heading-2)
    top,bottom=edges[heading],edges[heading+1]
    band = ink(image)[max(0,int(top*image.height)+2):min(image.height,int(bottom*image.height)-2)]
    mask = cv2.morphologyEx(band,cv2.MORPH_OPEN,np.ones((max(8,band.shape[0]//2),1),np.uint8))
    xs = np.flatnonzero((mask>0).sum(axis=0)>band.shape[0]*.55)
    groups = np.split(xs,np.where(np.diff(xs)>4)[0]+1)
    bounds = geometry.get('column_edges') or [float(np.mean(g))/image.width for g in groups if len(g)]
    table=geometry.get('table_bounds')
    if table and bounds:
        if bounds[0]-table[0]>.015:bounds=[table[0],*bounds]
        if table[2]-bounds[-1]>.015:bounds=[*bounds,table[2]]
    if len(bounds)<3:
        return proposal
    for i,(left,right) in enumerate(zip(bounds,bounds[1:])):
        words=[]
        for t,b in zip(texts,boxes):
            center=np.asarray(b).mean(axis=0)
            if left<=center[0]/image.width<=right and top*image.height<=center[1]<bottom*image.height:
                words.append(str(t))
        label=' '.join(words)
        key=next((k for k,aliases in HEADERS if any(a in compact(label) for a in aliases)),f'extra_col_{i+1}')
        if key in proposal['columns']: key=f'extra_col_{i+1}'
        proposal['columns'][key]=[left,right]
        proposal['column_labels'][key]=label or f'項目{i+1}'
    return proposal
