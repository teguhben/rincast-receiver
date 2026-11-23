# RinCast Custom Receiver — v2.9

Pemain TV RinCast sendiri. TV menjalankan halaman ini (bukan receiver
bawaan Google) supaya subtitle ASS tampil native — posisi, warna,
miring, tebal, dan tanda — persis seperti di MX Player.

## Isi paket

| File | Isi | Ukuran |
|---|---|---|
| `index.html` | Halaman receiver (video + overlay idle/loading) | ~2,5 KB |
| `receiver.js` | Logika receiver (CAF + SubtitleOctopus + push ASS) | ~8,5 KB |
| `libass/subtitles-octopus.js` | SubtitleOctopus 4.2.4 (Jellyfin fork) | 96 KB |
| `libass/subtitles-octopus-worker.js` | Worker WASM | 413 KB |
| `libass/subtitles-octopus-worker-legacy.js` | Worker asm.js (fallback browser lama) | 4,8 MB |
| `libass/subtitles-octopus-worker.wasm` | libass WebAssembly | 2,3 MB |
| `libass/default.woff2` | Font default (Liberation Sans, Latin) | 146 KB |
| `fonts/MPLUS1-Regular.ttf` | Font cadangan CJK (M PLUS 1, OFL) — 5.289 ideograf CJK, terverifikasi memuat karakter adegan tes (小町ちゃんねる登録者数視聴回) | 1,8 MB |
| `libass/COPYRIGHT`, `libass/LICENSE` | Lisensi rantai libass dkk. | — |

Total ±9,2 MB. Satu-satunya yang dimuat dari CDN adalah CAF SDK
Google (`//www.gstatic.com/cast/sdk/libs/caf_receiver/v3/cast_receiver_framework.js`)
— wajib dari gstatic. Tidak ada gambar resmi Rin Tohsaka / logo Fate.

## URL yang harus di-hosting

Host seluruh isi folder ini di satu alamat HTTPS publik, dengan
`index.html` di root. Contoh bila memakai GitHub Pages
(repo `rincast-receiver`, branch utama):

```
https://<username>.github.io/rincast-receiver/index.html
```

URL persis itulah yang didaftarkan di Google Cast Console (di bawah).
Jangan ubah struktur subfolder (`libass/`, `fonts/`) — path di
`receiver.js` relatif terhadap `index.html`.

## Registrasi (parent yang urus — butuh akun Google Teguh)

1. Buka **Google Cast SDK Developer Console**: https://cast.google.com/publish
   (login akun Google Teguh).
2. **Add New Application → Custom Receiver**.
3. Name: `RinCast`. Receiver URL: URL `index.html` di atas.
4. Simpan → catat **Application ID** yang diberikan Google
   (format 8 karakter heks, mis. `AB12CD34`).
5. **Publish** aplikasi receiver supaya semua perangkat Cast bisa
   memakainya (atau, untuk tes saja: daftarkan serial TV sebagai
   test device dan biarkan unpublished).
6. Masukkan Application ID itu ke `MainActivity.java`, konstanta
   `CUSTOM_RECEIVER_APP_ID` (saat ini placeholder
   `"RECEIVER_APP_ID_BELUM_DIDAFTAR"`), lalu build ulang APK.
   Sampai placeholder diganti, v2.9 berperilaku persis v2.8
   (receiver bawaan CC1AD845 + VTT).

## Cara kerja subtitle (3 jalur)

1. **FETCH** — receiver memuat `assUrl` dari LOAD `customData` lewat
   SubtitleOctopus. Jalur cepat, tapi BISA GAGAL bila browser Cast TV
   memblokir fetch `http://IP` dari halaman `https` (mixed content).
   Chromium memblokirnya secara default; TV ini mungkin longgar
   (video `http://` jalan di DMR), tapi belum terbukti.
2. **DORONG (push)** — pengirim mengirim isi file ASS lewat namespace
   khusus `urn:x-cast:com.rin.rincast.subs`, potongan base64 16 KB,
   lewat kanal Cast TLS yang sama. Dijamin sampai (tidak kena mixed
   content). Jalur ini yang membuat fitur ini tetap jalan walau
   fetch diblokir. Receiver memakai jalur yang berhasil lebih dulu.
3. **VTT** — bila ASS gagal dan tidak ada dorongan: receiver memasang
   VTT sebagai `<track>` di elemen video + menampilkan pesan singkat
   di TV (`Subtitle ASS gagal dimuat — memakai VTT.`).

Video tanpa subtitle: tidak ada overlay, tidak error. Ganti video:
renderer lama dibersihkan (`dispose()` + hapus `<track>`).

## Batasan yang diketahui (v2.9)

- Tombol Sub on/off di HP tidak berpengaruh di receiver custom
  (tidak ada track teks CAF yang bisa di-EDIT_TRACKS). Subtitle
  selalu tampil bila ada. Ukuran subtitle % di HP juga tidak
  berpengaruh (ukuran diatur file ASS sendiri).
- Font persis fansub (mis. nama font khusus) hanya tampil bila
  font itu ada di `fallbackFont` (M PLUS 1) atau font default;
  font attachment dari MKV belum diekstrak.
- `{\p}` drawing: dirender libass sebagai grafik vektor (bukan teks).
- Tes TV asli (apakah fetch lolos, apakah WASM jalan di browser
  Cast Samsung ini, apakah posisi/warna sama seperti MX) hanya bisa
  dibuktikan di TV Teguh — lihat laporan build.

## Library — klaim yang diverifikasi (bukan dari ingatan)

- **SubtitleOctopus, Jellyfin fork `@jellyfin/libass-wasm` 4.2.4**
  (npm, tarball diverifikasi isinya 2026-11-23): `new
  SubtitlesOctopus({video, subUrl/subContent, workerUrl,
  legacyWorkerUrl, fallbackFont, onReady, onError})`,
  `setTrackByUrl/setTrack/freeTrack/dispose` — dari README resmi
  Stremio/Jellyfin (repo sama). Paket `@stremio/libass-wasm` yang
  disebut README ternyata TIDAK ada di npm (404) — dipakai fork
  Jellyfin yang terbukti ada.
- **JASSUB 2.5.37 DITOLAK** untuk receiver ini: butuh WASM +
  OffscreenCanvas + `requestVideoFrameCallback` + (untuk
  multi-thread) header COOP/COEP — ketiganya berisiko di browser
  Cast TV yang versinya tidak diketahui, dan GitHub Pages tidak
  bisa menyetel header COOP/COEP.
- **CAF Receiver SDK v3**: `CastReceiverContext#getInstance`,
  `getPlayerManager`, `playerManager.setMediaElement(video)`,
  `setMessageInterceptor(LOAD, ...)`,
  `context.addCustomMessageListener(ns, fn)`,
  `CastReceiverOptions.customNamespaces` (wajib sebelum `start()`),
  `CastReceiverOptions.mediaElement` — dari referensi resmi
  developers.google.com/cast (index-all + core_features).
- **Mixed content**: commit Chromium `03c9add` — fetch ke
  `http://IP` dari halaman `https` diblokir di Chromium (kecuali
  Fuchsia). DMR tetap memutar video `http://` di TV ini, jadi
  perilaku TV ini belum tentu sama — itulah alasan jalur dorong.
