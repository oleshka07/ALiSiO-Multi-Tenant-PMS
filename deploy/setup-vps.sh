#!/bin/bash
# ALiSiO Multi-Tenant PMS - Hetzner VPS One-Click Setup Script

echo "🚀 Starting ALiSiO Multi-Tenant PMS VPS Setup..."

# Update system
sudo apt update && sudo apt upgrade -y

# Install Docker & Docker Compose
sudo apt install -y docker.io docker-compose certbot

# Start Docker
sudo systemctl enable --now docker

# Create SSL Cert for domain
echo "🔒 Requesting SSL certificate for alisio.rozum.one..."
sudo certbot certonly --standalone -d alisio.rozum.one -d *.alisio.rozum.one --non-interactive --agree-tos --email admin@rozum.one || true

# Build & Run Containers
echo "🐳 Deploying application with Docker Compose..."
docker-compose -f deploy/docker-compose.prod.yml up -d --build

echo "✅ ALiSiO Multi-Tenant PMS is live at https://alisio.rozum.one !"
