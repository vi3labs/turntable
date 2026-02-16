#!/bin/bash
# Turntable Deploy Script
# Run this ON the VPS to deploy/redeploy: bash /opt/turntable/scripts/deploy.sh
set -e

APP_DIR="/opt/turntable"
cd "$APP_DIR"

echo "=== Deploying Turntable ==="

# Pull latest code
echo "→ Pulling latest from main..."
git pull origin main

# Install dependencies
echo "→ Installing dependencies..."
npm install --production

# Restart with pm2
if pm2 describe turntable > /dev/null 2>&1; then
    echo "→ Restarting turntable..."
    pm2 restart turntable
else
    echo "→ Starting turntable for the first time..."
    pm2 start server/index.js --name turntable
    pm2 save
    pm2 startup systemd -u turntable --hp /home/turntable | tail -1 | bash
fi

echo ""
echo "=== Deploy Complete ==="
pm2 status turntable
echo ""
