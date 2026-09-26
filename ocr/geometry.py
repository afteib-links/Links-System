"""Local ruled-table rectification. Coordinates always refer to the saved image."""
import cv2
import numpy as np
from PIL import Image, ImageOps


def ink(image):
    gray = np.asarray(image.convert('L'))
    return cv2.adaptiveThreshold(gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C,
                                cv2.THRESH_BINARY_INV, 31, 15)


def traces(image):
    """Trace long horizontal rules, including gently curved photographed rules."""
    binary = ink(image)
    h, w = binary.shape
    mask = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((1, max(20, w // 25)), np.uint8))
    anchor = int(w*.75)
    scores = (mask[:,int(w*.65):int(w*.85)] > 0).sum(axis=1)
    active = np.flatnonzero(np.convolve(scores, np.ones(3), 'same') > w * .12)
    groups = np.split(active, np.where(np.diff(active) > 6)[0]+1)
    tracking = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((1,7),np.uint8))
    found = []
    xs = np.arange(w)
    for group in groups:
        if not len(group) or len(group) > h * .035:
            continue
        seed = float(np.average(group, weights=scores[group]+1))
        points = {anchor:seed}
        for direction in (-1,1):
            last = seed
            for x in range(anchor+direction*6, w if direction==1 else -1, direction*6):
                y0,y1 = max(0,round(last)-9),min(h,round(last)+10)
                local = (tracking[y0:y1,max(0,x-3):min(w,x+4)]>0).sum(axis=1)
                candidates = np.flatnonzero(local >= 3)
                if len(candidates):
                    best = candidates[np.argmin(np.abs(candidates+y0-last))]
                    # Center the ink thickness rather than following its top edge.
                    near = candidates[np.abs(candidates-best)<=2]
                    last = float(np.average(near+y0,weights=local[near]))
                    points[x] = last
        if len(points) < w/6*.65: continue
        columns = sorted(points)
        found.append(np.interp(xs,columns,[points[x] for x in columns]))
    found.sort(key=lambda a: float(np.median(a)))
    return found


def rectify(image, source_quad=None):
    """Return a straightened table and explicit detection metadata, or safe fallback."""
    if source_quad:
        h, w = image.height, image.width
        quad = np.float32([[x*w,y*h] for x,y in source_quad])
        if not cv2.isContourConvex(quad.astype(np.int32)) or abs(cv2.contourArea(quad)) < w*h*.05:
            raise ValueError('Invalid document corners')
        matrix=cv2.getPerspectiveTransform(quad,np.float32([[0,0],[w-1,0],[w-1,h-1],[0,h-1]]))
        image=Image.fromarray(cv2.warpPerspective(np.asarray(image),matrix,(w,h),borderValue=(255,255,255)))
    binary = ink(image)
    h, w = binary.shape
    # A connected printed grid is more reliable than the outline of a photographed page.
    joined = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    contours, _ = cv2.findContours(joined, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        area = cv2.contourArea(contour)
        if not w * h * .20 < area < w * h * .97:
            continue
        hull = cv2.convexHull(contour)
        corners = cv2.approxPolyDP(hull, .025 * cv2.arcLength(hull, True), True).reshape(-1, 2)
        if len(corners) != 4:
            continue
        pts = corners.astype(np.float32)
        sums, differences = pts.sum(axis=1), np.diff(pts, axis=1).ravel()
        quad = np.array([pts[np.argmin(sums)], pts[np.argmin(differences)],
                         pts[np.argmax(sums)], pts[np.argmax(differences)]], np.float32)
        if len(np.unique(quad, axis=0)) != 4:
            continue
        left, top = np.floor(quad.min(axis=0)).astype(int)
        right, bottom = np.ceil(quad.max(axis=0)).astype(int)
        tw, th = int(right-left+1), int(bottom-top+1)
        if tw < w * .4 or th < h * .3:
            continue
        matrix = cv2.getPerspectiveTransform(quad, np.float32([[0,0],[tw-1,0],[tw-1,th-1],[0,th-1]]))
        warped = cv2.warpPerspective(np.asarray(image), matrix, (tw, th), borderValue=(255,255,255))
        table = Image.fromarray(warped)
        lines = traces(table)
        if len(lines) < 4 or any(np.min(b-a) < 6 for a,b in zip(lines,lines[1:])):
            table.close()
            continue
        # Keep detected spacing (no assumption that rows are uniform). Flatten each rule.
        targets = np.array([float(np.median(line)) for line in lines])
        boundaries = np.vstack([np.zeros(tw), *lines, np.full(tw, th-1)])
        target_y = np.r_[0, targets, th-1]
        # Border rules can coincide with the image edges.
        keep = np.r_[True, np.diff(target_y) > 1]
        boundaries, target_y = boundaries[keep], target_y[keep]
        map_y = np.empty((th, tw), np.float32)
        for x in range(tw):
            map_y[:, x] = np.interp(np.arange(th), target_y, boundaries[:, x])
        map_x = np.broadcast_to(np.arange(tw, dtype=np.float32), (th, tw)).copy()
        straight = cv2.remap(warped, map_x, map_y, cv2.INTER_CUBIC, borderMode=cv2.BORDER_CONSTANT, borderValue=(255,255,255))
        # Flatten bowed vertical rules too; keeping only horizontal rules straight
        # leaves photographed columns drifting across fixed OCR cell boundaries.
        transposed=Image.fromarray(straight).transpose(Image.Transpose.TRANSPOSE)
        verticals=traces(transposed)
        transposed.close()
        column_targets=[]
        if len(verticals)>=3 and all(np.min(b-a)>6 for a,b in zip(verticals,verticals[1:])):
            column_targets=[float(np.median(line)) for line in verticals]
            source_x=np.vstack([np.zeros(th),*verticals,np.full(th,tw-1)])
            target_x=np.r_[0,column_targets,tw-1]
            keep_x=np.r_[True,np.diff(target_x)>1]
            source_x,target_x=source_x[keep_x],target_x[keep_x]
            map_x=np.empty((th,tw),np.float32)
            for y in range(th):map_x[y,:]=np.interp(np.arange(tw),target_x,source_x[:,y])
            map_y=np.broadcast_to(np.arange(th,dtype=np.float32)[:,None],(th,tw)).copy()
            straight=cv2.remap(straight,map_x,map_y,cv2.INTER_CUBIC,borderMode=cv2.BORDER_CONSTANT,borderValue=(255,255,255))
        page_matrix = np.float64([[1,0,left],[0,1,top],[0,0,1]]) @ matrix
        result = Image.fromarray(cv2.warpPerspective(np.asarray(image),page_matrix,(w,h),borderValue=(255,255,255)))
        result.paste(Image.fromarray(straight), (int(left), int(top)))
        # If outer borders were not detected, include the geometrically established edges.
        edges = list(targets)
        if edges[0] > 12: edges.insert(0, 0.)
        if edges[-1] < th-13: edges.append(float(th-1))
        edges = [(v+top)/result.height for v in edges]
        return result, {'status':'rectified', 'method':'grid-perspective-curves-v1',
                        'source_quad':quad.tolist(), 'row_edges':edges,
                        'column_edges':[(v+left)/result.width for v in column_targets],
                        'table_bounds':[float(left)/result.width, edges[0], float(right)/result.width, edges[-1]]}
    return image.copy(), {'status':'needs_review', 'method':'deskew-only', 'row_edges':[],
                          'warning':'表の罫線を検出できません。画像と行の範囲を確認してください'}


def row_regions(config, metadata):
    """Never invent dates or shift later rows based on text recognition."""
    manual = config.get('row_edges')
    if manual:
        return manual, None
    top, bottom, count = config['top'], config['bottom'], config['row_count']
    edges = metadata.get('row_edges', [])
    tolerance = (bottom-top)/count * .35
    selected = [v for v in edges if top-tolerance <= v <= bottom+tolerance]
    if len(selected) == count+1 and abs(selected[0]-top) <= tolerance and abs(selected[-1]-bottom) <= tolerance:
        return selected, None
    return np.linspace(top, bottom, count+1).tolist(), '罫線と行数が一致しません。行境界を確認してください'


def clean_cell(image):
    """Remove only long printed rules; keep handwriting and the raw OCR text."""
    a = np.asarray(image.convert('RGB')).copy()
    binary = ink(image)
    h,w = binary.shape
    horizontal = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((1,max(20,round(w*.8))),np.uint8))
    vertical = cv2.morphologyEx(binary, cv2.MORPH_OPEN, np.ones((max(20,round(h*.9)),1),np.uint8))
    # Only near crop boundaries: don't erase a handwritten 1 in the middle of a cell.
    horizontal[max(2,h//10):h-max(2,h//10),:] = 0
    vertical[:,max(2,w//12):w-max(2,w//12)] = 0
    a[(horizontal|vertical)>0] = 255
    return Image.fromarray(a)


def recognition_image(image):
    """Illumination normalization only; the colour original is never replaced."""
    cleaned = clean_cell(image)
    gray = np.asarray(cleaned.convert('L'))
    background = cv2.GaussianBlur(gray,(0,0),max(5,min(gray.shape)/5))
    normalized = cv2.divide(gray,background,scale=255)
    return Image.fromarray(normalized).convert('RGB')
