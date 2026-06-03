FROM node:20-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY backend/package*.json ./backend/
RUN cd backend && npm ci
COPY backend/ ./backend/
RUN cd backend && npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/backend/dist ./backend/dist
COPY --from=builder /app/backend/node_modules ./backend/node_modules
COPY frontend/ ./frontend/
EXPOSE 3000
ENV PORT=3000
ENV HOST=0.0.0.0
CMD ["node", "backend/dist/server.js"]
