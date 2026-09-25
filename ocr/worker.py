"""One persisted PDF job at a time. The runtime network has no Internet route."""
import json
import hashlib
import math
import os
import pathlib
import resource
import time
import uuid

import numpy as np
import pymysql
import pypdfium2 as pdfium
from PIL import Image, ImageOps

ROOT = pathlib.Path(os.environ.get('DAILY_REPORT_IMPORT_DIR', '/app/uploads/daily-report-imports')).resolve()
ROOT.mkdir(parents=True, exist_ok=True)
PIPELINE = None


def dumps(value):
    return json.dumps(value, ensure_ascii=False)


def safe_path(value):
    target = pathlib.Path(value).resolve()
    if ROOT not in target.parents:
        raise ValueError('File is outside import storage')
    return target


def write_image(image, name):
    target = safe_path(ROOT / name)
    temporary = target.with_suffix('.tmp')
    image.save(temporary, format='PNG')
    temporary.replace(target)
    return str(target)


def pipeline():
    global PIPELINE
    if PIPELINE is None:
        if os.environ.get('OCR_MANUAL_ONLY') == '1':
            raise RuntimeError('Manual review mode')
        from paddleocr import PaddleOCR
        PIPELINE = PaddleOCR(
            ocr_version='PP-OCRv5', device='cpu', cpu_threads=1, enable_mkldnn=False,
            text_detection_model_name='PP-OCRv5_mobile_det',
            text_detection_model_dir='/models/PP-OCRv5_mobile_det',
            text_recognition_model_name='PP-OCRv5_mobile_rec',
            text_recognition_model_dir='/models/PP-OCRv5_mobile_rec',
            use_doc_orientation_classify=False, use_doc_unwarping=False, use_textline_orientation=False,
            text_recognition_batch_size=1,
        )
    return PIPELINE


def deskew(image):
    import cv2
    grayscale = np.asarray(image.convert('L'))
    edges = cv2.Canny(grayscale, 50, 150)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 1800, threshold=100,
                            minLineLength=image.width * .3, maxLineGap=20)
    angles = []
    if lines is not None:
        for line in lines[:, 0]:
            angle = math.degrees(math.atan2(int(line[3]) - int(line[1]), int(line[2]) - int(line[0])))
            if abs(angle) < 8:
                angles.append(angle)
    angle = float(np.median(angles)) if angles else 0.0
    return image.rotate(angle, resample=Image.Resampling.BICUBIC, fillcolor='white'), angle


def read_cell(engine, crop):
    # Padding prevents handwriting that touches a table border from being clipped.
    padded = ImageOps.expand(crop.convert('RGB'), border=12, fill='white')
    result = next(iter(engine.predict(np.asarray(padded))))
    texts = result.get('rec_texts', [])
    scores = result.get('rec_scores', [])
    return ' '.join(texts), float(min(scores)) if len(scores) else 0.0


