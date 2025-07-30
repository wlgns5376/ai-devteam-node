# Multi-stage build for AI DevTeam Node.js application
# Stage 1: Build stage
FROM node:20-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    git

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./

# Install all dependencies (including dev dependencies for build)
RUN npm ci

# Copy source code
COPY src/ ./src/

# Build the application
RUN npm run build

# Stage 2: Production stage
FROM node:20-alpine AS production

# Install system dependencies
RUN apk add --no-cache \
    git \
    openssh-client \
    curl \
    bash \
    sudo

# Install GitHub CLI (Alpine Linux compatible)
RUN wget -O- https://github.com/cli/cli/releases/latest/download/gh_$(uname -s | tr '[:upper:]' '[:lower:]')_$(uname -m | sed 's/x86_64/amd64/').tar.gz | tar -xz -C /tmp \
    && mv /tmp/gh_*/bin/gh /usr/local/bin/ \
    && chmod +x /usr/local/bin/gh

# Install Claude CLI
# Install the official Claude CLI from npm
RUN npm install -g @anthropic-ai/cli || \
    echo "Warning: Claude CLI installation failed. Please install manually or ensure API access is configured."

# Create app user and group
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Create necessary directories with proper permissions
RUN mkdir -p /app/workspace /app/logs /app/config /app/state && \
    chown -R appuser:appgroup /app

# Create workspace directory that can be mounted as volume
RUN mkdir -p /workspace && \
    chown -R appuser:appgroup /workspace

# Switch to non-root user
USER appuser

# Set environment variables
ENV NODE_ENV=production
ENV WORKSPACE_DIR=/workspace
ENV LOG_LEVEL=info

# Expose any ports if needed (currently none specified)
# EXPOSE 3000

# Add health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD node -e "console.log('Health check: OK')" || exit 1

# Create startup script
COPY --chown=appuser:appgroup <<'EOF' /app/entrypoint.sh
#!/bin/bash
set -e

echo "=== AI DevTeam Starting ==="
echo "Node.js version: $(node --version)"
echo "npm version: $(npm --version)"
echo "Git version: $(git --version)"

# Check if GitHub CLI is available
if command -v gh &> /dev/null; then
    echo "GitHub CLI version: $(gh --version | head -n1)"
else
    echo "Warning: GitHub CLI not found"
fi

# Check if Claude CLI is available
if command -v claude &> /dev/null; then
    echo "Claude CLI is available"
else
    echo "Warning: Claude CLI not found - will need manual installation or API integration"
fi

# Initialize git config if not set (using environment variables)
if [ ! -z "$GIT_USER_NAME" ]; then
    git config --global user.name "$GIT_USER_NAME"
fi

if [ ! -z "$GIT_USER_EMAIL" ]; then
    git config --global user.email "$GIT_USER_EMAIL"
fi

# Set git to accept any host key (for automated cloning)
if [ ! -z "$GIT_ACCEPT_HOST_KEY" ] && [ "$GIT_ACCEPT_HOST_KEY" = "true" ]; then
    git config --global core.sshCommand "ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no"
fi

echo "=== Configuration Complete ==="
echo "Starting application..."

# Execute the main application
exec "$@"
EOF

# Make entrypoint executable
USER root
RUN chmod +x /app/entrypoint.sh
USER appuser

# Set entrypoint and default command
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["node", "dist/index.js"]

# Labels for metadata
LABEL maintainer="AI DevTeam"
LABEL description="AI-powered development automation system using Claude Code and GitHub CLI"
LABEL version="1.0.0"