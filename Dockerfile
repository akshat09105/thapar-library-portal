# Production Dockerfile for Thapar Smart Library Portal (Scalable SQL Engine)
FROM node:22-alpine

# Set production environment variables
ENV NODE_ENV=production \
    PORT=3000 \
    DB_PATH=/app/data/library.db

WORKDIR /app

# Install native build dependencies for SQLite, compile, then purge build tools to keep image small
RUN apk add --no-cache python3 make g++

# Prepare persistent data directory with proper non-root permissions
RUN mkdir -p /app/data && chown -R node:node /app

# Install production dependencies
COPY --chown=node:node package*.json ./
RUN npm ci --omit=dev

# Remove build tools to save image size
RUN apk del python3 make g++

# Copy application files
COPY --chown=node:node . .

# Run as non-root user for security
USER node

# Expose server port
EXPOSE 3000

# Health check using the /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:${PORT}/health || exit 1

# Start server directly with node for proper SIGTERM signal handling
CMD ["node", "server.js"]