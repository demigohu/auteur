# PRD Auteur Labs — AI Agent Video Editor

Oct 30, 2026 · @sdsd

## Ringkasan

**Auteur Labs adalah AI agent video editor: kamu bicara seperti ke editor manusia, lalu dia mengedit di timeline seperti DaVinci, karena dia benar-benar _melihat_ dan _mendengar_ footage-mu.** Contoh perintahnya: "jadikan 40 menit footage mentah ini vlog 3 menit, buka dengan momen paling seru, versi 9:16 untuk Reels, kasih subtitle, warna hangat cinematic, buang bagian 'eee' dan diam." Agen menyusun rencana, membangun timeline (klip, potongan, reframe, teks, efek, warna), memeriksa hasil, lalu render.

Rasanya seperti Cursor, tapi untuk video: editor di tengah, agen di panel kanan. Pengguna tetap bisa mengedit sendiri dengan tools yang sama (split, trim, geser, teks, warna), dan semua perubahan, dari agen maupun pengguna, tercatat di riwayat yang bisa di-undo.

- **Untuk siapa:** kreator, vlogger, brand dan UMKM yang bikin konten, siapa saja yang punya footage mentah tapi nggak punya waktu atau skill DaVinci dan Premiere.
- **Bedanya:** editor AI lain hanya mengerti _ucapan_ (transkrip). Auteur Labs mengerti ucapan _dan_ visual: siapa di layar, benda apa, adegan apa, di mana subjek berada. Hasilnya bukan video jadi yang tertutup, tapi **timeline yang bisa dilihat dan diubah**, seperti hasil kerja editor manusia.
- **Kenapa sekarang:** SAM 3.1 baru tersedia lewat Meta Model API dengan pelacakan objek di video ($0,20 per 1.000 frame), dan Muse Spark bisa menonton frame dan memakai tool. Kombinasi ini membuat edit berbasis isi visual jadi murah dan otomatis.
- **Target lomba:** Meta Global AI Developer Hackathon, Indie Developer track, plus bonus Best Agentic Use-Case. Submit paling lambat 4 Nov 21.00 ET (5 Nov 09.00 WIB).

## Masalah & kompetitor

**Editor video AI saat ini mengerti apa yang _diucapkan_, bukan apa yang _terlihat_.** Manusia berpikir dalam isi ("bagian anakku tiup lilin", "orang asing di belakang"), sedangkan editor berpikir dalam detik. Akibatnya, pekerjaan seperti memblur orang lewat, mencari momen tertentu, atau crop vertikal yang mengikuti subjek masih dikerjakan manual.

| Produk                        | Cara kerja                            | Yang belum bisa                                                                     |
| ----------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| DaVinci Resolve, Premiere Pro | Editor profesional, semua manual      | Butuh skill dan berjam-jam kerja; AI-nya hanya alat satuan (masker, upscale)        |
| Descript (Underlord)          | Agen yang mengedit dari transkrip     | Tidak mengerti visual: siapa di layar, benda apa, di mana subjek                    |
| CapCut, Captions, Opus Clip   | Potong otomatis dari ucapan, template | Tidak bisa diberi arahan bebas; hasilnya template, bukan timeline yang direncanakan |
| Runway                        | Efek visual dan generasi video        | Bukan editor; tidak menyusun cerita dari footage mentah                             |

**Pembeda Auteur Labs:** (1) agen yang mengerti visual dan ucapan sekaligus, bukan transkrip saja, (2) satu arahan bebas dipecah jadi banyak langkah edit di timeline yang bisa dilihat dan diubah, dan pengguna bisa ikut mengedit di timeline yang sama, (3) setiap hasil diperiksa di luar agen sebelum diserahkan, misalnya subjek selalu di dalam frame 9:16, durasi sesuai permintaan, dan warna tidak terbakar, (4) color grading dari arahan bebas ("hangat cinematic") yang diterapkan dan diukur, bukan sekadar filter template.

## Tujuan & target juri

**Targetnya masuk 5 besar Indie track dan menang Best Agentic Use-Case ($5k).** Best Creative tidak dikejar karena syaratnya Muse Image atau Muse Wonder sebagai inti.

