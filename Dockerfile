# syntax=docker/dockerfile:1

# ---- Frontend: Next.js static export -> /build/frontend/out ----
FROM node:24-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json frontend/
RUN cd frontend && npm ci
# The frontend reads ../data/templates at build time, so data/ must sit next to frontend/.
COPY data data
COPY frontend frontend
RUN cd frontend && npm run build

# ---- Backend: FastAPI serving the API and the static frontend ----
FROM python:3.13-slim AS runtime
COPY --from=ghcr.io/astral-sh/uv:0.13 /uv /usr/local/bin/uv
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1
WORKDIR /app
COPY backend/pyproject.toml backend/uv.lock backend/.python-version ./
RUN uv sync --frozen --no-dev
COPY backend/app ./app
COPY --from=frontend /build/frontend/out ./static

# The database lives inside the container and is recreated on every start.
ENV PATH="/app/.venv/bin:$PATH" \
    PRELEGAL_STATIC_DIR=/app/static \
    PRELEGAL_DB_PATH=/tmp/prelegal.db
# Non-root user; the app only writes the database under /tmp, so /app stays root-owned.
RUN useradd --system --no-create-home app
USER app
EXPOSE 8000
HEALTHCHECK --interval=10s --timeout=3s --start-period=5s \
    CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/health')"]
CMD ["uvicorn", "app.main:create_app", "--factory", "--host", "0.0.0.0", "--port", "8000"]
