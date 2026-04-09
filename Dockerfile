# ═══════════════════════════════════════════════════════════════
# ResumeXray — Production Dockerfile
# ═══════════════════════════════════════════════════════════════
# Multi-stage build for minimal production image.
# Uses Node.js 22 Alpine for smallest footprint (~150MB).
#
# Build:  docker build -t resumexray .
# Run:    docker run -p 3000:3000 --env-file .env resumexray
# ═══════════════════════════════════════════════════════════════

# ── Stage 1: Install dependencies ──────────────────────────────
FROM node:22-alpine AS deps

WORKDIR /app

# Install only production dependencies + native build tools for bcrypt
RUN apk add --no-cache python3 make g++

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# ── Stage 2: Production image ─────────────────────────────────
FROM node:22-alpine

# Security: run as non-root user
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

WORKDIR /app

# Install Playwright system deps (Chromium for PDF rendering)
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && rm -rf /var/cache/apk/*

# Tell Playwright to use system Chromium
ENV PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium-browser
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

# Copy production dependencies from stage 1
COPY --from=deps /app/node_modules ./node_modules

# Copy application code
COPY . .

# Remove development files
RUN rm -rf .git .env .env.* tests/ *.md deploy/ .github/

# Create tmp_uploads directory
RUN mkdir -p tmp_uploads && chown appuser:appgroup tmp_uploads

# Switch to non-root user
USER appuser

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/healthz || exit 1

# Start server
CMD ["node", "server.js"]