def execute_job(conn, job):
    started = time.monotonic()
    payload = json.loads(job['payload']) if isinstance(job['payload'], str) else job['payload']
    batch_id = job['daily_report_import_batch_id']
    with conn.cursor() as cursor:
        cursor.execute('SELECT * FROM daily_report_import_files WHERE daily_report_import_file_id=%s AND daily_report_import_batch_id=%s AND is_active=1 AND retention_until>=CURDATE()', (payload['source_file_id'], batch_id))
        file = cursor.fetchone()
    if not file:
        raise ValueError('Source file unavailable or expired')
    document = pdfium.PdfDocument(str(safe_path(file['storage_path'])))
    if not 1 <= len(document) <= 20:
        document.close()
        raise ValueError('PDF must contain 1 to 20 pages')
    configs = {p['page_number']: p for p in payload.get('template', {}).get('pages', [])}
    engine = None
    ocr_error = None
    if job['job_type'] == 'recognize':
        try:
            engine = pipeline()
        except Exception as error:
            ocr_error = type(error).__name__ + ': OCRを起動できないため原本で確認してください'
    row_number = 0
    try:
        for index in range(len(document)):
            config = configs.get(index + 1)
            if job['job_type'] == 'recognize' and not config:
                continue
            page = document[index]
            width, height = page.get_size()
            if max(width, height) > 12000 or min(width, height) <= 0:
                raise ValueError('Unsupported PDF page dimensions')
            bitmap = page.render(scale=min(150 / 72, 2200 / max(width, height)))
            image = bitmap.to_pil().convert('RGB')
            rotation = int(config.get('rotation', 0)) if config else 0
            angle = 0
            if rotation:
                image = image.rotate(-rotation, expand=True, fillcolor='white')
            if config and config.get('deskew', True):
                image, angle = deskew(image)
            page_path = write_image(image, f"{file['stored_filename']}-p{index + 1}.png")
            with conn.cursor() as cursor:
                cursor.execute('INSERT INTO daily_report_pdf_pages(source_file_id,page_number,image_path,width,height,rotation,deskew_angle) VALUES (%s,%s,%s,%s,%s,%s,%s) ON DUPLICATE KEY UPDATE image_path=VALUES(image_path),width=VALUES(width),height=VALUES(height),rotation=VALUES(rotation),deskew_angle=VALUES(deskew_angle)',
                               (file['daily_report_import_file_id'], index + 1, page_path, image.width, image.height, rotation, angle))
                cursor.execute('SELECT pdf_page_id FROM daily_report_pdf_pages WHERE source_file_id=%s AND page_number=%s', (file['daily_report_import_file_id'], index + 1))
                page_id = cursor.fetchone()['pdf_page_id']
            if config:
                for row_index in range(config['row_count']):
                    row_number += 1
                    with conn.cursor() as cursor:
                        cursor.execute('SELECT daily_report_import_row_id FROM daily_report_import_rows WHERE daily_report_import_batch_id=%s AND source_row_number=%s', (batch_id, row_number))
                        retained = cursor.fetchone()
                    conn.commit()
                    if retained:
                        continue
                    top = config['top'] + (config['bottom'] - config['top']) * row_index / config['row_count']
                    bottom = config['top'] + (config['bottom'] - config['top']) * (row_index + 1) / config['row_count']
                    bounds = [min(c[0] for c in config['columns'].values()), top, max(c[1] for c in config['columns'].values()), bottom]
                    crop = image.crop(tuple(round(v * (image.width if i % 2 == 0 else image.height)) for i, v in enumerate(bounds)))
                    row_path = write_image(crop, f"{file['stored_filename']}-p{index + 1}-r{row_index + 1}.png")
                    raw, confidence, regions = {}, {}, {}
                    for field, (left, right) in config['columns'].items():
                        regions[field] = [left, top, right, bottom]
                        raw[field], confidence[field] = '', 0.0
                        if engine:
                            cell = image.crop((round(left * image.width), round(top * image.height), round(right * image.width), round(bottom * image.height)))
                            try:
                                raw[field], confidence[field] = read_cell(engine, cell)
                            except Exception:
                                ocr_error = '読取りできない欄があります。原本で確認してください'
                            cell.close()
                    with conn.cursor() as cursor:
                        # A retried worker never changes an applied row or its original OCR value.
                        cursor.execute('SELECT daily_report_import_row_id FROM daily_report_import_rows WHERE daily_report_import_batch_id=%s AND source_row_number=%s', (batch_id, row_number))
                        if not cursor.fetchone():
                            fingerprint = hashlib.sha256(f"{file['sha256']}:{index + 1}:{row_index + 1}:{payload['project_id']}".encode()).hexdigest()
                            cursor.execute("INSERT INTO daily_report_import_rows(daily_report_import_batch_id,source_file_id,source_sheet,source_row_number,status,raw_data,parsed_data,validation_errors,validation_warnings,matched_project_id,matched_partner_id,pdf_page_id,source_region,ocr_confidence,source_image_path,extra_data,row_fingerprint) VALUES (%s,%s,%s,%s,'warning',%s,'{}','[]','[]',%s,%s,%s,%s,%s,%s,%s,%s)",
                                           (batch_id, file['daily_report_import_file_id'], str(index + 1), row_number, dumps(raw), payload['project_id'], payload.get('partner_id'), page_id, dumps({'row': bounds, 'fields': regions}), dumps(confidence), row_path, dumps({'ocr_error': ocr_error, 'parser': 'PP-OCRv5 mobile / PaddleOCR 3.2.0'}), fingerprint))
                        progress = round(100 * ((index + (row_index + 1) / config['row_count']) / len(document)))
                        cursor.execute('UPDATE daily_report_ocr_jobs SET progress=%s,heartbeat_at=NOW() WHERE ocr_job_id=%s', (progress, job['ocr_job_id']))
                    conn.commit()
                    crop.close()
                    if time.monotonic() - started > 1800:
                        raise TimeoutError('OCR timed out; retry resumes retained rows')
            image.close()
            bitmap.close()
            page.close()
        with conn.cursor() as cursor:
            cursor.execute("UPDATE daily_report_ocr_jobs SET status='completed',progress=100,finished_at=NOW(),error_message=%s,metrics=%s WHERE ocr_job_id=%s", (ocr_error, dumps({'seconds': round(time.monotonic() - started, 2), 'peak_rss_kb': resource.getrusage(resource.RUSAGE_SELF).ru_maxrss, 'rows': row_number, 'mode': 'ocr' if engine else 'manual'}), job['ocr_job_id']))
            cursor.execute("UPDATE daily_report_import_batches SET status=%s,row_count=(SELECT COUNT(*) FROM daily_report_import_rows r WHERE r.daily_report_import_batch_id=%s),parsed_at=NOW() WHERE daily_report_import_batch_id=%s", ('needs_review' if configs else 'uploaded', batch_id, batch_id))
        conn.commit()
    finally:
        document.close()


