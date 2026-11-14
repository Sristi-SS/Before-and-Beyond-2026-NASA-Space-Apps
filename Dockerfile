# AI-assistance: this file was written with AI assistance; see README.md "AI assistance".
# UNTESTED: docker was not available when this was written. See docs/DEPLOY.md.

# ---- stage 1: build the frontend ------------------------------------------
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- stage 2: python runtime ----------------------------------------------
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 \
    SPHEREX_HOST=0.0.0.0 \
    SPHEREX_DATA_DIR=/app/data \
    PORT=8000
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/ ./backend/
COPY --from=web /web/dist ./frontend/dist
# Saved demo cubes (real archive images).  A mounted disk at /app/data/cache replaces them.
COPY demo_cache/ ./data/cache/
EXPOSE 8000
CMD ["python", "-m", "backend.app"]
