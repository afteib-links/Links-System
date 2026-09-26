FROM python:3.11.13-slim-bookworm
ENV PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1 OPENBLAS_NUM_THREADS=1 MKL_NUM_THREADS=1 \
    PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK=True
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 libglib2.0-0 libgl1 \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /worker
COPY ocr/requirements.lock ./
RUN pip install --no-cache-dir -r requirements.lock
COPY ocr/fetch_models.py ./
RUN python fetch_models.py
COPY ocr/worker.py ./
COPY ocr/geometry.py ocr/documents.py ocr/layout.py ./
CMD ["python", "worker.py"]
