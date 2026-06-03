FROM --platform=linux/amd64 node:20-slim AS builder
WORKDIR /app
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY backend/package*.json ./backend/
RUN cd backend && npm ci
COPY backend/ ./backend/
RUN cd backend && npm run build

FROM --platform=linux/amd64 node:20-slim
WORKDIR /app
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY frontend/ ./frontend/
EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0
CMD ["node", "backend/dist/server.js"]
