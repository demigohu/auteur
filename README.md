# Auteur Labs

AI agent video editor: kamu memberi arahan seperti ke editor manusia, agen mengedit di timeline karena dia melihat dan mendengar footage-mu. Dibangun untuk Meta Global AI Developer Hackathon. Detail produk ada di [docs/PRD.md](docs/PRD.md).

## Struktur

- `web/`: editor (Next.js, Remotion Player, Zustand)
- `api/`: agen dan pemrosesan video (FastAPI, Meta Model API, ffmpeg, OpenCV)
- `docs/`: PRD

## Menjalankan

Butuh Node 24+, [uv](https://docs.astral.sh/uv/), dan ffmpeg.

```bash
cp api/.env.example api/.env   # isi META_API_KEY
make install
make dev                       # web di :3000, api di :8000
```
