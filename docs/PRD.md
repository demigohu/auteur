# PRD Auteur Labs — AI Agent Video Editor

Nov 4, 2026 · @sdsd · versi 2 (menggantikan versi Oct 30; mencerminkan produk yang sudah dibangun)

## Ringkasan

**Auteur Labs adalah editor video yang kamu arahkan dengan kalimat, seperti mengarahkan editor manusia. Agen yang dibangun di atas model Meta menonton dan mendengar footage-mu, lalu mengedit timeline sungguhan yang tetap bisa kamu ubah sendiri.** Contoh arahannya: "jadikan footage ini vlog 45 detik, buka dengan momen paling seru, buang 'eee', kasih subtitle, warna hangat cinematic, lalu bikin versi 9:16 dan blur wajah orang asing." Agen menyusun rencana, mengedit timeline langkah demi langkah, me-render, dan memeriksa hasilnya dengan pemeriksa di luar kendalinya sebelum menyerahkan.

Kalau tidak ada footage sama sekali, Muse Wonder menulis videonya sebagai kode: storyboard, lalu tiap adegan sebagai komponen Remotion yang dirender, diperiksa dari frame render-nya sendiri, dan ditaruh di timeline yang sama.

Rasanya seperti Cursor untuk video: editor di tengah, agen di panel kanan. Di luar agen, editornya lengkap untuk edit manual: potong, transisi, keyframe, teks bergaya, LUT, hapus background, dubbing, edit lewat transkrip, dan export sampai 4K.

- **Untuk siapa:** kreator, vlogger, brand dan UMKM, siapa saja yang punya footage mentah tapi tidak punya waktu atau skill DaVinci dan Premiere.
- **Bedanya:** editor AI lain hanya mengerti _ucapan_ (transkrip). Auteur mengerti ucapan _dan_ visual (siapa di layar, di mana, sedang apa), memeriksa hasilnya sendiri, dan hasilnya adalah **timeline yang bisa dilihat dan diubah**, bukan video tertutup.
- **Kenapa sekarang:** SAM 3.1 tersedia lewat Meta Model API dengan pelacakan dan masker per frame ($0,20 per 1.000 frame), Muse Spark bisa menonton frame dan memakai tool, dan Muse Wonder bisa menulis video sebagai kode. Kombinasi ini membuat edit berbasis isi visual murah dan otomatis.
- **Lomba:** Meta Global AI Developer Hackathon, problem statement **Build for Your World**, Indie Developer track. Submit paling lambat 4 Nov 21.00 ET (5 Nov 09.00 WIB). Semua kode dibangun 1–4 Nov, di dalam masa building 27 Okt – 4 Nov.

## Masalah & kompetitor

**Editor video AI saat ini mengerti apa yang _diucapkan_, bukan apa yang _terlihat_.** Manusia berpikir dalam isi ("bagian anakku tiup lilin", "orang asing di belakang"), sedangkan editor berpikir dalam detik. Pekerjaan seperti memblur orang lewat, mencari momen tertentu, crop vertikal yang mengikuti subjek, atau mengganti background tanpa green screen masih dikerjakan manual.

| Produk                        | Cara kerja                            | Yang belum bisa                                                                     |
| ----------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------- |
| DaVinci Resolve, Premiere Pro | Editor profesional, semua manual      | Butuh skill dan berjam-jam kerja; AI-nya hanya alat satuan (masker, upscale)        |
| Descript (Underlord)          | Agen yang mengedit dari transkrip     | Tidak mengerti visual: siapa di layar, benda apa, di mana subjek                    |
| CapCut, Captions, Opus Clip   | Potong otomatis dari ucapan, template | Tidak bisa diberi arahan bebas; hasilnya template, bukan timeline yang direncanakan |
| Runway                        | Efek visual dan generasi video        | Bukan editor; tidak menyusun cerita dari footage mentah                             |

**Pembeda Auteur Labs:**

1. Agen yang mengerti visual dan ucapan sekaligus.
2. Satu arahan bebas jadi banyak langkah edit di timeline yang bisa dilihat dan diubah; pengguna dan agen mengedit timeline yang sama dengan satu riwayat.
3. Setiap render diperiksa di luar agen (subjek di dalam frame, blur tidak bocor, durasi, warna, potongan di beat), dan agen memperbaiki sendiri masalah yang ditemukan.
4. Video dari kode dengan Muse Wonder yang memeriksa render-nya sendiri, di timeline yang sama dengan footage.
5. Editor manual yang setara editor konsumen (transisi, keyframe, LUT, teks bergaya, hapus background, dubbing), sehingga hasil agen bisa dipoles tanpa pindah aplikasi.

