"""Only synthetic documents. No customer fixtures."""
import unittest
import cv2
import numpy as np
from PIL import Image, ImageDraw
from geometry import rectify, row_regions


class GeometryTests(unittest.TestCase):
    def sheet(self):
        im=Image.new('RGB',(800,1000),'white')
        draw=ImageDraw.Draw(im)
        for y in range(100,901,40): draw.line((80,y,720,y),fill='black',width=2)
        for x in [80,150,340,530,720]: draw.line((x,100,x,900),fill='black',width=2)
        for y in range(115,900,40): draw.text((170,y),'08:00',fill='black')
        return im

    def test_perspective_and_curvature(self):
        source=np.asarray(self.sheet())
        h,w=source.shape[:2]
        mx=np.broadcast_to(np.arange(w,dtype=np.float32),(h,w)).copy()
        my=np.broadcast_to(np.arange(h,dtype=np.float32)[:,None],(h,w)).copy()
        my+=10*np.sin(mx/w*np.pi)
        mx+=7*np.sin(my/h*np.pi)
        curved=cv2.remap(source,mx,my,cv2.INTER_LINEAR,borderValue=(255,255,255))
        matrix=cv2.getPerspectiveTransform(np.float32([[0,0],[799,0],[799,999],[0,999]]),np.float32([[40,20],[770,55],[795,980],[10,940]]))
        skewed=Image.fromarray(cv2.warpPerspective(curved,matrix,(w,h),borderValue=(255,255,255)))
        corrected,meta=rectify(skewed)
        self.assertEqual(meta['status'],'rectified')
        self.assertEqual(len(meta['row_edges']),21)
        self.assertEqual(corrected.size,skewed.size)
        self.assertGreaterEqual(len(meta['column_edges']),3)
        # Rules in the saved image must actually lie near the reported Y coordinates.
        gray=np.asarray(corrected.convert('L'))
        left,_,right,_=meta['table_bounds']
        for edge in meta['row_edges'][1:-1]:
            y=round(edge*h)
            band=gray[max(0,y-3):y+4,round(left*w)+10:round(right*w)-10]
            self.assertGreater(np.mean(np.min(band,axis=0)<160),.80)

    def test_heading_after_extra_top_rule(self):
        from layout import propose
        class Engine:
            def predict(self, _image):
                yield {'rec_texts':['日 付','業務稼働時間','未知列'],
                       'rec_polys':[[[85,145],[140,145],[140,160],[85,160]],[[160,145],[330,145],[330,160],[160,160]],[[540,145],[700,145],[700,160],[540,160]]]}
        image=self.sheet()
        geometry={'row_edges':[y/1000 for y in range(100,901,40)],'column_edges':[.1,.1875,.425,.6625,.9]}
        result=propose(image,geometry,Engine())
        self.assertEqual(result['top'],.18)
        self.assertIn('work_date',result['columns'])
        self.assertIn('work_interval',result['columns'])
        self.assertTrue(any(k.startswith('extra_') for k in result['columns']))
        self.assertTrue(result['needs_confirmation'])

    def test_fallback_and_row_count(self):
        _,meta=rectify(Image.new('RGB',(800,1000),'white'))
        self.assertEqual(meta['status'],'needs_review')
        config={'top':.1,'bottom':.9,'row_count':3}
        edges,warning=row_regions(config,{'row_edges':[.1,.3,.6,.9]})
        self.assertIsNone(warning)
        self.assertEqual(edges,[.1,.3,.6,.9])
        _,warning=row_regions(config,{'row_edges':[.1,.9]})
        self.assertIsNotNone(warning)


if __name__=='__main__': unittest.main()
