# OFLIX React — Mobile Streaming App

Versi React dari OFLIX, dioptimalkan untuk mobile. Deploy ke Vercel via GitHub.

---

## 🚀 Setup & Deploy ke Vercel

### 1. Ganti Domain Backend di `vercel.json`

Edit file `vercel.json`, ganti semua `GANTI_DOMAIN_KAMU` dengan domain PHP server kamu:

```json
{ "source": "/cache_api.php", "destination": "https://oflix.id/cache_api.php" }
```

### 2. Push ke GitHub

```bash
git init
git add .
git commit -m "init oflix react"
git remote add origin https://github.com/username/oflix-react.git
git push -u origin main
```

### 3. Deploy di Vercel

1. Buka [vercel.com](https://vercel.com) → Import Project dari GitHub
2. Framework: **Vite**
3. Build command: `npm run build`
4. Output dir: `dist`
5. Deploy!

---

## 📁 Struktur Halaman

| Path              | Deskripsi                                          |
|-------------------|----------------------------------------------------|
| `/`               | Beranda — Hero + section horizontal per kategori  |
| `/film`           | Listing film (fetch `/cache_api.php?action=trending`) |
| `/film?cat=indonesian-movies` | Film Indonesia                      |
| `/series`         | Listing series (fetch `western-tv` dll)            |
| `/series?cat=kdrama` | Filter K-Drama                                  |
| `/donghua`        | Coming Soon                                        |
| `/komik`          | Listing komik (fetch `/komik_api.php`)             |
| `/komik/detail`   | Detail komik + list chapter                        |
| `/search`         | Pencarian gabungan (film + donghua + komik)        |
| `/detail`         | Detail film/series + video player custom           |

---

## 🖼️ Aset yang Perlu Ditaruh di `public/`

| File           | Keterangan                        |
|----------------|-----------------------------------|
| `logo.png`     | Logo untuk preloader (140px lebar)|
| `logo.svg`     | Logo untuk header                 |
| `favicon.svg`  | Favicon                           |
| `unknown-cast.png` | Fallback avatar cast          |

---

## ⚙️ Backend API

| File                | Digunakan untuk                          |
|---------------------|------------------------------------------|
| `cache_api.php`     | Film, series, detail, search             |
| `auth_api.php`      | Login, register, verify token, CW sync  |
| `komik_api.php`     | Komik list, detail, search               |
| `donghua_api.php`   | Donghua (coming soon)                    |
| `stream.php`        | Ambil URL video stream                   |
| `subtitle-proxy.php`| Proxy subtitle VTT                       |
| `panel_api.php`     | Ping analytics                           |

---

## 🎬 Video Player

Custom HTML5 player dengan:
- ✅ HLS.js support (m3u8)
- ✅ Subtitle track (via subtitle-proxy.php)
- ✅ Episode list panel
- ✅ Resume dari posisi terakhir
- ✅ Auto-next episode
- ✅ Fullscreen + landscape lock

---

## 📱 Fitur

- Mobile-only layout (max-width 430px, centered di desktop)
- Bottom navigation (Beranda, Cari, Akun)
- Auth modal (login/register)
- Continue watching
- Like / Dislike / Daftar tonton (localStorage)
- Preloader dengan `/logo.png`