## Tujuan & penilaian

**Targetnya masuk 5 besar Indie Developer track, plus bonus Best Agentic Use-Case, Best Creative Build, dan Most Viral.**

Penilaian tahap dua memakai empat kriteria dengan **bobot sama**, skala 0–10. Lima besar per track masuk babak final, di mana juri menonton video demo secara langsung dengan rubrik yang sama.

| Kriteria                        | Pertanyaan juri                                                                 | Jawaban Auteur Labs |
| ------------------------------- | ------------------------------------------------------------------------------- | ------------------- |
| Impact                          | Siapa yang terbantu, seberapa penting, bisa jadi produk? Cocok dengan problem statement? | Siapa pun yang punya footage mentah membuat video siap posting dengan beberapa kalimat; pasar kreator dan brand global |
| Use of Meta AI Tooling          | Kreatif, lebih dari integrasi dasar, ada kemampuan yang mengejutkan?            | Lima model Meta lewat API plus MMS-TTS: SAM 3.1 untuk tracking, reframe, blur, dan masker piksel; Muse Spark sebagai otak dan "mata" agen; Muse Wonder menulis video sebagai kode; Muse Image; Voice Transcribe. Temuan teknis SAM (ID disambung antar segmen, 53% → 83%) |
| Technical Depth & Execution     | Engineering-nya matang dan rapi?                                                | Satu lapisan operasi untuk agen dan pengguna, pemeriksa di luar agen, preview dan export identik (tes piksel dan paritas), sandbox untuk kode dari model, 200+ tes otomatis |
| Demo                            | Jalan, tahan dipakai live, enak ditonton?                                       | Video peluncuran produk; demo publik dengan project contoh |

| Bonus                    | Syarat                                                                 | Momen di produk |
| ------------------------ | ---------------------------------------------------------------------- | --------------- |
| Best Agentic Use-Case    | Otonomi, efektivitas, kegunaan praktis                                 | Pemeriksa menemukan subjek keluar frame di versi 9:16, agen memperbaikinya tanpa diminta |
| Best Creative Build      | Proyek kreatif dengan Muse Image atau Muse Wonder                      | Video dari kode: Wonder menulis, me-render, dan memeriksa tiap adegan; Muse Image membuat shot yang tidak direkam |
| Most Viral               | Engagement post demo di X sampai 8 Nov                                 | Versi vertikal 45 detik dari video demo |

Tidak dikejar: Best Build on Meta Open Weight Models (syaratnya Muse Glimmer atau Muse Spark Open).

**Aturan yang dijaga:** demo hanya menampilkan yang dibangun selama hackathon, dan juri harus bisa melihatnya. Sebelum submit, README perlu bagian "Built during the hackathon" yang memisahkan yang dibangun dari yang dipakai (model Meta, MMS-TTS, Remotion, ffmpeg, Next.js, FastAPI, Clerk); video demo menyebutnya di kartu penutup.

## Pengguna & skenario

**Footage mentah jadi vlog adalah tulang punggung produk; skenario lain membuktikan agen dan editor bisa dipakai untuk apa saja.**

| Pengguna           | Arahan atau aksi                                                                                  | Yang terjadi                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Vlogger            | "Jadikan footage ini vlog 45 detik, buka dengan momen paling seru, buang 'eee' dan diam"           | Agen menonton dan mendengar semua klip, memilih momen, menyusun cerita, memotong filler, me-render |
| Kreator short-form | "Versi 9:16 untuk Reels, kamera selalu ke aku, kasih subtitle"                                     | SAM melacak subjek, crop mengikuti, subtitle karaoke, pemeriksa memastikan subjek di dalam frame |
| Siapa saja         | "Blur wajah semua orang kecuali cewek berhijab hitam"                                              | SAM melacak semua wajah, blur semua kecuali satu ID, pemeriksa mencari celah deteksi |
| Brand atau UMKM    | "Video produk 30 detik, warna hangat, samakan warna klip HP dengan klip kamera"                    | Grading dari arahan atau gambar referensi, diukur dengan statistik frame |
| Tanpa footage      | "Launch video 20 detik untuk aplikasiku: judul besar, tiga fitur, end card"                        | Muse Wonder menulis storyboard dan adegan Remotion, memeriksa render-nya, menaruhnya di timeline |
| Kreator global     | Klik **Dub** ke bahasa Indonesia                                                                   | Subtitle diterjemahkan Muse Spark, diucapkan MMS-TTS di waktu tiap subtitle, suara asli dikecilkan |
| Podcaster          | Hapus kata di tab **Words**                                                                        | Klip terpotong di kata itu; subtitle dan item lain ikut bergeser |
| Siapa saja         | **Remove background** dengan prompt "person"                                                       | Masker SAM per frame, latar diganti blur atau warna, tanpa green screen |
| Revisi             | Trim manual, lalu "bagian kopi kepanjangan, jadikan 4 detik"                                       | Agen membaca timeline terbaru termasuk edit manual dan melanjutkan tanpa menimpanya |

