FROM node:24-slim

# build tools for better-sqlite3 (uses prebuilt binaries when available)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev

COPY server ./server
COPY public ./public
COPY content ./content

ENV PORT=3000 \
    DB_PATH=/app/data/app.db

EXPOSE 3000
VOLUME ["/app/data"]

CMD ["node", "server/server.js"]