| Kriteria (bobot)          | Cara Auteur Labs menjawabnya                                                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Impact (30%)              | Siapa pun yang punya footage mentah bisa menghasilkan video siap posting tanpa skill editing; pasar kreator dan brand global       |
| Use of Meta tooling (25%) | SAM 3.1 video tracking (kemampuan terbaru Meta) jadi inti, Muse Spark sebagai otak agen dan penilai, Voice Transcribe untuk ucapan |
| Technical depth (20%)     | Loop agen dengan tool calling, satu lapisan operasi untuk agen dan pengguna, pemeriksa hasil di luar agen, pipeline ffmpeg, masker per frame, grading terukur |
| Demo (25%)                | Hasil sebelum dan sesudah bicara sendiri, agen terlihat bekerja live, juri bisa mencoba dengan video mereka sendiri                |

Untuk Best Agentic, juri menilai otonomi, efektivitas, dan kegunaan praktis. Auteur Labs menunjukkan ketiganya lewat satu momen kunci: pemeriksa menemukan subjek keluar frame di versi 9:16, lalu agen memperbaikinya tanpa campur tangan pengguna.

## Pengguna & skenario utama

**Skenario 1 (footage mentah jadi vlog) jadi tulang punggung demo; skenario lain membuktikan agen bisa diberi arahan apa saja.**

| Pengguna           | Arahan contoh                                                                                    | Yang dikerjakan agen                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Vlogger            | "Jadikan footage 20 menit ini vlog 2 menit, buka dengan momen paling seru, buang 'eee' dan diam" | Tonton dan dengar semua klip, pilih momen, susun cerita, potong filler, render |
| Kreator short-form | "Bikin 3 Reels 9:16 dari podcast ini, kamera selalu ke orang yang bicara, kasih subtitle"        | Cari momen terbaik, lacak pembicara, reframe vertikal, subtitle                |
| Brand atau UMKM    | "Video produk 30 detik, fokus ke produknya, kasih teks harga di akhir"                           | Pilih shot dengan produk paling jelas, reframe ke produk, tambah teks          |
| Siapa saja         | "Blur wajah orang asing dan plat nomor"                                                          | Lacak face dan license plate, blur, periksa sampai 0 bocor                     |
| Revisi             | "Bagian pantai kepanjangan, potong jadi 5 detik dan ganti urutannya ke awal"                     | Ubah klip di timeline yang sudah ada, render ulang                             |
| Siapa saja         | "Warnanya hangat cinematic, dan samakan warna klip HP dengan klip kamera"                        | Lihat frame sampel, tentukan parameter grading, terapkan, ukur hasilnya        |
| Kolaborasi         | Pengguna trim satu klip manual, lalu: "sekarang kasih subtitle"                                 | Baca timeline terbaru termasuk edit pengguna, lanjutkan tanpa menimpanya       |

Di luar scope hackathon: musik latar otomatis, grading per objek dengan masker SAM, dan multi-kamera. Semua masuk roadmap.

## Fitur & scope MVP

**MVP = editor dengan timeline yang diisi agen dan bisa diedit pengguna, plus tool yang cukup untuk mengubah footage mentah jadi video siap posting.** Timeline-nya tampil seperti DaVinci (track video dan teks). Agen dan pengguna memakai operasi yang sama, jadi tools manual hanya butuh UI, bukan logika baru. Tools manual dibatasi ke yang ringan; pekerjaan berat (masker, tracking, keyframe) tetap dikerjakan agen.

