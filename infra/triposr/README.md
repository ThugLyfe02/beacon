# Beacon TripoSR avatar service

Self-hosted photoreal-3D-from-a-selfie. Replaces Meshy/Avaturn/RPM. You own
the pipeline; you pay only for GPU compute (typically $0.40–$1.00/hr).

## What it is

A small FastAPI server wrapping
[TripoSR](https://github.com/VAST-AI-Research/TripoSR) (MIT, by Stability AI
& Tripo3D). Single image in → glb out in ~30–60 s on an L4 or RTX 4090.

```
POST /jobs            → { task_id }
GET  /jobs/{task_id}  → { status, progress, glb_url }
GET  /downloads/X.glb → the model file
```

All endpoints require `Authorization: Bearer <BEACON_SHARED_SECRET>`.

## Deploy options (in increasing complexity)

### Option 1 — RunPod Serverless (recommended for low traffic)

1. Push the image:
   ```bash
   cd infra/triposr
   docker build -t <dockerhub-user>/beacon-triposr:latest .
   docker push <dockerhub-user>/beacon-triposr:latest
   ```
2. In RunPod → Serverless → "New Endpoint":
   - Image: `<dockerhub-user>/beacon-triposr:latest`
   - GPU type: L4 or RTX 4090 (cheapest options that finish in <60s)
   - Min workers: 0 (scale to zero between requests)
   - Max workers: 2
   - Env: `BEACON_SHARED_SECRET=<random-32-bytes>`
   - Port: 8080
3. Copy the endpoint URL (`https://api.runpod.ai/...`) — that's your
   `BEACON_AVATAR_GPU_URL`.

### Option 2 — Modal (pay-per-second, simpler)

A `modal-app.py` would wrap `server.py` with `@modal.web_endpoint`. Useful if
you want better cold-start behavior. Not included here yet.

### Option 3 — Plain Docker on a GPU VM (Lambda Labs, Hyperstack, your own)

```bash
docker run -d --gpus all \
  -p 8080:8080 \
  -e BEACON_SHARED_SECRET=<random-32-bytes> \
  -v /var/lib/beacon-avatars:/data \
  <dockerhub-user>/beacon-triposr:latest
```

Expose 8080 publicly (Caddy with auto-TLS in front recommended).

## Wire it up to Supabase

```bash
supabase secrets set \
  BEACON_AVATAR_GPU_URL=https://<your-deploy-host> \
  BEACON_AVATAR_GPU_SECRET=<the-same-random-32-bytes>
supabase functions deploy avatar-generate
supabase functions deploy avatar-status
```

Done. The Beacon app already calls these functions; no client changes needed.

## Costs (Jun 2026 spot prices)

| GPU | $/hr | seconds/avatar | ~$/avatar |
|---|---|---|---|
| L4 (RunPod) | $0.44 | ~50 | $0.0061 |
| RTX 4090 (RunPod) | $0.34 | ~30 | $0.0028 |
| A100 (Modal) | $1.10 | ~10 | $0.0031 |

For comparison Meshy retail is $0.20–0.50/avatar — you save ~95%.

## Troubleshooting

- **First request is slow** — the model loads on first call. RunPod cold-start
  ~30s. Use min_workers=1 if you want hot.
- **Out of GPU memory** — lower `model.renderer.set_chunk_size(8192)` to 4096
  in `server.py`.
- **Black/grey avatars** — input photo needs good lighting + clean background.
  `rembg` does foreground masking but isn't magic.

## Replacing TripoSR with Hunyuan3D-2

Hunyuan3D-2 produces higher quality but takes longer (~2 min on A100) and the
container is ~6 GB. To swap, replace `tsr` imports in `server.py` with the
Hunyuan3D pipeline; keep the same FastAPI routes.
