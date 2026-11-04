# Deploying Auteur to a VPS

One Ubuntu VPS with Docker Compose: **Caddy** (automatic HTTPS) in front of **web** (Next.js) and **api** (FastAPI, ffmpeg, the Remotion renderer). The examples use `auteurlabs.xyz`, where the live demo runs.

| Address | Serves |
| --- | --- |
| `https://auteurlabs.xyz` | Landing page and editor |
| `https://auteurlabs.xyz/api` | The API the editor calls |
| `https://api.auteurlabs.xyz` | The same API, for direct calls and `/docs` |

**Why the editor uses `/api` and not `api.auteurlabs.xyz`:** the agent's live event stream authenticates with Clerk's session cookie. On the same origin that cookie is always sent; to another subdomain it depends on the cookie domain Clerk sets. The `api.` subdomain still serves the same API.

The server in this guide has 6 vCPU, 11 GB RAM, 193 GB disk and no swap. That is enough for a demo; rendering and background removal run on the CPU.

---

## 1. DNS

At your DNS provider, point two records at the VPS:

| Type | Name | Value |
| --- | --- | --- |
| A | `@` (auteurlabs.xyz) | VPS IP |
| A | `api` | VPS IP |

Clerk's records come in step 2. Check before moving on (both should print the VPS IP):

```bash
dig +short auteurlabs.xyz
dig +short api.auteurlabs.xyz
```

## 2. Clerk production

A development instance (`pk_test_…`) only works on localhost. For your own domain:

1. **dashboard.clerk.com** → your application → switch from *Development* to *Production* → create the production instance with the application domain `auteurlabs.xyz` (no `api.`; the API only verifies tokens).
2. **Domains**: Clerk lists five CNAME records: `clerk` and `accounts` (sign-in) and `clkmail`, `clk._domainkey`, `clk2._domainkey` (email codes). Add all five exactly as shown, using Clerk's copy buttons, then **Verify Records**. If your DNS is on Cloudflare, set them to *DNS only*. The sign-in form appears once Clerk has issued SSL certificates for `clerk.` and `accounts.` (minutes to an hour after verification).
3. **API keys**: copy `pk_live_…` and `sk_live_…`. The secret key is shown once.

Production accounts are separate from development ones: sign up again after deploying. Clerk marks the checklist's *Developer* step done when the first production user exists.

### Google sign-in

In production Clerk needs your own Google OAuth credentials.

1. **Google Cloud Console** → new project → **Google Auth Platform**:
   - **Branding**: app name, support email, home page `https://auteurlabs.xyz`, privacy policy `https://auteurlabs.xyz/privacy`, terms `https://auteurlabs.xyz/terms`, authorized domain `auteurlabs.xyz`. Leave the logo out: a logo requires brand verification, which takes days.
   - **Audience**: External → **Publish app**. While it is *Testing*, only listed test users can sign in.
   - **Clients** → Create client → *Web application*. JavaScript origin `https://auteurlabs.xyz`; redirect URI copied from Clerk (`https://clerk.auteurlabs.xyz/v1/oauth_callback`).
2. Paste the Client ID and Client secret into Clerk → **SSO connections** → Google → *Use custom credentials*, and save.

## 3. Prepare the VPS

As root (or a user with sudo):

```bash
apt update && apt upgrade -y
apt install -y git curl ufw

# 4 GB swap: image builds and large renders can briefly exceed RAM; without swap they get killed.
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Firewall: SSH, HTTP, HTTPS (and HTTP/3).
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Docker (official script: Docker Engine and the Compose plugin).
curl -fsSL https://get.docker.com | sh
docker compose version
```

If the server already runs other services, check what listens publicly before enabling the firewall (`ss -ltnp`), and allow the ports they need. Ports published by Docker containers are not filtered by ufw.

Only the proxy listens on the internet (80 and 443). The API (8000) and the editor (3000) are reachable from inside the Docker network only.

## 4. Get the code and configure it

```bash
git clone https://github.com/demigohu/auteur.git /opt/auteur
cd /opt/auteur
cp deploy/.env.example .env
cp api/.env.example api/.env
```

**`.env` (repository root)**, read by Docker Compose:

```env
DOMAIN=auteurlabs.xyz

CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...

USER_SPEND_CAP_USD=5
SPEND_CAP_USD=140

MAX_EXPORT_HEIGHT=1080
MAX_FOOTAGE_SECONDS=600
```

**`api/.env`**, the API's secret:

```env
META_API_KEY=...
META_BASE_URL=https://api.meta.ai/v1
```

Everything else in `api/.env` (CORS, data folder, Clerk key, spend caps) is set by `docker-compose.yml` from the root `.env`, which takes precedence. `MAX_FILE_SECONDS` is the one exception; leave it at `0` (the footage budget already caps each file).

Limits worth knowing:
- `SPEND_CAP_USD` counts only what this server spends. Local development uses the same Meta credits without counting here; keep a margin and set a spend notification on Meta's Billing page.
- `MAX_EXPORT_HEIGHT=1080`: 4K exports are slow on 6 vCPU. Raise to `2160` if needed.
- `RUNS_PER_VISITOR_PER_DAY` (optional, root `.env`): agent runs per visitor per day; `0` means unlimited.

Never commit `.env` or `api/.env` (both are in `.gitignore`).

## 5. Build and start

```bash
cd /opt/auteur
docker compose up -d --build
```

The first build takes 10–20 minutes (PyTorch for CPU, headless Chrome for Remotion, the Next.js build). Once the containers run, Caddy obtains certificates for both domains within seconds.

```bash
docker compose ps                 # api, web, caddy: running
docker compose logs -f caddy      # wait for "certificate obtained successfully" for both domains
```

### 5b. When the VPS already runs nginx