| Fitur                                                 | Prioritas    | Keterangan                                                         |
| ----------------------------------------------------- | ------------ | ------------------------------------------------------------------ |
| Upload beberapa klip (maks 5 menit total)             | Wajib        | Batas durasi menjaga biaya dan waktu proses                        |
| Arahan bebas lewat chat, termasuk revisi              | Wajib        | "potong bagian pantai jadi 5 detik" mengubah timeline yang ada     |
| Rencana edit tampil sebelum dikerjakan                | Wajib        | Pengguna bisa setuju atau mengubah                                 |
| Timeline visual (track video + teks), preview, export | Wajib        | Inti rasa "editor"; data timeline = satu JSON yang dirender ffmpeg |
| tonton + dengar (adegan dan transkrip)                | Wajib        | Muse Spark + Voice Transcribe                                      |
| cari\_momen, susun cerita                             | Wajib        | Memilih dan mengurutkan bagian terbaik                             |
| Buang "eee" dan diam                                  | Wajib        | Dari timestamp transkrip                                           |
| Reframe 9:16 mengikuti subjek                         | Wajib        | SAM 3.1 melacak subjek                                             |
| Subtitle dan teks overlay                             | Wajib        | Transkrip + ffmpeg                                                 |
| Blur atau sorot objek                                 | Wajib        | Masker SAM 3.1 + OpenCV                                            |
| periksa + perbaikan otomatis                          | Wajib        | Momen kunci untuk Best Agentic                                     |
| Color grading: koreksi otomatis                       | Wajib        | Statistik frame (kecerahan, white balance, saturasi) + filter ffmpeg |
| Color grading: look dari arahan                       | Wajib        | Muse Spark lihat frame, keluarkan parameter; bisa diubah lewat slider |
| Edit manual: pilih, split, trim, geser, hapus         | Wajib        | Memanggil operasi yang sama dengan agen                            |
| Edit manual: teks dan slider efek/warna di inspector  | Wajib        | Mengubah properti klip yang dipilih                                |
| Riwayat perubahan + undo                              | Wajib        | Tiap operasi dicatat dengan penulisnya (agen atau pengguna)        |
| Gaya Proyek (catatan gaya yang selalu dibaca agen)    | Kalau sempat | Mirip `.cursorrules`: font subtitle, warna brand, look grading     |
| Samakan warna antar klip                              | Kalau sempat | Klip HP dan kamera dibuat seragam, dicek lewat statistik           |
| Arahan lewat suara                                    | Kalau sempat | Voice Transcribe                                                   |
| Musik otomatis, grading per objek (masker SAM)        | Jangan dulu  | Bukan pembeda utama, makan waktu                                   |
| Masker dan keyframe manual                            | Jangan dulu  | Berat di UI; agen yang mengerjakan                                 |
| Pilih subjek dengan klik di preview ("ikuti dia")     | Kalau sempat | Klik jadi prompt kotak SAM; default-nya subjek terbesar dan terlama |
| Multi-kamera                                          | Jangan dulu  | Butuh sinkronisasi antar sumber                                    |

## Model Meta & biaya

**Tiga model Meta, masing-masing punya peran yang tidak bisa dihapus; perkiraan biaya sekitar $1 per menit video.** Muse Wonder dan Muse Image tidak dipakai di MVP.

| Model                 | Peran di Auteur Labs                                                                                                                                                     | Harga                                               |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| SAM 3.1               | Melacak objek dari perintah teks (face, person, dog, logo, license plate) dan menghasilkan masker per frame. Dipakai lagi oleh pemeriksa untuk mengecek video hasil | $0,20 per 1.000 frame video; $2,50 per 1.000 gambar |
| Muse Spark 1.3        | Otak agen: memahami perintah, menyusun rencana, memilih tool. Menonton frame sampel untuk mencari adegan dan menentukan look grading. Menilai apakah hasil sesuai perintah | $1,25 / $4,25 per 1 juta token input / output       |
| Muse Voice Transcribe | Transkrip per giliran bicara untuk subtitle, membuang "eee" dan diam, dan mencari momen dari ucapan                                                                 | $3 per 1.000 menit audio                            |

Hitungan kasar untuk video 1 menit di 30 fps (1.800 frame): satu kali lacak sekitar $0,36. Satu edit lengkap (lacak wajah, lacak objek kedua, periksa ulang) sekitar $1. Memproses di 15 fps memotong biaya SAM jadi separuh. Muse Spark membaca sekitar 1 frame per detik, jadi biayanya hanya beberapa sen per menit video. Kredit $150 cukup untuk development, demo, dan juri yang mencoba.

Temuan tes API (1 Nov) yang memengaruhi desain:

