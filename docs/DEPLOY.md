# Deploy Auteur ke VPS

Panduan untuk satu VPS Ubuntu dengan Docker Compose: **Caddy** (HTTPS otomatis) di depan **web** (Next.js) dan **api** (FastAPI, ffmpeg, renderer Remotion). Contoh di sini memakai `auteurlabs.xyz`.

| Alamat | Isi |
| --- | --- |
| `https://auteurlabs.xyz` | Landing page dan editor |
| `https://auteurlabs.xyz/api` | API yang dipakai editor |
| `https://api.auteurlabs.xyz` | API yang sama, untuk akses langsung dan `/docs` |

**Kenapa editor memakai `/api`, bukan `api.auteurlabs.xyz`:** live stream agen (progres dan klip yang muncul real-time) masuk dengan cookie sesi Clerk. Di origin yang sama cookie itu selalu terkirim; ke subdomain lain belum tentu, tergantung domain cookie yang dipasang Clerk. Subdomain `api.` tetap aktif dan menjalankan API yang sama.

Spek yang dipakai di panduan ini: 6 vCPU, 11 GB RAM, 193 GB disk, tanpa swap. Cukup untuk demo; render dan background removal memakai CPU.

---

## 1. DNS

Di panel domain, buat dua record yang mengarah ke IP VPS:

| Tipe | Nama | Nilai |
| --- | --- | --- |
| A | `@` (auteurlabs.xyz) | IP VPS |
| A | `api` | IP VPS |

Record Clerk ditambahkan di langkah 2. Cek sebelum lanjut (hasilnya harus IP VPS):

```bash
dig +short auteurlabs.xyz
dig +short api.auteurlabs.xyz
```

## 2. Clerk production

Instance development (`pk_test_…`) hanya untuk localhost. Untuk domain sendiri:

1. **dashboard.clerk.com** → aplikasi Auteur → ubah dari *Development* ke *Production* → buat production instance, domain `auteurlabs.xyz`.
2. **Domains**: Clerk menampilkan beberapa record DNS (biasanya CNAME `clerk`, `accounts`, `clkmail`, `clk._domainkey`, `clk2._domainkey`). Tambahkan semuanya di panel domain persis seperti yang ditampilkan, lalu tunggu sampai statusnya *Verified*.
3. **Google sign-in**: di production, Clerk memakai kredensial OAuth milikmu sendiri.
   - Google Cloud Console → APIs & Services → Credentials → *Create OAuth client ID* (Web application).
   - *Authorized redirect URI*: salin dari Clerk (SSO connections → Google → *Use custom credentials*).
   - Tempel Client ID dan Client Secret di Clerk.
4. **API keys**: salin `pk_live_…` dan `sk_live_…`.

Akun di production terpisah dari development: akun tes lokal tidak ada di sana, jadi daftar ulang setelah deploy.

## 3. Siapkan VPS

Login sebagai root (atau user dengan sudo):

```bash
apt update && apt upgrade -y
apt install -y git curl ufw

# Swap 4 GB: build image dan render besar bisa melewati RAM sesaat; tanpa swap prosesnya dibunuh.
fallocate -l 4G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab

# Firewall: SSH, HTTP, HTTPS (dan HTTP/3).
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

# Docker (skrip resmi; memasang Docker Engine dan plugin Compose).
curl -fsSL https://get.docker.com | sh
docker compose version
```

Hanya Caddy yang membuka port ke internet (80 dan 443). API (8000) dan web (3000) hanya bisa dijangkau dari dalam jaringan Docker.

## 4. Ambil kode dan isi konfigurasi

```bash
git clone https://github.com/demigohu/auteur.git /opt/auteur
cd /opt/auteur
cp deploy/.env.example .env
cp api/.env.example api/.env
```

**`.env` (root)**, dibaca Docker Compose:

```env
DOMAIN=auteurlabs.xyz

CLERK_PUBLISHABLE_KEY=pk_live_...
CLERK_SECRET_KEY=sk_live_...

USER_SPEND_CAP_USD=5
SPEND_CAP_USD=140

MAX_EXPORT_HEIGHT=1080
MAX_FOOTAGE_SECONDS=600
```

**`api/.env`**, rahasia API:

```env
META_API_KEY=...
META_BASE_URL=https://api.meta.ai/v1
```

Nilai lain di `api/.env` (CORS, folder data, Clerk, batas belanja) sudah diatur `docker-compose.yml` dari `.env` root; yang di sana menang.

