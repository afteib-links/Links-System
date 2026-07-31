# Links-System アプリ容器（SPA静的配信 + API）
# QNAP TS-464 は x86_64 のため公式 amd64 イメージを使用。
FROM node:20-slim

WORKDIR /app

# 依存インストール（バックエンドのみ実行時依存を持つ）
COPY backend/package*.json ./backend/
RUN cd backend && npm install --omit=dev

# ソース一式
COPY backend ./backend
COPY frontend ./frontend
COPY db ./db

ENV APP_PORT=3000
EXPOSE 3000

CMD ["node", "backend/src/index.js"]
