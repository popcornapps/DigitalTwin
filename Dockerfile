# Single-container build: React frontend -> static build; FastAPI backend
# serves that build directly (see backend/app/main.py's STATIC_DIR mount) -
# same origin as the API, so the session cookie set by /api/auth/callback
# works with no cross-origin/proxy configuration needed in production.

# ---------- Frontend build ----------
# Pinned to the build machine's own platform (not the final target) - the
# output is just static JS/CSS/HTML, so it's platform-independent, and
# running esbuild under QEMU emulation for a cross-platform build is flaky
# (crashes with "The service was stopped").
FROM --platform=$BUILDPLATFORM node:20-alpine AS frontend-build
WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---------- Backend + ML model ----------
FROM python:3.14-slim AS backend
WORKDIR /app

# libgomp1: scikit-learn's compiled wheels need it (OpenMP) on Debian slim -
# without it, `import sklearn` fails at joblib.load() time.
# libpq-dev/build-essential: psycopg2-binary has no prebuilt wheel for this
# Python version yet, so pip compiles it from source - build-essential (not
# just gcc) is needed for the standard C headers (assert.h etc).
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgomp1 libpq-dev build-essential \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
COPY backend/data ./data

# Only the two models actually loaded at runtime (app/state.py,
# app/live/kpi_prediction_agent.py) - the plain (non-12param) siblings are
# unreferenced leftovers from an earlier cutover, not worth the extra ~430MB.
COPY backend/models/paracetamol_random_forest_12param.joblib \
     backend/models/paracetamol_random_forest_12param_manifest.json \
     backend/models/synthetic_kpi_random_forest_12param.joblib \
     backend/models/synthetic_kpi_random_forest_12param_manifest.json \
     ./models/

COPY --from=frontend-build /app/frontend/dist ./static

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
