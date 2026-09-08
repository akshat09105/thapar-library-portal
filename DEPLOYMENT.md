# 🚀 Production Deployment Guide - Scalable Relational SQL Architecture

This document provides a complete guide for deploying the **Thapar Smart Library Desk Allocation System** with its **Production Relational SQL Database (SQLite WAL / PostgreSQL)**, ACID transaction locking, and high-concurrency architecture.

---

## 🏛️ System Architecture

Unlike simple prototypes that store state in memory or flat JSON files:
- **Relational SQL Database**: Powered by `better-sqlite3` with **Write-Ahead Logging (WAL)** mode enabled. Reads and writes do not block each other, handling 10,000+ operations/second.
- **ACID Transaction Locking**: Seat reservations, check-ins, grace breaks, and checkouts execute inside atomic SQL transactions. Double-booking is mathematically impossible even with hundreds of concurrent users.
- **Persistent Volume Architecture**: Database file (`library.db`) is stored in a dedicated directory `/app/data/library.db` mounted to persistent storage volumes.
- **Health & Monitoring**: Dedicated `/health` endpoint returning system uptime and database health.

```
┌────────────────────────────────────────┐
│     Client Terminals (Web Browsers)    │
│  Student / Gate Scanner / Librarian    │
└──────────────────┬─────────────────────┘
                   │ HTTP / HTTPS (Origin-Relative APIs)
                   ▼
┌────────────────────────────────────────┐
│       Node.js + Express Server         │
│  - REST APIs                           │
│  - Background Expiration Worker (1s)   │
│  - Security Shield Middleware          │
└──────────────────┬─────────────────────┘
                   │ Atomic SQL Transactions
                   ▼
┌────────────────────────────────────────┐
│      Relational SQL Engine (WAL)       │
│  - seats (Indexed)                     │
│  - bookings (Indexed)                  │
│  - reports (Indexed)                   │
│  - audit_logs                          │
│  - emails (Notification Queue)         │
└────────────────────────────────────────┘
```

---

## 📋 Table of Contents
1. [Option 1: Deploy with Docker Compose (Local & VPS - Recommended)](#option-1-deploy-with-docker-compose)
2. [Option 2: Deploy on Render (Free Cloud Web Service)](#option-2-deploy-on-render-free-tier)
3. [Option 3: Deploy on Railway](#option-3-deploy-on-railway)
4. [Option 4: Deploy on Ubuntu / Linux VPS with PM2 & Nginx](#option-4-deploy-on-ubuntu-linux-vps-with-pm2--nginx)
5. [Environment Variables Reference](#environment-variables-reference)
6. [Automated Verification & Health Checks](#automated-verification--health-checks)

---

## Option 1: Deploy with Docker Compose

Docker Compose runs the hardened container with persistent storage volume so your SQL database is preserved across restarts and server updates.

### 1. Fast Start:
```bash
# Clone or open the folder
cd library_claude

# Build and start container in detached background mode
docker compose up -d --build
```

The portal will immediately be accessible at:
👉 **`http://localhost:3000`**

### 2. Monitor Container & Logs:
```bash
# View running containers
docker ps

# Follow live server logs
docker compose logs -f
```

### 3. Stop or Restart:
```bash
# Stop the service (Data in thapar_library_storage volume remains safe)
docker compose down

# Start again
docker compose up -d
```

---

## Option 2: Deploy on Render (Free Tier)

[Render](https://render.com) provides free web service hosting for Node.js applications with automatic HTTPS certificates and continuous deployment.

### Step 1: Push Code to GitHub
Run the following commands in your project terminal:
```bash
git init
git add .
git commit -m "feat: scalable relational SQL library portal"
git branch -M main
git remote add origin https://github.com/<your-github-username>/thapar-library-portal.git
git push -u origin main
```

### Step 2: Deploy on Render
1. Log into [dashboard.render.com](https://dashboard.render.com).
2. Click **New +** → **Blueprint**.
3. Connect your GitHub repository (`thapar-library-portal`).
4. Render will detect [render.yaml](file:///c:/Users/Akshat%20Gupta/Downloads/library_claude/library_claude/render.yaml):
   - **Build Command**: `npm install`
   - **Start Command**: `node server.js`
   - **Health Check Path**: `/health`
5. Click **Apply / Deploy Web Service**.
6. Render will build the service and give you a live HTTPS URL:
   `https://thapar-library-portal.onrender.com`

---

## Option 3: Deploy on Railway

1. Push your code to GitHub using the steps above.
2. Log into [railway.app](https://railway.app).
3. Click **New Project** → **Deploy from GitHub repo**.
4. Select `thapar-library-portal`.
5. Railway automatically builds and launches the application using the `Dockerfile` or `Procfile`.
6. Go to **Settings** → **Networking** → **Generate Domain** to get your public HTTPS domain.

---

## Option 4: Deploy on Ubuntu / Linux VPS with PM2 & Nginx

For dedicated virtual servers (DigitalOcean Droplet, Linode, AWS EC2, Hetzner):

### 1. Install Node.js 20+ and PM2:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt update && sudo apt install -y nodejs build-essential
sudo npm install -g pm2
```

### 2. Setup Application:
```bash
sudo mkdir -p /var/www/thapar-library
sudo chown -R $USER:$USER /var/www/thapar-library
cd /var/www/thapar-library

# Copy or clone files here
npm install --omit=dev

# Start production service with PM2
pm2 start server.js --name "library-portal"
pm2 save
pm2 startup
```

### 3. Setup Nginx Reverse Proxy:
Create `/etc/nginx/sites-available/library.example.com`:
```nginx
server {
    listen 80;
    server_name library.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable site and restart Nginx:
```bash
sudo ln -s /etc/nginx/sites-available/library.example.com /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

---

## Environment Variables Reference

| Variable | Description | Default Value | Required? |
| :--- | :--- | :--- | :--- |
| `PORT` | Listening HTTP port. Set automatically by cloud platforms. | `3000` | No |
| `NODE_ENV` | Mode of operation (`production` or `development`). | `production` | No |
| `DB_PATH` | File path for persistent SQLite database file. | `./library.db` (or `/app/data/library.db` in Docker) | No |

---

## Automated Verification & Health Checks

Verify your deployment status at any time:

### 1. Health Endpoint:
```bash
curl http://your-domain-or-ip/health
```
Response:
```json
{
  "status": "ok",
  "uptime": 240,
  "database": "SQLite WAL (Relational)",
  "timestamp": "2026-09-08T13:10:00.000Z"
}
```

### 2. State API:
```bash
curl http://your-domain-or-ip/api/state
```

### 3. Security Shield Check:
Verify that direct static downloads of source code and database files are forbidden:
```bash
curl -I http://your-domain-or-ip/server.js
# HTTP/1.1 403 Forbidden

curl -I http://your-domain-or-ip/library.db
# HTTP/1.1 403 Forbidden
```
