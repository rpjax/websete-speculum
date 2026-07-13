# syntax=docker/dockerfile:1.4
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
COPY server.mjs selfsigned.mjs ./
EXPOSE 443 8090
ENV PORT=443 HEALTH_PORT=8090 FIXTURE_ROLE=good FIXTURE_HOSTNAME=fixture.test
HEALTHCHECK --interval=5s --timeout=3s --start-period=5s --retries=10 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.HEALTH_PORT||8090)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.mjs"]