Symptom: `docker compose up` fails with `failed to bind host port 0.0.0.0:80/tcp: address already in use`, and `ss -ltnp | grep -E ':80 |:443 '` shows `nginx`. If that nginx serves other sites, keep it and make it Auteur's front door too, without Caddy.

1. Make sure ports 3100 and 8100 are free (no output):
   ```bash
   ss -ltn | grep -E ':3100 |:8100 '
   ```
2. Remove the failed Caddy container, switch to the nginx override and start again (no rebuild needed):
   ```bash
   cd /opt/auteur
   docker rm -f auteur-caddy-1
   echo 'COMPOSE_FILE=docker-compose.yml:deploy/docker-compose.nginx.yml' >> .env
   docker compose up -d
   docker compose ps          # api and web running; no caddy
   curl -s http://127.0.0.1:8100/health
   ```
3. Install the nginx site (check `ls /etc/nginx/sites-enabled` first; without it, write to `/etc/nginx/conf.d/auteur.conf`):
   ```bash
   sed 's/auteur.example.com/auteurlabs.xyz/g' deploy/nginx.conf > /etc/nginx/sites-available/auteur
   ln -s /etc/nginx/sites-available/auteur /etc/nginx/sites-enabled/auteur
   nginx -t && systemctl reload nginx
   ```
4. HTTPS with certbot (it adds certificates and the HTTP→HTTPS redirect to Auteur's blocks only; other sites are untouched):
   ```bash
   apt install -y certbot python3-certbot-nginx   # if not installed
   certbot --nginx -d auteurlabs.xyz -d api.auteurlabs.xyz
   ```

`deploy/nginx.conf` carries what Auteur needs: `/api/` proxied to the API with the prefix stripped, buffering off (the agent's event stream), one-hour timeouts (long renders) and uploads up to 600 MB.

Certbot edits `/etc/nginx/sites-available/auteur` in place. If `deploy/nginx.conf` changes later, edit that file by hand rather than running the `sed` again, or the certificate lines are lost. Updates stay `git pull && docker compose up -d --build`: the `COMPOSE_FILE` line in `.env` keeps the override in use.

## 6. Check

```bash
curl -s https://auteurlabs.xyz/api/health    # {"status":"ok"}
curl -s https://api.auteurlabs.xyz/health    # {"status":"ok"}
curl -sI https://auteurlabs.xyz | head -1     # 200
```

Then in a browser:

1. Open `https://auteurlabs.xyz` and sign up with Google or email.
2. Create a project and upload a short clip.
3. Send the agent an instruction. Its steps should appear one by one without reloading: that confirms the event stream and the session cookie.
4. Export, then **Download the last export**: the file should be saved, not opened in a tab.
5. The first voice-over or dub downloads a voice model (~145 MB per language) into the data volume, about 30 seconds once.
6. Make one video in code (Muse Wonder) to confirm the Remotion renderer runs in the container.
7. Generate a picture (Muse Image).
8. Open `https://api.auteurlabs.xyz/docs` for the API reference.

## 7. Operations

| Task | Command |
| --- | --- |
| Logs | `docker compose logs -f api` (or `web`, `caddy`) |
| Update after `git push` | `cd /opt/auteur && git pull && docker compose up -d --build` |
| Update the editor only | `docker compose up -d --build web` |
| Update the API only | `docker compose up -d --build api` |
| Restart the API | `docker compose restart api` |
| Docker disk usage | `docker system df` |
| Remove old images | `docker image prune -f` |

Projects, media, renders and voice models live in the `auteur-data` volume. Its full name starts with the project folder's name; check with `docker volume ls` (usually `auteur_auteur-data`). Backup:

```bash
docker run --rm -v auteur_auteur-data:/data -v /root:/backup alpine \
  tar czf /backup/auteur-data-$(date +%F).tgz -C /data .
```

An update restarts the containers, which stops any agent run or export in progress at that moment. Update outside demo hours.

## 8. Troubleshooting

| Symptom | Cause and fix |
| --- | --- |
| `address already in use` on port 80 | Another web server (usually nginx). See 5b. |
| Caddy can't get a certificate | DNS doesn't point at the VPS yet, or ports 80/443 are closed. Check `dig` and `ufw status`, then `docker compose restart caddy`. |
| Sign-in page shows no form | Clerk's domain isn't *Verified* or its SSL certificates aren't issued yet (Clerk → Domains). |
| Sign-in errors or redirect loops | Keys are still `pk_test_`/`sk_test_`. After changing keys, rebuild the editor: `docker compose up -d --build web` (the publishable key is baked into the bundle at build time). |
| Google sign-in fails | OAuth credentials missing in Clerk, the redirect URI in Google doesn't match exactly, or the Google app is still *Testing*. |
| Agent steps don't appear live (reload needed) | The event stream is being buffered. Make sure the editor uses `https://auteurlabs.xyz/api` (the default build), not the subdomain, and that the proxy doesn't buffer it. |
| Large uploads fail (413) | The proxy's 600 MB per-file limit (`deploy/Caddyfile` or `deploy/nginx.conf`). Long 4K phone videos can exceed it: compress or trim first. |
| "Project footage would be …s" | The per-project footage budget (`MAX_FOOTAGE_SECONDS`). |
| "Today's demo budget is used up" | `SPEND_CAP_USD` reached. Raise it in the root `.env`, then `docker compose up -d`. |
| API container dies during a large render | Out of memory. Check swap is on (`free -h`) and lower `MAX_EXPORT_HEIGHT`. |
| Videos in code fail to render | Look for Chrome/Remotion errors in `docker compose logs api`; rebuild with `docker compose up -d --build api`. |
| Old pages after an update | Rebuild what changed (`--build web` or `--build api`), then hard-refresh the browser. |
