FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production
ENV TZ=Asia/Tokyo

COPY backend/package.json backend/package-lock.json* ./backend/
WORKDIR /app/backend
RUN npm install --omit=dev && npx playwright install --with-deps chromium
RUN apt-get update \
  && apt-get install -y --no-install-recommends fonts-morisawa-bizud-gothic \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY backend ./backend
COPY frontend ./frontend
COPY db ./db

RUN mkdir -p /app/uploads /app/pdf

WORKDIR /app/backend
EXPOSE 3000

CMD ["node", "src/server.js"]