Catatan batas:
- `SPEND_CAP_USD` hanya menghitung pemakaian lewat server ini. Pemakaian lokal memakai kredit yang sama tapi tidak ikut terhitung; sisakan cadangan dan pasang *Spend Limit notification* di halaman Billing Meta.
- `MAX_EXPORT_HEIGHT=1080`: 4K di 6 vCPU lama. Naikkan ke `2160` kalau perlu.
- `RUNS_PER_VISITOR_PER_DAY` (opsional, di `.env` root): batas run agen per pengunjung per hari; `0` = tanpa batas.

Jangan commit `.env` dan `api/.env` (sudah di `.gitignore`).

## 5. Build dan jalankan

```bash
cd /opt/auteur
docker compose up -d --build
```

Build pertama makan waktu (PyTorch CPU, Chrome headless untuk Remotion, build Next.js), kira-kira 10–20 menit. Begitu kontainer jalan, Caddy mengambil sertifikat HTTPS untuk kedua domain dalam beberapa detik.

```bash
docker compose ps                 # api, web, caddy: running
docker compose logs -f caddy      # tunggu "certificate obtained successfully" untuk kedua domain
```

## 6. Cek

```bash
curl -s https://auteurlabs.xyz/api/health    # {"status":"ok"}
curl -s https://api.auteurlabs.xyz/health    # {"status":"ok"}
curl -sI https://auteurlabs.xyz | head -1     # HTTP/2 200
```

Lalu di browser:

1. Buka `https://auteurlabs.xyz`, daftar dengan Google atau email.
2. Buat project, upload satu klip pendek.
3. Kirim arahan ke agen. Langkah-langkahnya harus muncul satu per satu tanpa refresh: itu tanda live stream dan cookie sesi berjalan.
4. Export, lalu **Download the last export**: file harus tersimpan, bukan terbuka di tab.
5. Voice-over atau Dub pertama mengunduh model suara (~145 MB per bahasa) ke volume data; sekitar 30 detik sekali saja.
6. Satu video dari kode (Muse Wonder), untuk memastikan renderer Remotion di dalam kontainer jalan.
7. Buka `https://api.auteurlabs.xyz/docs` untuk dokumentasi API.

## 7. Operasional

| Kebutuhan | Perintah |
| --- | --- |
| Log | `docker compose logs -f api` (atau `web`, `caddy`) |
| Update setelah `git push` | `cd /opt/auteur && git pull && docker compose up -d --build` |
| Update hanya editor | `docker compose up -d --build web` |
| Restart API | `docker compose restart api` |
| Pemakaian disk Docker | `docker system df` |
| Buang image lama | `docker image prune -f` |

Data (project, media, render, model suara) ada di volume `auteur-data`. Nama lengkapnya diawali nama folder project, cek dengan `docker volume ls` (biasanya `auteur_auteur-data`). Backup:

```bash
docker run --rm -v auteur_auteur-data:/data -v /root:/backup alpine \
  tar czf /backup/auteur-data-$(date +%F).tgz -C /data .
```

Update menjalankan ulang kontainer: run agen atau export yang sedang berjalan saat itu berhenti. Update di luar jam demo.

## 8. Masalah yang mungkin muncul

| Gejala | Penyebab dan solusi |
| --- | --- |
| Caddy gagal ambil sertifikat | DNS belum mengarah ke VPS atau port 80/443 tertutup. Cek `dig`, `ufw status`, lalu `docker compose restart caddy`. |
| Login error atau redirect berputar | Kunci Clerk masih `pk_test_`/`sk_test_`, atau domain Clerk belum *Verified*. Setelah mengganti kunci, build ulang web: `docker compose up -d --build web` (kunci publishable masuk ke bundle saat build). |
| Google sign-in gagal di production | Kredensial OAuth Google belum diisi di Clerk, atau redirect URI di Google Console tidak sama persis. |
| Langkah agen tidak muncul real-time (harus refresh) | Live stream tertahan. Pastikan editor memakai `https://auteurlabs.xyz/api` (default build), bukan subdomain. |
| Upload gagal untuk file besar (413) | Batas Caddy 600 MB per file (`deploy/Caddyfile`, `request_body`). Video 4K panjang dari HP bisa melewatinya: kecilkan atau potong dulu. |
| "Project footage would be …s" | Batas footage per project (`MAX_FOOTAGE_SECONDS`). |
| "Today's demo budget is used up" | `SPEND_CAP_USD` tercapai. Naikkan di `.env` root, lalu `docker compose up -d`. |
| Kontainer api mati saat render besar | Kehabisan memori. Pastikan swap aktif (`free -h`), turunkan `MAX_EXPORT_HEIGHT`. |
| Video dari kode gagal render | `docker compose logs api` mencari error Chrome/Remotion; build ulang api: `docker compose up -d --build api`. |
| Halaman lama setelah update | Build ulang yang berubah (`--build web` atau `--build api`), lalu hard refresh browser. |
