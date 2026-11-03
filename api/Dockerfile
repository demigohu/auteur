# Built from the repository root (see docker-compose.yml): the API also needs motion/, the Remotion
# renderer for videos made in code. Ignore rules: api/Dockerfile.dockerignore.
FROM python:3.12-slim-bookworm

# ffmpeg for media processing and rendering; glib for OpenCV. Subtitle fonts ship in assets/.
# The rest are the libraries Chrome Headless Shell needs; Remotion renders scenes with it.
RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg libglib2.0-0 \
       libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libgbm1 libasound2 libxrandr2 libxkbcommon0 \
       libxfixes3 libxcomposite1 libxdamage1 libpango-1.0-0 libcairo2 libcups2 libdrm2 libexpat1 \
    && rm -rf /var/lib/apt/lists/*

# Node for motion/render.mjs.
COPY --from=node:24-bookworm-slim /usr/local/bin/node /usr/local/bin/node
COPY --from=node:24-bookworm-slim /usr/local/lib/node_modules /usr/local/lib/node_modules
RUN ln -s /usr/local/lib/node_modules/npm/bin/npm-cli.js /usr/local/bin/npm

WORKDIR /app/motion
COPY motion/package.json motion/package-lock.json ./
RUN npm ci --omit=dev
COPY motion/ ./
# Download Chrome Headless Shell and prebuild the host bundle now, so the first scene renders fast.
RUN node -e "require('@remotion/renderer').ensureBrowser().then(() => console.log('browser ready'))" \
    && node render.mjs --bundle

COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /usr/local/bin/uv
ENV UV_PYTHON_DOWNLOADS=never UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy

WORKDIR /app
COPY api/pyproject.toml api/uv.lock api/.python-version ./
RUN uv sync --frozen --no-dev --no-install-project
COPY api/assets ./assets
COPY api/src ./src
RUN uv sync --frozen --no-dev

ENV AUTEUR_DATA_DIR=/data AUTEUR_MOTION_DIR=/app/motion MOTION_PARALLEL_RENDERS=1
VOLUME /data
EXPOSE 8000

# Behind Caddy: trust X-Forwarded-For so per-visitor quotas see the real client IP.
CMD ["uv", "run", "--no-sync", "uvicorn", "auteur.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips", "*"]
