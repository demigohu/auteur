FROM python:3.12-slim-bookworm

# ffmpeg for media processing and rendering; glib for OpenCV. Subtitle fonts ship in assets/.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=never UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY assets ./assets
COPY src ./src
RUN uv sync --frozen --no-dev

ENV AUTEUR_DATA_DIR=/data
VOLUME /data
EXPOSE 8000

# Behind Caddy: trust X-Forwarded-For so per-visitor quotas see the real client IP.
CMD ["uv", "run", "--no-sync", "uvicorn", "auteur.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
