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
COPY package*.json pnpm-lock.yaml ./
COPY tsconfig.json ./

# Install pnpm and dependencies (including dev dependencies for build)
RUN npm install -g pnpm && pnpm install --frozen-lockfile

# Copy source code
COPY src/ ./src/

# Build the application
RUN pnpm run build

# Stage 2: Production stage
FROM node:20-alpine AS production

# Install system dependencies
RUN apk add --no-cache \
    git \
    openssh-client \
    curl \
    bash \
    sudo

# Install utilities
RUN apk add --no-cache \
    wget \
    jq \
    tree

# Install GitHub CLI (Alpine Linux compatible)
RUN ARCH=$(uname -m | sed -e 's/x86_64/amd64/' -e 's/aarch64/arm64/') && \
    GH_VERSION="2.76.2" && \
    wget -O /tmp/gh.tar.gz "https://github.com/cli/cli/releases/download/v${GH_VERSION}/gh_${GH_VERSION}_linux_${ARCH}.tar.gz" && \
    tar -xzf /tmp/gh.tar.gz -C /tmp && \
    mv /tmp/gh_${GH_VERSION}_linux_${ARCH}/bin/gh /usr/local/bin/ && \
    chmod +x /usr/local/bin/gh && \
    rm -rf /tmp/gh*

# Install Claude CLI
# Install the official Claude CLI from npm
RUN npm install -g @anthropic-ai/claude-code || \
    echo "Warning: Claude CLI installation failed. Please install manually or ensure API access is configured."

# Install task-master-ai for MCP support
RUN npm install -g task-master-ai || \
    echo "Warning: task-master-ai installation failed. MCP features may not be available."

# Create app user and group
RUN addgroup -g 1001 -S appgroup && \
    adduser -S appuser -u 1001 -G appgroup && \
    addgroup appuser wheel

# Configure sudo for wheel group (no password required)
RUN echo "%wheel ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

# Set working directory
WORKDIR /app

# Copy package files and install production dependencies
COPY package*.json pnpm-lock.yaml ./
RUN npm install -g pnpm && pnpm install --prod --frozen-lockfile && pnpm store prune

# Copy built application from builder stage
COPY --from=builder /app/dist ./dist

# Copy MCP configuration and initialization script
COPY --chown=appuser:appgroup .mcp.json /app/.mcp.json
COPY --chown=appuser:appgroup scripts/init-mcp.sh /app/scripts/init-mcp.sh
RUN chmod +x /app/scripts/init-mcp.sh

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

# Check if GitHub CLI is available and configure authentication
if command -v gh &> /dev/null; then
    echo "GitHub CLI version: $(gh --version | head -n1)"
    
    # Configure GitHub CLI authentication using token
    if [ ! -z "$GITHUB_TOKEN" ]; then
        echo "Configuring GitHub CLI authentication..."
        # Set the token as environment variable for gh CLI
        export GH_TOKEN="$GITHUB_TOKEN"
        
        # Test authentication without interactive login
        if gh auth status >/dev/null 2>&1; then
            echo "GitHub CLI authentication configured successfully"
        else
            echo "Warning: GitHub CLI authentication test failed, but token is set"
        fi
    else
        echo "Warning: GITHUB_TOKEN not provided - GitHub CLI will not be authenticated"
    fi
else
    echo "Warning: GitHub CLI not found"
fi

# Check if Claude CLI is available
if command -v claude &> /dev/null; then
    echo "Claude CLI is available"
else
    echo "Warning: Claude CLI not found - will need manual installation or API integration"
fi

# Initialize MCP configuration
if [ -f /app/scripts/init-mcp.sh ]; then
    echo "Initializing MCP configuration..."
    /app/scripts/init-mcp.sh
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