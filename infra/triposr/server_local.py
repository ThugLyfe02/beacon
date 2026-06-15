"""
TripoSR inference server — local MPS / CPU variant for Mac development.
Same API shape as server.py (the Docker/CUDA version) so the avatar-generate /
avatar-status edge functions don't care which one is running.
"""

import asyncio
import base64
import io
import os
import secrets as secrets_mod
import time
import uuid
from pathlib import Path
from typing import Dict, Optional

import numpy as np
import rembg
import torch
import trimesh
from fastapi import BackgroundTasks, FastAPI, Header, HTTPException
from fastapi.responses import FileResponse
from PIL import Image
from pydantic import BaseModel, Field
from tsr.bake_texture import bake_texture
from tsr.system import TSR
from tsr.utils import remove_background, resize_foreground

_rembg_session = rembg.new_session()
TEXTURE_RESOLUTION = 1024

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
SHARED_SECRET = os.environ.get("BEACON_SHARED_SECRET", "dev-local-secret")
OUTPUT_DIR = Path(os.environ.get("OUTPUT_DIR", str(Path(__file__).parent / "outputs")))
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


def pick_device() -> str:
    if torch.backends.mps.is_available():
        return "mps"
    if torch.cuda.is_available():
        return "cuda"
    return "cpu"


DEVICE = pick_device()
print(f"[boot] device = {DEVICE}", flush=True)

# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------
_model: Optional[TSR] = None


def get_model() -> TSR:
    global _model
    if _model is None:
        print("[boot] loading TripoSR weights…", flush=True)
        m = TSR.from_pretrained(
            "stabilityai/TripoSR",
            config_name="config.yaml",
            weight_name="model.ckpt",
        )
        # Lower chunk size to fit unified-memory M-series GPUs.
        m.renderer.set_chunk_size(4096)
        m.to(DEVICE)
        _model = m
        print("[boot] model ready", flush=True)
    return _model


# ---------------------------------------------------------------------------
# Job state
# ---------------------------------------------------------------------------
class Job(BaseModel):
    status: str = Field(default="PENDING")
    progress: int = 0
    glb_filename: Optional[str] = None
    error: Optional[str] = None
    created_at: float = Field(default_factory=time.time)


_jobs: Dict[str, Job] = {}
_jobs_lock = asyncio.Lock()


class StartJobBody(BaseModel):
    image_b64: str = Field(..., description="raw or 'data:image/...' base64-encoded image")


class StartJobResponse(BaseModel):
    task_id: str


class JobStatusResponse(BaseModel):
    status: str
    progress: int
    glb_url: Optional[str] = None
    error: Optional[str] = None


app = FastAPI(title="Beacon TripoSR Inference (local)")


def _auth(authorization: Optional[str]) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing bearer")
    if not secrets_mod.compare_digest(authorization.split(" ", 1)[1], SHARED_SECRET):
        raise HTTPException(status_code=401, detail="Bad secret")


def _decode_image(image_b64: str) -> Image.Image:
    if image_b64.startswith("data:"):
        image_b64 = image_b64.split(",", 1)[1]
    raw = base64.b64decode(image_b64)
    return Image.open(io.BytesIO(raw))


def _run_inference(task_id: str, image: Image.Image) -> None:
    """Blocking. Runs in a background thread."""
    try:
        model = get_model()
        _jobs[task_id].status = "IN_PROGRESS"
        _jobs[task_id].progress = 10

        # Pipeline matches official run.py:
        #   1. remove_background → RGBA
        #   2. resize_foreground (center + 85% scale)
        #   3. RGBA → RGB composite onto a 0.5-gray background
        rgba = remove_background(image.convert("RGB"), _rembg_session)
        rgba = resize_foreground(rgba, 0.85)
        arr = np.array(rgba).astype(np.float32) / 255.0
        rgb = arr[:, :, :3] * arr[:, :, 3:4] + (1 - arr[:, :, 3:4]) * 0.5
        composed = Image.fromarray((rgb * 255.0).astype(np.uint8))

        _jobs[task_id].progress = 30

        with torch.no_grad():
            scene_codes = model([composed], device=DEVICE)
            _jobs[task_id].progress = 70
            # Use vertex colors. Texture baking produces a more accurate
            # photo-on-head look, but three's RN GLTFLoader can't decode
            # the embedded base64 PNG, so textures get dropped client-side.
            # Vertex colors travel reliably through the same pipeline.
            meshes = model.extract_mesh(scene_codes, True, resolution=192)

        _jobs[task_id].progress = 90

        out_path = OUTPUT_DIR / f"{task_id}.glb"
        meshes[0].export(str(out_path), file_type="glb")

        _jobs[task_id].glb_filename = out_path.name
        _jobs[task_id].progress = 100
        _jobs[task_id].status = "SUCCEEDED"
    except Exception as exc:  # noqa: BLE001
        import traceback
        traceback.print_exc()
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
    except Exception as exc:
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
