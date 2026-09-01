# syntax=docker/dockerfile:1.4
# Build from repo root: docker build -f web/Dockerfile .

FROM node:22-alpine AS build
WORKDIR /app

# file: dep resolves to /packages/page-projection (sibling of /app)
COPY packages/page-projection /packages/page-projection
WORKDIR /packages/page-projection
RUN npm install --no-save typescript@5.4.5 && npm run build

WORKDIR /app
COPY web/package.json web/package-lock.json ./
RUN npm ci

COPY web/ ./

ARG VITE_SPECULUM_TRANSPORT_ORIGIN=
ENV VITE_SPECULUM_TRANSPORT_ORIGIN=$VITE_SPECULUM_TRANSPORT_ORIGIN

RUN npm run build

FROM nginx:alpine
RUN apk add --no-cache wget
COPY web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
