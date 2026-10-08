# Single-service image: the API also serves the built frontend (same origin, no CORS).
# Used by the one-click Render deployment (render.yaml). Local development uses docker-compose.yml.
FROM node:22-alpine AS web
WORKDIR /repo
COPY package.json package-lock.json ./
COPY design-system/package.json design-system/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY design-system design-system
COPY frontend frontend
RUN npm -w frontend run build

FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 STATIC_DIR=/app/static
WORKDIR /app
COPY backend/requirements.txt .
RUN pip install -r requirements.txt
COPY backend/ .
COPY --from=web /repo/frontend/dist /app/static
RUN useradd --create-home --uid 1000 isker && chmod +x docker-entrypoint.sh
USER isker
EXPOSE 8000
ENTRYPOINT ["./docker-entrypoint.sh"]
