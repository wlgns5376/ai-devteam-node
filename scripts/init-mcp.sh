#!/bin/bash
set -e

echo "=== MCP (Model Context Protocol) Initialization ==="

# Check if running in Docker container
if [ -f /.dockerenv ]; then
    echo "Running in Docker container"
else
    echo "Running on host system"
fi

# Create .mcp.json if it doesn't exist
if [ ! -f /app/.mcp.json ] && [ ! -f ./.mcp.json ]; then
    echo "Creating default .mcp.json configuration..."
    
    MCP_CONFIG_PATH="${MCP_CONFIG_PATH:-/app/.mcp.json}"
    [ ! -f /.dockerenv ] && MCP_CONFIG_PATH="./.mcp.json"
    
    cat > "$MCP_CONFIG_PATH" << 'EOF'
{
  "mcpServers": {
    "task-master-ai": {
      "command": "npx",
      "args": ["-y", "--package=task-master-ai", "task-master-ai"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY:-}",
        "PERPLEXITY_API_KEY": "${PERPLEXITY_API_KEY:-}",
        "OPENAI_API_KEY": "${OPENAI_API_KEY:-}",
        "GOOGLE_API_KEY": "${GOOGLE_API_KEY:-}",
        "XAI_API_KEY": "${XAI_API_KEY:-}",
        "OPENROUTER_API_KEY": "${OPENROUTER_API_KEY:-}",
        "MISTRAL_API_KEY": "${MISTRAL_API_KEY:-}",
        "AZURE_OPENAI_API_KEY": "${AZURE_OPENAI_API_KEY:-}",
        "OLLAMA_API_KEY": "${OLLAMA_API_KEY:-}"
      }
    }
  }
}
EOF
    echo "Created MCP configuration at: $MCP_CONFIG_PATH"
else
    echo "MCP configuration already exists"
fi

# Install task-master-ai globally if not already installed
if ! command -v task-master-ai &> /dev/null; then
    echo "Installing task-master-ai globally..."
    npm install -g task-master-ai || {
        echo "Warning: Failed to install task-master-ai globally"
        echo "You can still use it via npx as configured in .mcp.json"
    }
else
    echo "task-master-ai is already installed"
fi

# Validate Claude Code installation
if command -v claude &> /dev/null; then
    echo "Claude Code CLI is available"
    echo "Claude version: $(claude --version 2>/dev/null || echo 'version check failed')"
    
    # Try to list MCP servers (may require authentication)
    echo "Checking MCP servers..."
    claude mcp list 2>/dev/null || {
        echo "Note: 'claude mcp list' requires Claude Code to be authenticated"
        echo "Run 'claude' to authenticate if needed"
    }
else
    echo "Warning: Claude Code CLI not found"
    echo "To use MCP features, install Claude Code CLI:"
    echo "  npm install -g @anthropic-ai/claude-code"
fi

# Check for required API keys
echo ""
echo "=== API Key Status ==="
check_api_key() {
    local key_name=$1
    if [ ! -z "${!key_name}" ]; then
        echo "✓ $key_name is set"
    else
        echo "✗ $key_name is not set"
    fi
}

# At least one API key should be set for task-master-ai to work
API_KEYS=(
    "ANTHROPIC_API_KEY"
    "PERPLEXITY_API_KEY"
    "OPENAI_API_KEY"
    "GOOGLE_API_KEY"
    "XAI_API_KEY"
    "OPENROUTER_API_KEY"
    "MISTRAL_API_KEY"
    "AZURE_OPENAI_API_KEY"
    "OLLAMA_API_KEY"
)

any_key_set=false
for key in "${API_KEYS[@]}"; do
    check_api_key "$key"
    [ ! -z "${!key}" ] && any_key_set=true
done

if [ "$any_key_set" = false ]; then
    echo ""
    echo "Warning: No API keys are set. At least one API key is required for task-master-ai."
    echo "Set one or more API keys in your environment or .env file."
fi

echo ""
echo "=== MCP Initialization Complete ==="
echo "To use task-master-ai with Claude Code:"
echo "1. Ensure Claude Code is authenticated: run 'claude'"
echo "2. Claude Code will automatically detect .mcp.json in your project"
echo "3. Use MCP tools in Claude Code to interact with task-master-ai"