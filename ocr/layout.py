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
    best = (0, 0)
    for angle in (0, 180, 90, 270):
        sample = image.rotate(-angle, expand=True)
        sample.thumbnail((1000,1000))
        result = next(iter(engine.predict(np.asarray(sample))))
        joined = compact(' '.join(result.get('rec_texts', [])))
        score = sum(word in joined for word in ['日付','稼働','委託','受託','備考','確認印'])
        sample.close()
        if score > best[0]:
            best = (score, angle)
        if score >= 4:
            break
    return (image.rotate(-best[1], expand=True) if best[1] else image), best[1]


def propose(image, geometry, engine):
    edges = geometry.get('row_edges', [])
    proposal = {'page_kind':'pending','columns':{},'column_labels':{},'header_text':[], 'needs_confirmation':True}
    if len(edges) < 10:
        proposal['page_kind'] = 'evidence'
        return proposal
    proposal.update(page_kind='daily',top=edges[1],bottom=edges[-1],row_edges=edges[1:],row_count=len(edges)-2)
    if engine is None:
        return proposal
    # Preserve full-page header text separately from table mapping.
    header = image.crop((0,0,image.width,int(edges[1]*image.height)))
    result = next(iter(engine.predict(np.asarray(header))))
    texts = result.get('rec_texts', [])
    boxes = result.get('rec_polys', [])
    proposal['header_text'] = [str(t) for t in texts]
    band = ink(image)[max(0,int(edges[0]*image.height)):min(image.height,int(edges[-1]*image.height))]
    mask = cv2.morphologyEx(band,cv2.MORPH_OPEN,np.ones((max(12,band.shape[0]//4),1),np.uint8))
    xs = np.flatnonzero((mask>0).sum(axis=0)>band.shape[0]*.35)
    groups = np.split(xs,np.where(np.diff(xs)>4)[0]+1)
    bounds = [float(np.mean(g))/image.width for g in groups if len(g)]
    if len(bounds)<3:
        return proposal
    for i,(left,right) in enumerate(zip(bounds,bounds[1:])):
        words=[]
        for t,b in zip(texts,boxes):
            center=np.asarray(b).mean(axis=0)
            if left<=center[0]/image.width<=right and center[1]>=edges[0]*image.height:
                words.append(str(t))
        label=' '.join(words)
        key=next((k for k,aliases in HEADERS if any(a in compact(label) for a in aliases)),f'extra_col_{i+1}')
        if key in proposal['columns']: key=f'extra_col_{i+1}'
        proposal['columns'][key]=[left,right]
        proposal['column_labels'][key]=label or f'項目{i+1}'
    return proposal