## Fitur

**Semua fitur di bawah sudah dibangun dan dites (API, editor, dan renderer), kecuali yang ditandai belum.**

### Agen (26 tool)

| Kelompok | Tool | Model atau mesin |
| --- | --- | --- |
| Memahami footage | `plan`, `listen` (transkrip), `watch` (deskripsi adegan dari frame), `track` (pelacakan objek) | Muse Spark, Voice Transcribe, SAM 3.1 |
| Menyusun | `assemble`, `remove_fillers`, `edit_timeline` (operasi apa pun), `freeze_frame` | Kode di atas lapisan operasi |
| Visual | `reframe` (crop mengikuti subjek), `effect` (blur atau sorot objek), `remove_background`, `grade` (look atau cocokkan gambar referensi), `zoom`, `speed`, `transitions`, `cinematic_finish`, `broll` | SAM 3.1, Muse Spark, kode, OpenCV, ffmpeg |
| Suara dan teks | `music`, `cut_on_beat`, `subtitles`, `translate_texts`, `voiceover` | Voice Transcribe, Muse Spark, MMS-TTS, deteksi beat |
| Generatif | `storyboard`, `build_scenes`, `generate_image` | Muse Wonder, Muse Image |
| Hasil | `render` + pemeriksa otomatis | ffmpeg, statistik frame, data track SAM |

### Editor manual

| Area | Yang ada |
| --- | --- |
| Media | Upload video, audio, gambar (PNG, JPG, WebP), GIF; import dari link (dijaga dari SSRF); upload dari HP lewat QR; maks 5 menit footage per project |
| Timeline | Split, trim, geser, hapus, duplikat; linkage (teks dan B-roll ikut klip); baris tambahan otomatis untuk item yang tumpang tindih; frame step dengan keyboard |
| Kanvas | Geser, skala, rotasi, flip langsung di preview; crop bebas; fit dengan latar blur atau warna; keyframe posisi, skala, rotasi, opacity; animasi masuk dan keluar |
| Transisi | Crossfade, dip hitam/putih, slide, wipe, circle, zoom |
| Kecepatan | Slow-mo, fast, speed ramp, reverse, freeze frame |
| Warna | Grade (exposure, kontras, saturasi, temperatur, dll.), preset look, cocokkan gambar referensi, upload LUT `.cube` dengan intensitas |
| Teks | 8 font, warna, outline, shadow, kotak latar, 7 preset, subtitle karaoke, animasi kata per kata |
| Audio | Musik dengan ducking, fade, volume keyframe, lepas audio ke track musik, waveform, bersihkan suara (noise reduction, suara lebih jelas) |
| Overlay | B-roll dengan posisi bebas, opacity, 7 blend mode, chroma key |
| AI di editor | Edit lewat transkrip (tab Words), generate gambar, voice-over dari teks, terjemahan, dubbing, hapus background |
| Video dari kode | Panel storyboard: edit adegan, ubah urutan, rebuild per adegan |
| Export | MP4 480p–4K (preset kualitas atau bitrate), GIF, MP3; aspek 16:9, 9:16, 1:1, 4:5; 24–60 fps; berjalan di background dengan progres dan batal |
| Riwayat | Setiap operasi dicatat dengan penulisnya; edit agen dikelompokkan per arahan; undo dan redo |

### Platform

| Area | Yang ada |
| --- | --- |
| Akun | Login Clerk; project hanya bisa dibuka pemiliknya |
| Biaya | Biaya tiap run tampil live; batas belanja per akun dan total; kuota run per pengunjung |
| Deploy | Satu VPS: Docker Compose dengan Caddy (HTTPS), web, dan API (ffmpeg, renderer Remotion); data dan model suara di volume |

