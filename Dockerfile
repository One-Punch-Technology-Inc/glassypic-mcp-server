FROM node:22-alpine AS build

WORKDIR /app

# Install build dependencies cache layer early
COPY package.json package-lock.json ./
COPY packages/mcp-server/package.json ./packages/mcp-server/
RUN npm ci -w packages/mcp-server

# Copy source for compilation
COPY packages/mcp-server/tsconfig.json ./packages/mcp-server/
COPY packages/mcp-server/src/ ./packages/mcp-server/src/
RUN npm run -w packages/mcp-server build

FROM node:22-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 appgroup && adduser -u 1001 -G appgroup -S appuser

# Copy package files and install production dependencies; set ownership in one layer
COPY package.json package-lock.json ./
COPY packages/mcp-server/package.json ./packages/mcp-server/
RUN npm ci -w packages/mcp-server --omit=dev && chown -R appuser:appgroup /app

# Copy built artifacts with correct ownership
COPY --chown=appuser:appgroup --from=build /app/packages/mcp-server/dist/ ./packages/mcp-server/dist/

USER appuser

# Express includes stack traces in error responses unless NODE_ENV is "production".
ENV NODE_ENV=production

WORKDIR /app/packages/mcp-server

EXPOSE 8080

ENTRYPOINT ["node", "dist/index.js"]