- **SAM 3.1:** video dikirim langsung sebagai data base64 di `input_video` (tanpa URL publik); output di-parse dengan `meta-sam-parser`. Video resolusi penuh 60 fps (38 detik, 9 MB) memutus koneksi, jadi SAM selalu menerima **proxy 15 fps, tinggi 640 px, tanpa audio**. Batas 16 ID objek berlaku **per request, bukan per frame**: di adegan ramai, ID habis untuk orang lewat dan subjek yang muncul belakangan tidak terlacak sama sekali (klip uji: subjek hanya 53% frame). Dikirim per segmen 10 detik, subjek yang sama terlacak 100%; di pembukaan yang ramai 10 detik pun masih kehabisan ID, jadi `lacak` memakai segmen 5 detik yang diproses paralel dan ID disambung antar segmen (klip uji: 53% jadi 83%, sisanya memang subjek belum muncul). Selain teks, SAM menerima **prompt kotak dan titik**, jadi pengguna bisa klik subjek. ID subjek utama stabil sepanjang segmen. Waktu proses 1–4,5x durasi video (10 detik: 10–47 s; 38 detik: 81 s), hasil pertama keluar sekitar 5 detik.
- **Voice Transcribe:** bukan endpoint OpenAI, tapi `POST /v1/asr/transcribe` (multipart, WAV mono 24 kHz, maks 10 menit per file). Wajib `languageBias: ["id"]` untuk bahasa Indonesia. Filler seperti "eh" dan "hmm" ikut tertulis. **Tidak ada timestamp per kata**, hanya per giliran bicara; mode stream (`text/event-stream`) mengirim transkrip sebagian tiap 80 ms, sehingga waktu kata bisa diperkirakan dari situ.
- **Muse Spark 1.3:** input gambar (base64) dan tool calling via Responses API berjalan; sekitar 5–7 detik per panggilan karena reasoning.