### Belum dibangun

| Fitur | Alasan |
| --- | --- |
| Arahan lewat suara | Bukan pembeda; mengetik cukup untuk demo |
| Pilih subjek dengan klik di preview | SAM mendukung prompt kotak, tapi UI-nya belum; default-nya subjek terbesar dan terlama |
| Gaya Proyek (catatan gaya yang selalu dibaca agen) | Ditunda |
| Multi-kamera | Butuh sinkronisasi antar sumber |
| Modul 3, 5, 6, 7, 8 dari daftar perbandingan CapCut | Ditunda setelah lomba; modul 1, 2, dan 4 selesai |
| Pemeriksa yang melihat hasil render untuk blur | Pemeriksa blur saat ini membaca celah deteksi di data track, bukan piksel render |

## Model Meta & biaya

**Lima model Meta lewat Meta Model API dan satu model open weights Meta, masing-masing dengan peran yang terlihat di produk. Biaya tiap run tampil live di editor.**

| Model                 | Peran di Auteur Labs                                                                                                                              | Harga                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Muse Spark 1.3        | Otak agen: rencana, satu tool per giliran. Menonton frame sampel untuk memilih momen dan look. Menerjemahkan teks                                  | $1,25 / $4,25 per 1 juta token input / output |
| SAM 3.1 (video)       | Melacak objek dari prompt teks untuk reframe, blur, sorot, dan pemeriksa; masker piksel untuk hapus background                                   | $0,20 per 1.000 frame (min. 50 frame per request) |
| Muse Voice Transcribe | Transkrip untuk subtitle, buang filler, edit lewat transkrip, memilih momen                                                                      | $3 per 1.000 menit audio                      |
| Muse Wonder 1.0       | Video dari kode: storyboard, tiap adegan sebagai komponen Remotion, memeriksa frame render-nya sendiri dan memperbaiki teks terpotong            | $4 / $20 per 1 juta token input / output      |
| Muse Image 1.0        | Gambar dari prompt sesuai aspek project (1792×1024, 1024×1792, 1024×1024, 1024×1280)                                                             | $0,01 per gambar                              |
| MMS-TTS (open weights, `facebook/mms-tts-*`) | Voice-over dan dubbing di 15 bahasa beraksara Latin, dijalankan di CPU server                                              | Gratis; lisensi CC BY-NC 4.0                  |

Contoh biaya nyata: run agen yang menambah subtitle, membersihkan suara, dan freeze frame di klip 16 detik sekitar $0,19; run lacak wajah, blur, dan subtitle di klip 50 detik sekitar $0,45; hapus background klip 4 detik sekitar $0,01.

### Temuan teknis

Dari tes API (1 Nov) dan pembangunan:

- **SAM 3.1:** video dikirim sebagai base64 di `input_video` (tanpa URL publik), output di-parse dengan `meta-sam-parser`. Resolusi penuh 60 fps memutus koneksi, jadi SAM selalu menerima **proxy 15 fps, 640 px, tanpa audio**. Batas 16 ID objek berlaku **per request**: di adegan ramai ID habis untuk orang lewat dan subjek tidak terlacak (klip uji: 53% frame). `track` mengirim segmen 5 detik paralel dan menyambung ID antar segmen lewat overlap kotak: **53% jadi 83%**, sisanya memang subjek belum muncul. Waktu proses 1–4,5× durasi video.
- **Masker SAM untuk hapus background:** masker per frame berupa raster di dalam kotak objek; disusun jadi video grayscale di ukuran proxy, diskalakan ke sumber saat export, dan dipakai sebagai alpha. Objek utama dipilih dari luas kotak terbesar sepanjang segmen; deteksi yang hilang sebentar ditahan 7 frame.
- **Voice Transcribe:** endpoint `POST /v1/asr/transcribe` (WAV mono 24 kHz, maks 10 menit). **Tanpa timestamp per kata**; waktu kata diperkirakan dari transkrip sebagian di mode stream (tiap 80 ms) dan dirapikan ke titik hening. Kadang mengulang kata di akhir giliran.
- **Muse Spark 1.3:** gambar dan tool calling lewat Responses API; 5–7 detik per panggilan. Menerima sampai 48 frame berlabel waktu dalam satu request.
- **Muse Wonder:** kode adegan berasal dari model yang membaca teks pengguna, jadi diperlakukan tidak tepercaya: validasi parser (hanya `react`, `remotion`, dan beberapa paket Remotion), global browser dibayangi, konstruktor Function dimatikan, dan CSP yang memblokir semua request keluar.
- **Footage HP:** sering frame rate variabel dan punya flag rotasi. Semua jalur mengambil frame berdasarkan waktu atau dari proxy frame rate konstan; jalur efek OpenCV sempat menghitung waktu dari nomor frame dan meleset sampai 4,8 detik, sekarang dites dengan footage variabel dan berotasi.

