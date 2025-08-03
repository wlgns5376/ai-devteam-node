# MCP (Model Context Protocol) Setup for AI DevTeam

## Overview

This guide explains how to set up and use MCP (Model Context Protocol) with task-master-ai in the AI DevTeam Docker environment.

## What is MCP?

MCP (Model Context Protocol) is an open protocol that enables LLMs like Claude to access external tools and data sources. In our setup, we use it to integrate task-master-ai with Claude Code for enhanced project management capabilities.

## Prerequisites

- Docker and Docker Compose installed
- At least one API key for task-master-ai (see API Keys section)
- Claude Code CLI (optional, for local development)

## Quick Start

1. **Clone the repository and navigate to the project directory:**
   ```bash
   git clone <repository-url>
   cd ai-devteam-node
   ```

2. **Copy the example environment file and add your API keys:**
   ```bash
   cp .env.example .env
   # Edit .env and add at least one API key for task-master-ai
   ```

3. **Build and run with Docker Compose:**
   ```bash
   docker-compose up -d
   ```

4. **Access the Claude development environment (optional):**
   ```bash
   docker-compose --profile dev run --rm claude-dev
   ```

## Configuration Files

### `.mcp.json`

The MCP configuration file defines the task-master-ai server:

```json
{
  "mcpServers": {
    "task-master-ai": {
      "command": "npx",
      "args": ["-y", "--package=task-master-ai", "task-master-ai"],
      "env": {
        "ANTHROPIC_API_KEY": "${ANTHROPIC_API_KEY:-}",
        "PERPLEXITY_API_KEY": "${PERPLEXITY_API_KEY:-}",
        // ... other API keys
      }
    }
  }
}
```

### Environment Variables

Add these to your `.env` file:

```bash
# At least one of these API keys is required for task-master-ai
ANTHROPIC_API_KEY=your_key_here      # For Claude models
PERPLEXITY_API_KEY=your_key_here     # For research features (recommended)
OPENAI_API_KEY=your_key_here         # For GPT models
GOOGLE_API_KEY=your_key_here         # For Gemini models
# ... other optional API keys
```

## Docker Setup Details

### Dockerfile Changes

The Dockerfile has been updated to include:

1. **task-master-ai installation:**
   ```dockerfile
   RUN npm install -g task-master-ai
   ```

2. **MCP configuration copy:**
   ```dockerfile
   COPY .mcp.json /app/.mcp.json
   ```

3. **Initialization script:**
   ```dockerfile
   COPY scripts/init-mcp.sh /app/scripts/init-mcp.sh
   ```

### Docker Compose Services

1. **ai-devteam** - Main application service
2. **claude-dev** - Interactive development environment with Claude Code support

## Usage

### Running the AI DevTeam with MCP

```bash
# Start the service
docker-compose up -d

# View logs
docker-compose logs -f ai-devteam

# Stop the service
docker-compose down
```

### Interactive Development with Claude Code

```bash
# Start an interactive session
docker-compose --profile dev run --rm claude-dev

# Inside the container, authenticate Claude Code (first time only)
claude

# Claude Code will automatically detect .mcp.json and enable MCP tools
```

### Using task-master-ai Commands

Inside the Docker container, you can use task-master-ai directly:

```bash
# Initialize task-master in a project
task-master init

# Parse a PRD document
task-master parse-prd docs/prd.txt

# List tasks
task-master list

# Get next task
task-master next
```

## MCP Tools Available in Claude Code

When using Claude Code with MCP enabled, these tools are available:

- `initialize_project` - Initialize task-master in a project
- `parse_prd` - Parse a PRD document into tasks
- `get_tasks` - List all tasks
- `next_task` - Get the next available task
- `get_task` - Get details of a specific task
- `set_task_status` - Update task status
- `add_task` - Add a new task
- `expand_task` - Break a task into subtasks
- `analyze_project_complexity` - Analyze project complexity

## Troubleshooting

### MCP Not Working

1. **Check API keys are set:**
   ```bash
   docker-compose exec ai-devteam env | grep API_KEY
   ```

2. **Verify task-master-ai installation:**
   ```bash
   docker-compose exec ai-devteam which task-master-ai
   ```

3. **Check MCP configuration:**
   ```bash
   docker-compose exec ai-devteam cat /app/.mcp.json
   ```

### Claude Code Authentication

If Claude Code requires authentication:

```bash
# Inside the container
claude

# Follow the authentication prompts
```

### Initialization Script

The `init-mcp.sh` script runs automatically and:
- Creates `.mcp.json` if it doesn't exist
- Checks API key configuration
- Validates Claude Code installation
- Reports MCP setup status

## Best Practices

1. **API Keys**: Always use environment variables for API keys, never commit them
2. **Volume Mounts**: Use Docker volumes for persistent data
3. **Security**: Run containers with minimal privileges
4. **Updates**: Regularly update task-master-ai: `npm update -g task-master-ai`

## Advanced Configuration

### Custom MCP Servers

You can add additional MCP servers to `.mcp.json`:

```json
{
  "mcpServers": {
    "task-master-ai": { /* ... */ },
    "custom-server": {
      "command": "/path/to/server",
      "args": ["--option", "value"],
      "env": {
        "CUSTOM_VAR": "${CUSTOM_VAR:-default}"
      }
    }
  }
}
```

### Resource Limits

Adjust Docker Compose resource limits based on your needs:

```yaml
deploy:
  resources:
    limits:
      cpus: '4'
      memory: 8G
```

## References

- [Claude Code MCP Documentation](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [task-master-ai GitHub](https://github.com/eyaltoledano/claude-task-master)
- [MCP Specification](https://modelcontextprotocol.io/)