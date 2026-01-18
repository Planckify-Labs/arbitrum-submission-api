# Build stage
FROM node:22-alpine AS builder

# Install pnpm globally
RUN npm i -g pnpm

WORKDIR /app

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install all dependencies (including dev for building)
RUN pnpm install --frozen-lockfile

# Copy all source code
COPY . .

# Create dummy .env for Prisma (excluded by .dockerignore)
RUN touch .env

# Generate Prisma client (after copying source)
RUN pnpm prisma generate

# Verify generated files exist
RUN ls -la generated/prisma/

# Build the application
RUN pnpm run build

# Prune dev dependencies
RUN pnpm prune --prod

# Production stage
FROM node:22-alpine AS production

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nestjs -u 1001

WORKDIR /app

# Copy built application (generated folder is compiled into dist/generated)
COPY --from=builder --chown=nestjs:nodejs /app/dist ./dist
COPY --from=builder --chown=nestjs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nestjs:nodejs /app/package.json ./
COPY --from=builder --chown=nestjs:nodejs /app/prisma ./prisma

# Set environment
ENV NODE_ENV=production

# Switch to non-root user
USER nestjs

# Expose port
EXPOSE 4000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:4000/health || exit 1

# Start the application
CMD ["node", "dist/src/main"]