## Arsitektur & alur agen

**Agen mengerjakan satu tool per giliran; pemeriksa di luar kendali agen yang memutuskan hasilnya diterima atau diulang.** Polanya rencana, aksi, hasil, verifikasi, ulang.

Loop ditulis dengan OpenAI Python SDK ke `https://api.meta.ai/v1` (Responses API). Pemeriksa dipanggil otomatis setelah render, jadi agen tidak bisa melewatinya. Masalah yang ditemukan ditandai di timeline dan dikirim balik ke agen dengan instruksi perbaikan.

**Satu lapisan operasi untuk agen dan pengguna.** Timeline adalah satu dokumen JSON yang dideskripsikan model Pydantic; tipe TypeScript editor dibuat dari model yang sama. Timeline hanya bisa diubah lewat operasi kecil yang tervalidasi (`split`, `trim`, `move`, `set_grade`, `set_bg_remove`, dan puluhan lainnya). Tool agen merangkai operasi ini; tombol dan drag di editor memanggil operasi yang sama. Akibatnya:

- **Riwayat:** setiap commit disimpan dengan penulis, waktu, arahan asal, dan timeline sebelumnya. Undo dan redo berlaku sama untuk agen dan pengguna.
- **Agen sadar edit pengguna:** setiap giliran, agen membaca timeline terbaru, jadi edit manual tidak ditimpa.
- **Linkage:** teks dan B-roll mengikuti momen sumber tempat mereka berada saat klip dipotong, dipindah, atau dipercepat; subtitle yang ucapannya terpotong ikut hilang atau memendek.

**Preview sama dengan export.** Preview di browser adalah Remotion Player yang membaca timeline JSON; export adalah ffmpeg. Setiap aturan yang ada di keduanya (crop, transform, keyframe, transisi, teks) ditulis dua kali dan dijaga dengan tes paritas dan tes piksel. Varian preview yang berat (reverse, LUT, suara dibersihkan, background dihapus, chroma key) dibuat di background dan editor diberi tahu lewat Server-Sent Events.

**Pemeriksa** mengecek: durasi dan aspek sesuai permintaan, ada audio, tidak ada klip terlalu pendek, subjek yang diikuti tetap di dalam crop, objek yang di-blur tidak punya celah deteksi, grade tidak membakar highlight atau menghancurkan bayangan, warna antar klip cocok bila diminta, cocok dengan gambar referensi, dan potongan tetap di beat.

## UI: tata letak editor

**Tata letaknya meniru editor profesional, dengan panel agen di kanan seperti Cursor.** Juri melihat agen bekerja di dalam editor, bukan di kotak chat terpisah.

1. **Kiri, media bin:** klip, gambar, audio, dengan filter jenis; tombol generate gambar, voice-over, import link, dan upload dari HP.
2. **Tengah, preview:** pemutar timeline dengan kotak tracking SAM, tombol sebelum/sesudah grading, dan handle transform di kanvas.
3. **Kanan, panel bertab:**
   - **Agent:** arahan, rencana edit sebagai checklist, log tiap langkah (planning, watching, tracking, rendering), kartu pemeriksa.
   - **Story:** storyboard video dari kode.
   - **Words:** transkrip; hapus kata untuk memotong.
   - **Inspector:** properti item yang dipilih: frame, transform, keyframe, warna, LUT, suara, hapus background, teks, terjemahan, dubbing.
   - **History:** perubahan timeline per arahan atau per edit manual, undo dan redo.
4. **Bawah, timeline:** track video, B-roll, teks, dan musik dengan baris tambahan otomatis; toolbar (split, freeze, duplikat, teks, hapus, undo, redo, linkage, snap, zoom).
5. **Atas:** aspek, fps, tema, biaya run dan total, render terakhir, export.

