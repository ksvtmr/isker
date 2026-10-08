# Build context: repository root (the frontend depends on the design-system workspace).
FROM node:22-alpine AS build
WORKDIR /repo
COPY package.json package-lock.json ./
COPY design-system/package.json design-system/
COPY frontend/package.json frontend/
RUN npm ci --no-audit --no-fund
COPY design-system design-system
COPY frontend frontend
RUN npm -w frontend run build

FROM nginx:1.27-alpine
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /repo/frontend/dist /usr/share/nginx/html
EXPOSE 80
