"""
TripoSR avatar inference server.

POST /jobs            → start a job, returns { task_id }
GET  /jobs/{task_id}  → status + glb URL when ready
GET  /downloads/...   → serve generated glb files

Auth: shared bearer token via env BEACON_SHARED_SECRET.
"""

import asyncio
import base64
import io
import os
import secrets
import time
import uuid
from pathlib import Path
from typing import Dict, Optional

import torch
import trimesh  # noqa: F401 (used by tsr.utils)
from fastapi import FastAPI, Header, HTTPException, BackgroundTasks
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel, Field
from rembg import remove
from tsr.system import TSR
from tsr.utils import remove_background, resize_foreground

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SHARED_SECRET = os.environ.get("BEACON_SHARED_SECRET", "")
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", "/data/outputs"))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"

if not SHARED_SECRET:
    raise RuntimeError("BEACON_SHARED_SECRET env var must be set")

# ---------------------------------------------------------------------------
# Model — loaded once on startup
# ---------------------------------------------------------------------------
print(f"[boot] loading TripoSR on {DEVICE}…", flush=True)
_model: Optional[TSR] = None


def get_model() -> TSR:
    global _model
    if _model is None:
        m = TSR.from_pretrained(
            "stabilityai/TripoSR",
            config_name="config.yaml",
            weight_name="model.ckpt",
        )
        m.renderer.set_chunk_size(8192)
        m.to(DEVICE)
        _model = m
    return _model


# ---------------------------------------------------------------------------
# Job state
# ---------------------------------------------------------------------------
class Job(BaseModel):
    status: str = Field(default="PENDING")  # PENDING|IN_PROGRESS|SUCCEEDED|FAILED
    progress: int = 0
    glb_filename: Optional[str] = None
    error: Optional[str] = None
    created_at: float = Field(default_factory=time.time)


_jobs: Dict[str, Job] = {}
_jobs_lock = asyncio.Lock()


# ---------------------------------------------------------------------------
# API models
# ---------------------------------------------------------------------------
class StartJobBody(BaseModel):
    image_b64: str = Field(..., description="raw or 'data:image/...' base64-encoded image")


class StartJobResponse(BaseModel):
    task_id: str


class JobStatusResponse(BaseModel):
    status: str
    progress: int
    glb_url: Optional[str] = None
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Beacon TripoSR Inference")


def _auth(authorization: Optional[str]) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer")
    if not secrets.compare_digest(authorization.split(" ", 1)[1], SHARED_SECRET):
        raise HTTPException(status_code=401, detail="Bad secret")


def _decode_image(image_b64: str) -> Image.Image:
    if image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1]
    raw = base64.b64decode(image_b64)
    return Image.open(io.BytesIO(raw)).convert("RGBA")


def _run_inference(task_id: str, image: Image.Image) -> None:
    """Blocking. Runs in a background thread."""
    try:
        model = get_model()
        _jobs[task_id].status = "IN_PROGRESS"
        _jobs[task_id].progress = 10

        # Background removal + resize → 512×512 with foreground centered.
        rgba = remove(image)
        rgba = resize_foreground(rgba, 0.85)
        composed = remove_background(rgba)

        _jobs[task_id].progress = 30

        with torch.no_grad():
            scene_codes = model([composed], device=DEVICE)
            _jobs[task_id].progress = 70
            meshes = model.extract_mesh(scene_codes, resolution=256)

        _jobs[task_id].progress = 90

        mesh = meshes[0]
        out_path = OUTPUT_DIR / f"{task_id}.glb"
        mesh.export(str(out_path), file_type="glb")

        _jobs[task_id].glb_filename = out_path.name
        _jobs[task_id].progress = 100
        _jobs[task_id].status = "SUCCEEDED"
    except Exception as exc:  # noqa: BLE001
        _jobs[task_id].status = "FAILED"
        _jobs[task_id].error = str(exc)


@app.post("/jobs", response_model=StartJobResponse)
async def start_job(
    body: StartJobBody,
    background: BackgroundTasks,
    authorization: Optional[str] = Header(None),
) -> StartJobResponse:
    _auth(authorization)
    try:
        image = _decode_image(body.image_b64)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=f"bad image: {exc}")

    task_id = uuid.uuid4().hex
    async with _jobs_lock:
        _jobs[task_id] = Job()
    background.add_task(_run_inference, task_id, image)
    return StartJobResponse(task_id=task_id)


@app.get("/jobs/{task_id}", response_model=JobStatusResponse)
def get_job(task_id: str, authorization: Optional[str] = Header(None)) -> JobStatusResponse:
    _auth(authorization)
    job = _jobs.get(task_id)
    if not job:
        raise HTTPException(status_code=404, detail="task not found")
    glb_url: Optional[str] = None
    if job.status == "SUCCEEDED" and job.glb_filename:
        # Public path served by FastAPI below. The edge function rewrites this
        # to a Supabase Storage signed URL before returning to the client if you
        # want stronger access control.
        glb_url = f"/downloads/{job.glb_filename}"
    return JobStatusResponse(
        status=job.status,
        progress=job.progress,
        glb_url=glb_url,
        error=job.error,
    )


@app.get("/downloads/{filename}")
def download(filename: str) -> FileResponse:
    path = OUTPUT_DIR / filename
    if not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(str(path), media_type="model/gltf-binary", filename=filename)


@app.get("/healthz")
def healthz() -> dict:
    return {"ok": True, "device": DEVICE, "jobs": len(_jobs)}
