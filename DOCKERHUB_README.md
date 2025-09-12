# AI DevTeam Node Docker Image

[![License: ISC](https://img.shields.io/badge/License-ISC-yellow.svg)](https://github.com/wlgns5376/ai-devteam-node/blob/main/LICENSE.md)
[![GitHub](https://img.shields.io/badge/GitHub-ai--devteam--node-blue)](https://github.com/wlgns5376/ai-devteam-node)

AI-powered development automation system using Claude Code and Gemini CLI to automatically manage GitHub Projects tasks and create pull requests.

## Quick Start

```bash
docker pull wlgns5376/ai-devteam:latest
```

## Available Tags

### Standard Images (Node.js only)
- `latest` - Latest stable version
- `v1.0.2` - Specific version
- `v1.0` - Major.minor version
- `v1` - Major version

### All-Languages Images (Multi-language support)
- `latest-all-languages` - Latest with Python, Go, Java, Rust support
- `v1.0.2-all-languages` - Specific version with all languages
- `v1.0-all-languages` - Major.minor version with all languages
- `v1-all-languages` - Major version with all languages

## Image Selection Guide

**Use Standard Image for:**
- Node.js/TypeScript projects only
- Minimal image size requirements
- Faster container startup

**Use All-Languages Image for:**
- Multi-language projects (Python, Go, Java, Rust)
- AI developers generating code in various languages
- Complex polyglot environments

## Configuration

### Environment Variables

Create a `.env` file with your configuration:

```bash
# Required
GITHUB_TOKEN="your_github_personal_access_token"
GITHUB_OWNER="your_github_username_or_org"
GITHUB_PROJECT_NUMBER="your_project_number"

# Repository Configuration (Option 1: Multiple)
GITHUB_REPOS="owner1/repo1,owner2/repo2"
GITHUB_REPO_FILTER_MODE="whitelist"

# Repository Configuration (Option 2: Single)
GITHUB_REPO="your_repository_name"

# AI Developer Tools
CLAUDE_CODE_PATH="claude"
GEMINI_CLI_PATH="gemini"
```

### Docker Compose Example

```yaml
version: '3.8'

services:
  ai-devteam:
    image: wlgns5376/ai-devteam:latest
    container_name: ai-devteam
    user: "1001:1001"
    environment:
      - GIT_USER_NAME=your_git_username
      - GIT_USER_EMAIL=your_email@example.com
      - GITHUB_TOKEN=${GITHUB_TOKEN}
      - GIT_ACCEPT_HOST_KEY=true
    volumes:
      - ./.env:/app/.env:ro
      - ./workspace:/workspace
      - ai_devteam_home:/home/appuser
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "console.log('Health check: OK')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

volumes:
  ai_devteam_home:
    driver: local
```

### Running the Container

```bash
# Using Docker Run
docker run -d \
  --name ai-devteam \
  -v $(pwd)/.env:/app/.env:ro \
  -v $(pwd)/workspace:/workspace \
  -e GIT_USER_NAME="Your Name" \
  -e GIT_USER_EMAIL="your.email@example.com" \
  -e GITHUB_TOKEN="${GITHUB_TOKEN}" \
  wlgns5376/ai-devteam:latest

# Using Docker Compose
docker-compose up -d
```

## Features

- 🤖 **AI Developer Integration**: Claude Code & Gemini CLI support
- 📋 **Automatic Task Management**: GitHub Projects integration
- 🔄 **PR Automation**: Automatic pull request creation and review
- ⚡ **Parallel Processing**: Up to 5 concurrent workers
- 📝 **Review Feedback**: Automatic PR comment handling
- 🌳 **Workspace Isolation**: Git worktree for independent environments
- 🏢 **Multi-Repository**: Support for multiple repositories
- 🔒 **Repository Filtering**: Whitelist/Blacklist modes

## Monitoring

```bash
# View logs
docker logs -f ai-devteam

# Check status
docker ps | grep ai-devteam

# Access container
docker exec -it ai-devteam /bin/bash
```

## Resource Requirements

- **Memory**: 512MB minimum (1GB recommended)
- **CPU**: 1 core minimum (2 cores recommended)
- **Storage**: 1GB for base image + project space

## Security Notes

- Store sensitive data in `.env` file, not in docker-compose.yml
- Use read-only mount for `.env` file (`:ro`)
- Run container as non-root user (`user: "1001:1001"`)
- Regularly update to latest version for security patches

## Troubleshooting

### Container won't start
Check logs: `docker logs ai-devteam`

### Permission issues
Ensure volumes have correct permissions for user 1001

### AI tools not authenticating
- For Claude: `docker exec -it ai-devteam claude login`
- Mount authentication directory as volume for persistence

## Links

- [GitHub Repository](https://github.com/wlgns5376/ai-devteam-node)
- [Issue Tracker](https://github.com/wlgns5376/ai-devteam-node/issues)
- [Full Documentation](https://github.com/wlgns5376/ai-devteam-node#readme)

## License

ISC License - See [LICENSE](https://github.com/wlgns5376/ai-devteam-node/blob/main/LICENSE.md) for details.