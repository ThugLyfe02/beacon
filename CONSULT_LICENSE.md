# Avatar provider licensing — read before paid launch

Beacon currently generates photoreal 3D avatars by calling
[`tencent/hunyuan-3d-3.1`](https://replicate.com/tencent/hunyuan-3d-3.1)
on Replicate. The model is published under the **TENCENT HUNYUAN
NON-COMMERCIAL LICENSE AGREEMENT**. Replicate hosting the model does
**not** grant downstream commercial rights — the license travels with
the model output.

What this means for Beacon

- **Personal / research / demo use:** allowed. Friend TestFlight, internal
  validation, conference demos all fine.
- **Commercial use (paid app, ad revenue, B2B contract):** requires a
  separate commercial agreement with Tencent **or** swapping to a model
  with a commercial-permissive licence.

Decision points before flipping the paid switch

1. **Stay on Hunyuan + commercial agreement.** Contact
   `hunyuan3d@tencent.com` (per the model card on Hugging Face). Pricing
   is bespoke; expect weeks of paperwork.
2. **Pivot to Meshy.ai** (`MESHY_API_KEY` is already wired as the legacy
   backend in `supabase/functions/avatar-generate/index.ts`). Meshy's
   pricing tiers are commercial-OK out of the box; switch by unsetting
   `REPLICATE_API_TOKEN` and setting `MESHY_API_KEY` in
   `supabase/functions/.env`.
3. **Self-host TRELLIS** (Microsoft, Apache-2). Requires a CUDA GPU
   (≥12 GB VRAM). Wire the same `BEACON_AVATAR_GPU_URL` env we use for
   the bundled TripoSR fallback in `infra/triposr/`. Long lead time but
   no per-avatar cost after the GPU is paid off.

How the codebase picks a backend today

`supabase/functions/avatar-generate/index.ts` checks for backend env
keys in this order:

1. `REPLICATE_API_TOKEN` → routes to `tencent/hunyuan-3d-3.1` (current
   default; non-commercial)
2. `BEACON_AVATAR_GPU_URL` + `BEACON_AVATAR_GPU_SECRET` → self-hosted
   TripoSR or TRELLIS over HTTP
3. `MESHY_API_KEY` → Meshy.ai

Flipping providers is a single env change in
`supabase/functions/.env`. No code change required to ship Meshy.
