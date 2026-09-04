# 📺 Turkcell TV+ Web - IPTV & VOD Web Player

Turkcell TV+ tasarım dili ve kullanıcı deneyiminden ilham alınarak geliştirilmiş, modern, hızlı ve temiz bir Web IPTV & VOD oynatıcısı.

![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)
![Express](https://img.shields.io/badge/Express-4.19-blue.svg)
![TailwindCSS](https://img.shields.io/badge/Tailwind-CSS-38bdf8.svg)
![Video.js / Hls.js](https://img.shields.io/badge/Streaming-HLS%20%7C%20TS%20%7C%20MKV%20%7C%20MP4-orange.svg)
![License](https://img.shields.io/badge/License-MIT-yellow.svg)

---

## ✨ Özellikler

### 1. 📡 Canlı TV & 3 Sütunlu Kanal Rehberi
- **TV+ Hero Vitrini & Kanallarım Şeridi**: Popüler ve son izlenen kanallara tek tıkla erişim.
- **3 Sütunlu Orijinal Rehber Layout**:
  - Sol Sütun: Kategoriler (Ulusal, Haber, Spor, Belgesel, Müzik, Çocuk vb.).
  - Orta Sütun: Kanal Listesi (Özel TV+ logo rozetleri, beIN Sports etiketleme).
  - Sağ Sütun: Yayın Akışı (EPG), saat çizelgesi ve program detayları.
- **Favori Kanallar**: Beğendiğiniz kanalları yıldızlayarak favorilerinize ekleyin ve `/favorilerim` sayfasından hızlıca erişin.

### 2. 🎬 Sinema & Filmler (VOD)
- 60'tan fazla temiz sinema kategorisi (Vizyon 2025/2026, Vizyon 2024, Yerli Sinema, Aksiyon, Bilim Kurgu vb.).
- TMDB yüksek çözünürlüklü afişler, IMDb puanları ve yapım yılları.
- Canlı arama ve filtreleme.

### 3. 🍿 Diziler & Sezon / Bölüm Seçici (VOD)
- Popüler platform kategorileri (Netflix, BluTV & HBO, Exxen, Tabii, TOD / beIN, Prime Video, Disney+ vb.).
- Özel dizi detay modalı: Konu özeti, oyuncu kadrosu, tür ve puan.
- Sezon sekmeleri ve bölümleri resimli/süreli listeleyip anında oynatma.

### 4. 🛡️ %100 Güvenli Aile / Yetişkin Filtresi
- Canlı TV, film ve dizi kategorilerindeki tüm yetişkin (`XXX`, `Adult`, `Porn`, `+18`) içerikler sunucu seviyesinde tamamen filtrelenir. Aile ve çocuklar için güvenli bir izleme deneyimi sunar.

### 5. 📺 Smart TV & Harici Cihaz Desteği
- **Smart TV M3U Akışı**: Akıllı televizyonunuzdaki TiviMate, IPTV Smarters veya VLC üzerinden `http://[IP-ADRESI]:3000/tv.m3u` linkiyle filtrelenmiş canlı yayınları izleyebilirsiniz.
- **Xtream Player API Uyumluluğu**: `/player_api.php` uç noktası sayesinde IPTV uygulamalarına doğrudan giriş yapılabilir.

### 6. ⚡ Gelişmiş Medya Sunucusu (HTTP 206 Range Proxy)
- HLS (.m3u8), TS, MP4 ve MKV formatlarında kesintisiz yayın.
- HTTP 206 Partial Content desteği ile büyük film ve dizi dosyalarında anında ileri/geri sarma.
- Arka planda ses kalmasını engelleyen 0ms ses boru hattı sıfırlaması.

### 7. ⚙️ Uygulama İçi Ayarlar & `.env` Yönetimi
- Tarayıcı arayüzünden doğrudan IPTV sunucusu, kullanıcı adı ve şifre yapılandırması.
- Uzun M3U linkini yapıştırınca otomatik ayrıştırma.
- Canlı bağlantı testi ve sunucuyu yeniden başlatmadan otomatik liste yenileme.

---

## 🚀 Hızlı Başlangıç

### Gereksinimler
- [Node.js](https://nodejs.org/) (v18 veya üzeri önerilir)
- Bir IPTV / Xtream Codes sağlayıcı hesabı

### Kurulum

1. **Depoyu klonlayın:**
   ```bash
   git clone https://github.com/cemalkuller/tvplus-web.git
   cd tvplus-web
   ```

2. **Bağımlılıkları yükleyin:**
   ```bash
   npm install
   ```

3. **Ortam dosyasını hazırlayın:**
   `.env.example` dosyasını `.env` olarak kopyalayın ve IPTV bilgilerinizi girin:
   ```bash
   cp .env.example .env
   ```
   `.env` içeriği:
   ```env
   PORT=3000
   IPTV_HOST=http://iptv-sunucu-adresi.com:8080
   IPTV_USERNAME=kullanici_adiniz
   IPTV_PASSWORD=sifreniz
   ```
   *(Not: Bilgileri daha sonra web arayüzündeki **⚙️ Ayarlar** penceresinden de girebilirsiniz.)*

4. **Uygulamayı başlatın:**
   ```bash
   npm start
   ```
   *(Windows için doğrudan `start.bat` dosyasına çift tıklayarak da başlatabilirsiniz.)*

5. **Tarayıcınızda açın:**
   ```
   http://localhost:3000
   ```

---

## 🌐 Sayfa Bağlantıları & Rotalar

| Sayfa | Rota | Açıklama |
| :--- | :--- | :--- |
| **Canlı TV** | `/canli-tv` | Hero vitrini, kanallar şeridi ve canlı yayınlar |
| **Kanal Listesi** | `/kanal-listesi` | 3 sütunlu TV+ yayın akışı rehberi |
| **Filmler** | `/filmler` | Vizyon ve platform filmleri |
| **Diziler** | `/diziler` | Platform dizileri, sezon ve bölüm seçici |
| **Favorilerim** | `/favorilerim` | Yıldızlanan kanallar |
| **Smart TV M3U** | `/tv.m3u` | TV ve harici oynatıcılar için filtrelenmiş liste |

---

## 🛠️ Teknolojiler
- **Backend**: Node.js, Express.js, Axios / Fetch Streams
- **Frontend**: Vanilla JavaScript (SPA Mimari), Tailwind CSS, Video.js, Hls.js
- **Yapılandırma**: Dotenv / Dynamic ES6 Getters

---

## 📄 Lisans
Bu proje [MIT](LICENSE) lisansı ile lisanslanmıştır. Kişisel kullanım ve eğitim amaçlıdır.
