# syntax=docker/dockerfile:1.4

FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_SPECULUM_TRANSPORT_ORIGIN=
ENV VITE_SPECULUM_TRANSPORT_ORIGIN=$VITE_SPECULUM_TRANSPORT_ORIGIN

RUN npm run build

FROM nginx:alpine
RUN apk add --no-cache wget
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
