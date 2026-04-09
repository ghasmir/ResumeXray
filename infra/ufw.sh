#!/bin/bash
# §12.3: UFW firewall rules for ResumeXray VPS
# Usage: sudo bash infra/ufw.sh
set -euo pipefail

echo "=== Configuring UFW firewall ==="

# Reset to clean state
ufw --force reset

# Default policies
ufw default deny incoming
ufw default deny outgoing

# Allow SSH (rate-limited to prevent brute force — §12.2)
ufw limit 22/tcp comment 'SSH rate-limited'

# Allow HTTP + HTTPS
ufw allow 80/tcp comment 'HTTP (Caddy redirect to HTTPS)'
ufw allow 443/tcp comment 'HTTPS (Caddy)'

# Allow outbound DNS
ufw allow out 53 comment 'DNS resolution'

# Allow outbound HTTPS (API calls to Stripe, OpenAI, Supabase, etc.)
ufw allow out 443/tcp comment 'Outbound HTTPS'

# Allow outbound SMTP (for email delivery)
ufw allow out 587/tcp comment 'Outbound SMTP/TLS'
ufw allow out 465/tcp comment 'Outbound SMTPS'

# Allow outbound HTTP (package managers, Let's Encrypt ACME)
ufw allow out 80/tcp comment 'Outbound HTTP (ACME, apt)'

# Allow outbound to Upstash Redis (port 6379 over TLS = 6380)
ufw allow out 6379/tcp comment 'Upstash Redis'
ufw allow out 6380/tcp comment 'Upstash Redis TLS'

# Enable logging
ufw logging low

# Enable
ufw --force enable

echo "=== UFW configured ==="
ufw status verbose