Saat agen menjalankan run, timeline dikunci untuk edit manual; pengguna bisa menghentikan run kapan saja.

## Stack

**Next.js untuk editor, Python untuk agen dan pemrosesan video, Node untuk merender video dari kode.**

| Lapisan        | Pilihan                                                        |
| -------------- | -------------------------------------------------------------- |
| Frontend       | Next.js 16 + TypeScript, Tailwind, Zustand, ikon Phosphor       |
| Preview        | Remotion Player membaca timeline JSON                           |
| Auth           | Clerk                                                           |
| Backend        | Python 3.12 + FastAPI, dikelola `uv`; model data Pydantic       |
| Agen           | OpenAI Python SDK ke Meta Model API (Responses API)             |
| Video          | ffmpeg, OpenCV + numpy; MMS-TTS lewat `transformers` + PyTorch CPU |
| Video dari kode | `motion/`: renderer Remotion di Node dengan Chromium headless yang di-sandbox |
| Progres live   | Server-Sent Events                                              |
| Penyimpanan    | SQLite (project, timeline, riwayat) + disk (media, render)      |
| Deploy         | Docker Compose di satu VPS: Caddy, web, api                     |
| Tes            | pytest (API), Vitest (editor), node:test (renderer)            |

```
auteur/
├── web/      # Next.js: editor, preview Remotion
├── api/      # FastAPI: agen, lapisan operasi, render ffmpeg, pemeriksa
├── motion/   # Renderer Remotion untuk video dari kode
├── deploy/   # Caddyfile, contoh .env
└── docs/     # PRD.md, DESIGN.md
```

## Demo & cara juri menguji

**Video demo 3 menit memperkenalkan produk: hasil dulu, lalu agen bekerja, pemeriksa memperbaiki kesalahan, edit manual, fitur AI, video dari kode, dan lima model Meta.**

Alurnya: hasil vlog 9:16 di detik pertama → arahan pertama (footage jadi vlog) → arahan kedua (versi 9:16, blur wajah, pemeriksa menemukan subjek keluar frame dan agen memperbaikinya) → edit manual dan lewat transkrip → hapus background, dubbing, Muse Image → video dari kode dengan Muse Wonder → lima model Meta dan biaya → link untuk mencoba. Setiap model Meta diberi label namanya di layar saat bekerja.

Cara juri menguji: link publik dengan login, project contoh berisi footage siap pakai, dan opsi upload footage sendiri. Batas belanja per akun dan kuota run membatasi biaya. Repo publik; README memisahkan apa yang dibangun selama hackathon dari yang dipakai (belum ditulis, lihat Tujuan & penilaian).

## Risiko

| Risiko                                                    | Dampak                             | Penanganan                                                                       |
| --------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------- |
| SAM lambat (1–4,5× durasi) dan waktunya tidak stabil      | Demo live terasa lama              | Segmen 5 detik paralel; kotak tampil bertahap; masker disimpan per media dan prompt |
| Batas 16 ID objek SAM habis di adegan ramai               | Subjek tidak terlacak              | Segmen pendek dan ID disambung antar segmen                                      |
| Tanpa timestamp per kata dari Voice Transcribe            | Potongan dan subtitle meleset      | Perkiraan dari transkrip sebagian, dirapikan ke titik hening                     |
| Footage HP frame rate variabel dan berotasi               | Efek atau masker di waktu yang salah | Frame diambil berdasarkan waktu atau dari proxy frame rate konstan; dites        |
| Kode adegan dari model tidak tepercaya                    | Eksekusi kode berbahaya            | Validasi parser, global dibayangi, CSP, render hanya di server                   |
| Biaya demo publik                                         | Kredit habis                       | Batas belanja per akun ($3) dan total ($25), kuota run, batas export 1080p di server |
| Model suara pertama kali di-download (~145 MB per bahasa) | Dub pertama lambat                 | Disimpan di volume data, sekali per bahasa                                       |
| MMS-TTS berlisensi CC BY-NC                               | Tidak bisa dipakai di produk berbayar | Cukup untuk lomba; ganti model suara sebelum komersial                         |
| Pemeriksa blur hanya membaca data track                   | Bug render blur tidak tertangkap   | Tes otomatis untuk jalur efek; pemeriksa berbasis piksel di roadmap              |
| Data video demo                                           | Butuh izin orang di video          | Rekam footage sendiri; wajah orang asing di-blur                                 |
