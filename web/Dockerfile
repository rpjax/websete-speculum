# syntax=docker/dockerfile:1.4

FROM node:22-alpine AS build
WORKDIR /app

ARG VITE_API_URL=https://api.speculum.localhost
ENV VITE_API_URL=$VITE_API_URL

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM nginx:alpine
RUN apk add --no-cache wget
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

# Substitute API origin placeholders for CSP connect-src
ARG VITE_API_URL=https://api.speculum.localhost
RUN if echo "$VITE_API_URL" | grep -q '^https:'; then \
      API_ORIGIN="$VITE_API_URL"; \
      API_WS=$(echo "$VITE_API_URL" | sed 's#^https:#wss:#'); \
    else \
      API_ORIGIN="$VITE_API_URL"; \
      API_WS=$(echo "$VITE_API_URL" | sed 's#^http:#ws:#'); \
    fi \
 && sed -i "s|__API_ORIGIN__|$API_ORIGIN|g" /etc/nginx/conf.d/default.conf \
 && sed -i "s|__API_ORIGIN_WS__|$API_WS|g" /etc/nginx/conf.d/default.conf

EXPOSE 80