def run():
    while True:
        conn = None
        try:
            conn = pymysql.connect(host=os.environ.get('DB_HOST', 'db'), port=int(os.environ.get('DB_PORT', '3306')),
                                   user=os.environ['DB_USER'], password=os.environ['DB_PASSWORD'], database=os.environ['DB_NAME'],
                                   charset='utf8mb4', cursorclass=pymysql.cursors.DictCursor, autocommit=False)
            with conn.cursor() as cursor:
                cursor.execute("SELECT GET_LOCK('links_daily_report_ocr',0) owned")
                if cursor.fetchone()['owned'] != 1:
                    conn.close()
                    conn = None
                    time.sleep(5)
                    continue
                cursor.execute("UPDATE daily_report_ocr_jobs SET status=IF(attempts>=3,'failed','queued'),error_message='ワーカー再起動後に復旧しました' WHERE status='running'")
            conn.commit()
            while True:
                with conn.cursor() as cursor:
                    cursor.execute("SELECT * FROM daily_report_ocr_jobs WHERE status='queued' ORDER BY ocr_job_id LIMIT 1 FOR UPDATE")
                    job = cursor.fetchone()
                    if job:
                        cursor.execute("UPDATE daily_report_ocr_jobs SET status='running',attempts=attempts+1,started_at=NOW(),heartbeat_at=NOW() WHERE ocr_job_id=%s", (job['ocr_job_id'],))
                conn.commit()
                if not job:
                    time.sleep(2)
                    continue
                try:
                    execute_job(conn, job)
                except Exception as error:
                    conn.rollback()
                    with conn.cursor() as cursor:
                        cursor.execute("UPDATE daily_report_ocr_jobs SET status='failed',finished_at=NOW(),error_message=%s WHERE ocr_job_id=%s", (type(error).__name__ + ': 解析を再試行するか、原本を見て手入力してください', job['ocr_job_id']))
                        cursor.execute("UPDATE daily_report_import_batches SET status='failed' WHERE daily_report_import_batch_id=%s", (job['daily_report_import_batch_id'],))
                    conn.commit()
                    print('[ocr] job failed', job['ocr_job_id'], type(error).__name__, flush=True)
        except Exception as error:
            print('[ocr] worker reconnecting', type(error).__name__, flush=True)
            time.sleep(5)
        finally:
            if conn:
                conn.close()


if __name__ == '__main__':
    run()
