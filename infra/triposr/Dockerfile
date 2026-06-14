# =============================================================================
# Beacon: self-hosted TripoSR avatar inference
# Single-image → photoreal glb. Designed for ~1 photo per minute on an L4/RTX
# 4090; scales horizontally by running multiple replicas behind a queue.
# =============================================================================
FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive \
    PYTHONUNBUFFERED=1 \
    HF_HOME=/cache/huggingface \
    TORCH_HOME=/cache/torch

RUN apt-get update && apt-get install -y --no-install-recommends \
      git \
      python3.10 \
      python3-pip \
      libglib2.0-0 \
      libgl1 \
      libxext6 \
      libsm6 \
      libxrender1 \
    && rm -rf /var/lib/apt/lists/*

RUN ln -sf /usr/bin/python3.10 /usr/bin/python

WORKDIR /app

COPY requirements.txt /app/requirements.txt
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r /app/requirements.txt

COPY server.py /app/server.py

# Pre-download the TripoSR weights so cold-start is instant.
RUN python -c "from huggingface_hub import snapshot_download; \
  snapshot_download(repo_id='stabilityai/TripoSR', cache_dir='/cache/huggingface')"

EXPOSE 8080
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "1"]