Sumber harga: [KuCoin](https://www.kucoin.com/news/flash/meta-launches-sam-3-1-api-for-image-and-video-segmentation), [LiteLLM](https://github.com/BerriAI/litellm/pull/47395), [LLM Reference](https://www.llmreference.com/provider/meta-model-api/muse-spark-1.3).

## Arsitektur & alur agen

**Agen mengerjakan satu tool per giliran, lalu pemeriksa di luar kendali agen yang memutuskan hasilnya diterima atau diulang.** Polanya sama dengan Legal Agent Workshop Meta: rencana, aksi, hasil, verifikasi, ulang.

&#91;embedded content: alur agen Auteur Labs · loop rencana, aksi, periksa\]

Loopnya ditulis dengan OpenAI Python SDK yang diarahkan ke `https://api.meta.ai/v1` (Responses API, satu tool per giliran, progres disimpan per run). Pemeriksa dipanggil otomatis setelah render, sehingga agen tidak bisa melewatinya. Setelah 3 kali gagal, run berhenti dan menampilkan frame bermasalah ke pengguna.

Semua tool mengubah satu objek **timeline** (JSON: daftar klip dengan sumber, potongan masuk dan keluar, crop per frame, teks, efek, parameter warna). UI menggambar timeline itu, dan `render` mengubahnya jadi video lewat ffmpeg. Revisi cukup mengubah timeline, bukan mengedit ulang dari nol.

**Satu lapisan operasi untuk agen dan pengguna.** Timeline hanya bisa diubah lewat operasi kecil yang tervalidasi: `split`, `trim`, `move`, `delete`, `add_text`, `set_effect`, `set_grade`, `set_crop`. Tool agen di tabel bawah merangkai operasi ini; tombol dan drag di UI memanggil operasi yang sama lewat API. Akibatnya:

- **Riwayat:** setiap operasi disimpan dengan penulis (agen atau pengguna), waktu, dan arahan asalnya. Undo per operasi atau per arahan agen ("batalkan arahan terakhir").
- **Agen sadar edit pengguna:** setiap giliran, agen membaca timeline terbaru beserta ringkasan riwayat, jadi edit manual tidak ditimpa diam-diam.
- **Gaya Proyek (kalau sempat):** catatan teks per proyek yang selalu masuk ke prompt agen, misalnya "subtitle putih tebal di bawah, warna brand #FF5A00, grading hangat, potongan cepat".

**Color grading terukur.** Muse Spark menentukan niat ("hangat, kontras tinggi") dari frame sampel dan arahan, lalu kode menerjemahkannya ke parameter ffmpeg (`eq`, `colorbalance`, `colortemperature`, `curves`). Penilaian hasil memakai statistik frame, bukan penilaian model: tidak ada area terbakar atau hancur di bayangan, white balance wajar, dan antar klip konsisten.

| Tool           | Fungsi                                                                                                      | Dijalankan oleh         |
| -------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------- |
| `tonton`       | Ringkasan adegan per segmen dari frame sampel (sekitar 1 fps)                                               | Muse Spark              |
| `dengar`       | Transkrip per giliran; waktu tiap kata diperkirakan dari transkrip sebagian di mode stream                  | Voice Transcribe        |
| `cari_momen`   | Mencari rentang waktu sesuai deskripsi visual atau ucapan                                                   | Muse Spark              |
| `susun`        | Menaruh, memotong, dan mengurutkan klip di timeline                                                         | Kode (timeline JSON)    |
| `buang_filler` | Memotong "eee", "hmm", dan diam panjang; batas potong dirapikan ke titik hening (`silencedetect` ffmpeg)    | Kode dari transkrip + ffmpeg |
| `lacak`        | Masker dan posisi objek per frame dari prompt teks atau kotak; proxy 15 fps dipecah per segmen 10 detik, diproses paralel, ID disambung antar segmen lewat overlap kotak | SAM 3.1                 |
| `reframe`      | Crop 9:16 halus yang mengikuti subjek                                                                       | Kode dari hasil `lacak` |
| `teks`         | Subtitle dan teks overlay                                                                                   | Kode + transkrip        |
| `efek`         | Blur atau sorot objek                                                                                       | OpenCV + ffmpeg         |
| `warna`        | Koreksi otomatis, look dari arahan, dan menyamakan warna antar klip                                         | Muse Spark + kode statistik + ffmpeg |
| `render`       | Menghasilkan video dari timeline                                                                            | ffmpeg                  |
| `periksa`      | Mengecek hasil: durasi sesuai, subjek di dalam frame, momen yang diminta ada, objek yang diblur tidak bocor, warna tidak terbakar dan konsisten | SAM 3.1 + Muse Spark + statistik frame |

## UI: tata letak editor

**Tata letaknya meniru editor profesional seperti DaVinci, dengan panel agen di kanan seperti Cursor.** Orang yang pernah membuka editor video langsung paham, dan juri melihat agen bekerja di dalam editor, bukan di kotak chat terpisah. Pengguna bisa berganti antara mengedit sendiri dan menyuruh agen kapan saja.

1. **Kiri, media bin:** klip yang di-upload, masing-masing dengan thumbnail dan ringkasan adegan dari agen.
2. **Tengah, preview:** pemutar video timeline saat ini, dengan overlay kotak SAM saat agen melacak, dan tombol sebelum dan sesudah (termasuk sebelum dan sesudah grading).
3. **Kanan, panel dengan tab:**
   - **Agen:** chat untuk arahan dan revisi, rencana edit berupa checklist dengan status per langkah (menunggu, jalan, lolos, gagal), dan log giliran (Rencana, Aksi, Hasil) seperti Agent Console di workshop Meta.
   - **Inspector:** properti klip yang dipilih: potongan masuk dan keluar, teks, slider warna (exposure, kontras, saturasi, temperatur), dan efek.
   - **Riwayat:** daftar perubahan dengan penulis (agen atau pengguna), undo per langkah atau per arahan.
4. **Bawah, timeline:** toolbar kecil (pilih, split, hapus, undo, redo), track video dan track teks. Klip bisa digeser dan di-trim dengan drag, dan ikut bergeser live saat agen mengedit. Playhead sinkron dengan preview.
5. **Atas:** pilihan format (16:9, 9:16, 1:1), tombol export, dan biaya proses run ini.

Saat agen sedang menjalankan run, timeline dikunci untuk edit manual supaya tidak terjadi konflik; pengguna bisa menghentikan run kapan saja.

## Stack

**Next.js untuk editor, Python untuk agen dan pemrosesan video, tanpa monorepo tooling.** Bottleneck-nya ada di API Meta dan ffmpeg, bukan bahasa backend, jadi dipilih ekosistem yang paling lengkap untuk video dan AI (OpenCV, numpy, OpenAI SDK) daripada Go atau Rust.

| Lapisan        | Pilihan                                                        | Alasan                                                                    |
| -------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------- |
| Frontend       | Next.js + TypeScript, Tailwind + shadcn/ui                     | Cepat membangun panel, tab, slider; deploy mudah                          |
| State editor   | Zustand                                                        | Timeline, seleksi, riwayat, dan undo di satu store                        |
| Timeline UI    | Komponen sendiri (div + pointer events)                        | Drag dan trim sesuai kebutuhan; library timeline siap pakai kaku          |
| Preview        | Remotion Player, membaca timeline JSON langsung                | Edit langsung terlihat tanpa render ulang di server; seek dan sinkronisasi klip sudah ditangani library; export tetap ffmpeg |
| Backend        | Python 3.12 + FastAPI, dikelola `uv`                           | Ekosistem video dan AI paling matang                                      |
| Model data     | Pydantic                                                       | Satu definisi untuk validasi, skema tool agen, dan tipe TypeScript di FE  |
| Agen           | OpenAI Python SDK ke `https://api.meta.ai/v1`                  | Format yang dipakai Meta Model API dan workshop Meta                      |
| Video          | ffmpeg (subprocess), OpenCV + numpy                            | Potong, render, masker, blur, statistik warna                             |
| Progres live   | Server-Sent Events (`sse-starlette`)                           | Satu arah server ke browser, cukup untuk log agen                         |
| Job            | asyncio task di proses yang sama                               | Tanpa Celery atau Redis; cukup untuk skala demo                           |
| Penyimpanan    | SQLite (proyek, timeline, riwayat) + disk lokal (video)        | Nol setup                                                                 |
| Deploy         | Frontend di Vercel; backend di satu server Docker dengan disk (Railway atau Fly.io) | Backend butuh ffmpeg dan ruang file; kredit Modal jadi cadangan komputasi |

Struktur repo, tanpa Turborepo karena hanya ada satu aplikasi JS dan satu Python:

```
auteur/
├── web/        # Next.js
├── api/        # FastAPI (uv)
├── docs/       # PRD.md
└── Makefile    # make dev menjalankan web + api bersamaan
```

## Skrip demo 3 menit & cara juri menguji

**Video demo memperlihatkan footage mentah berubah jadi video siap posting lewat dua arahan, termasuk agen yang memperbaiki kesalahannya sendiri.**

| Waktu     | Yang tampil                                                                                                                                            | Pesan                                   |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------- |
| 0:00–0:20 | 15 menit footage jalan-jalan mentah di media bin. "Di DaVinci, ini kerja 3 jam."                                                                       | Masalahnya nyata                        |
| 0:20–0:45 | Ketik: "Vlog 60 detik, buka dengan momen paling seru, buang 'eee', kasih subtitle, warna hangat cinematic." Rencana edit muncul                         | Agen merencanakan                       |
| 0:45–1:30 | Media bin terisi ringkasan adegan, klip berjatuhan ke timeline, filler terpotong, subtitle muncul di track teks, grading diterapkan (sebelum/sesudah)   | Agen mengedit seperti editor manusia    |
| 1:30–1:55 | Arahan kedua: "versi 9:16 untuk Reels." Kotak SAM melacak subjek, crop mengikuti. Pemeriksa menemukan 2 detik subjek keluar frame, agen memperbaikinya | Momen "wow" Best Agentic                |
| 1:55–2:20 | Pengguna trim satu klip manual di timeline, lalu: "bagian pantai kepanjangan, potong jadi 5 detik." Agen mengubah timeline tanpa menimpa edit tadi; riwayat menunjukkan keduanya | Agen dan pengguna mengedit bersama      |
| 2:20–3:00 | Hasil akhir diputar, lalu penutup: siapa penggunanya, model Meta yang dipakai, dan kenapa sekarang                                                     | Hasilnya siap posting                   |

Cara juri menguji: satu link publik berisi proyek contoh yang sudah di-upload (footage siap pakai) dan tombol arahan contoh, ditambah opsi upload footage sendiri (maks 2 menit). Kuota per pengunjung membatasi biaya. Repo publik berisi README yang menandai semua yang dibangun selama hackathon, sesuai aturan "new work only".

## Batas waktu & urutan prioritas

**Tidak ada jadwal harian yang kaku; yang dipegang adalah urutan pengerjaan dan batas submit 4 Nov 21.00 ET (5 Nov 09.00 WIB).**

1. Tes API SAM 3.1, Muse Spark, dan Voice Transcribe.
2. Model timeline, lapisan operasi, dan riwayat (agen dan UI sama-sama bergantung padanya).
3. Loop agen + `dengar`, `buang_filler`, `susun`, `render`.
4. UI editor: media bin, preview, timeline, panel agen.
5. `teks`, `warna`, lalu `lacak` dan `reframe`.
6. `periksa` + perbaikan otomatis.
7. `tonton`, `cari_momen`, `efek`, dan edit manual tambahan.
8. Deploy, footage demo, video demo, README.

Kalau waktu menipis, potong dari bawah: blur, menyamakan warna antar klip, dan edit manual selain trim dan hapus lebih dulu. Inti yang harus tetap ada: footage mentah jadi vlog, grading dari arahan, reframe 9:16, dan pemeriksa.

## Risiko & pertanyaan terbuka

**Risiko terbesar ada di cara kerja API SAM untuk video, jadi itu dites pertama, sebelum menulis kode lain.**

| Risiko                                                             | Dampak                            | Rencana cadangan                                                                           |
| ------------------------------------------------------------------ | --------------------------------- | ------------------------------------------------------------------------------------------ |
| SAM lambat (1–4,5x durasi video) dan waktunya tidak stabil         | Demo live terasa lama             | Segmen 10 detik diproses paralel, kotak tampil bertahap di preview, footage demo diproses sebelumnya |
| Batas 16 ID objek per request habis di adegan ramai                | Subjek utama tidak terlacak       | Pecah per segmen 10 detik; untuk subjek tertentu pakai prompt kotak, bukan teks              |
| Tidak ada timestamp per kata dari Voice Transcribe                 | Potongan filler dan subtitle meleset | Perkiraan dari transkrip sebagian (resolusi 80 ms), dirapikan ke titik hening ffmpeg      |
| Upload resolusi penuh ke SAM memutus koneksi                       | Pelacakan gagal                   | Selalu kirim proxy 15 fps, 640 px, tanpa audio                                             |
| Masker berkedip antar frame                                        | Blur bocor sesaat                 | Perlebar masker beberapa piksel dan haluskan antar frame, lalu pemeriksa menangkap sisanya |
| Model tidak akurat menilai warna dari gambar                       | Grading berlebihan atau kusam     | Model hanya menentukan niat; nilai akhir dibatasi rentang aman dan dicek statistik frame   |
| Edit pengguna dan agen bentrok                                     | Edit manual tertimpa              | Timeline dikunci selama run agen; agen selalu membaca timeline dan riwayat terbaru         |
| Scope bertambah (edit manual, riwayat, grading)                    | Inti agen telat jadi              | Lapisan operasi dibuat sekali untuk agen dan UI; ikuti urutan potong fitur di atas         |
| Akses API dari Indonesia atau kartu kredit bermasalah              | Tidak bisa mulai                  | Klaim kredit sekarang, tanya di Discord #office-hours                                      |
| Data video demo                                                    | Butuh izin orang di video         | Rekam footage sendiri di tempat umum, atau pakai video berlisensi bebas                    |

**Pertanyaan tes hari pertama** (skrip di `api/scripts/probe_meta.py` dan `probe_sam_tracking.py`):

- [x] Format request video ke `sam-3.1`: Responses API, `input_text` + `input_video` (data base64), `stream=True`, parse dengan `meta-sam-parser`.
- [ ] Batas pasti durasi, resolusi, dan ukuran file belum diketahui; proxy 15 fps 640 px untuk 38 detik (2,2 MB) lolos, file asli 9 MB 60 fps gagal.
- [x] Waktu proses: klip 38 detik dengan prompt "person" sekitar 81 detik; segmen 10 detik 10–47 detik.
- [x] Format output: per frame, kotak + masker (dipotong ke kotak) per objek; frame tanpa deteksi dilewati; ID subjek utama konsisten dalam satu request, tapi batas 16 ID per request.
- [x] Muse Spark menerima puluhan gambar dalam satu request: `tonton` mengirim sampai 48 frame berlabel waktu dan mendapat deskripsi adegan dalam 13-16 detik. Input video langsung belum dites.
- [x] ID disambung antar segmen lewat IoU kotak di frame batas; subjek utama tersambung tanpa celah di semua segmen klip uji.
