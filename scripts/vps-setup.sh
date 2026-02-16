#!/bin/bash
# Turntable VPS Setup Script
# Run this ON the VPS as root: bash vps-setup.sh
# Tested on Ubuntu 22.04/24.04

set -e

echo "=== Turntable VPS Setup ==="
echo ""

# 1. System updates
echo "→ Updating system packages..."
apt update && apt upgrade -y

# 2. Create app user (non-root)
echo "→ Creating 'turntable' user..."
if id "turntable" &>/dev/null; then
    echo "  User 'turntable' already exists, skipping."
else
    adduser --disabled-password --gecos "" turntable
    usermod -aG sudo turntable
    echo "  Created user 'turntable'"
fi

# 3. Install Node.js 20 LTS
echo "→ Installing Node.js 20 LTS..."
if command -v node &>/dev/null; then
    echo "  Node.js already installed: $(node -v)"
else
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
    echo "  Installed Node.js $(node -v)"
fi

# 4. Install pm2
echo "→ Installing pm2..."
npm install -g pm2
echo "  pm2 installed"

# 5. Install Caddy
echo "→ Installing Caddy..."
if command -v caddy &>/dev/null; then
    echo "  Caddy already installed: $(caddy version)"
else
    apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
    apt update && apt install -y caddy
    echo "  Caddy installed"
fi

# 6. Install git
echo "→ Ensuring git is installed..."
apt install -y git

# 7. Firewall setup
echo "→ Configuring firewall (ufw)..."
apt install -y ufw
ufw allow 22/tcp   # SSH
ufw allow 80/tcp   # HTTP (Caddy redirect to HTTPS)
ufw allow 443/tcp  # HTTPS (Caddy)
ufw --force enable
echo "  Firewall enabled: SSH(22), HTTP(80), HTTPS(443)"

# 8. Create app directory
echo "→ Creating /opt/turntable..."
mkdir -p /opt/turntable
chown turntable:turntable /opt/turntable

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Next steps:"
echo "  1. Set up GitHub SSH key or personal access token"
echo "  2. Clone the repo:  su - turntable -c 'git clone https://github.com/vi3labs/turntable.git /opt/turntable'"
echo "  3. Create .env:     nano /opt/turntable/.env"
echo "  4. Install deps:    cd /opt/turntable && npm install --production"
echo "  5. Start with pm2:  see scripts/deploy.sh"
echo ""
