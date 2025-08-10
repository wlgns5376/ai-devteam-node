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

# Initialize git config if not set (using environment variables)
if [ ! -z "$GIT_USER_NAME" ]; then
    git config --global user.name "$GIT_USER_NAME"
fi

if [ ! -z "$GIT_USER_EMAIL" ]; then
    git config --global user.email "$GIT_USER_EMAIL"
fi

if [ ! -z "$GITHUB_TOKEN" ] && [ ! -z "$GIT_USER_NAME" ]; then
    echo "https://$GIT_USER_NAME:$GITHUB_TOKEN@github.com" > ~/.git-credentials
    git config --global credential.helper store
fi

# Set git to accept any host key (for automated cloning)
if [ ! -z "$GIT_ACCEPT_HOST_KEY" ] && [ "$GIT_ACCEPT_HOST_KEY" = "true" ]; then
    git config --global core.sshCommand "ssh -o UserKnownHostsFile=/dev/null -o StrictHostKeyChecking=no"
fi

echo "=== Configuration Complete ==="
echo "Starting application..."

# Execute the main application
exec "$@"