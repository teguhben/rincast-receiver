/* RinCast Custom Receiver v2.9 — logika pemain TV.
 *
 * Alur subtitle ASS (3 jalur, urutan prioritas):
 *  1. FETCH: SubtitleOctopus memuat assUrl (dari LOAD customData).
 *     Bisa gagal bila browser Cast TV memblokir fetch http://IP dari
 *     halaman https (mixed content) — Chromium memblokirnya secara
 *     default; TV ini mungkin longgar (video http:// jalan di DMR),
 *     tapi belum terbukti.
 *  2. DORONG (push): pengirim mengirim isi ASS lewat namespace khusus
 *     urn:x-cast:com.rin.rincast.subs, potongan base64 16KB, lewat kanal
 *     Cast TLS yang sama — TIDAK kena mixed content. Jalur ini yang
 *     dijamin sampai; fetch hanya jalur cepat.
 *  3. VTT: bila ASS gagal (dan tidak ada dorongan), pasang track VTT
 *     sebagai <track> di elemen video (jalur media, sama seperti DMR).
 *     Pesan singkat tampil di TV, jangan diam.
 *
 * API yang dipakai (terverifikasi dari dokumen resmi Google Cast +
 * README resmi SubtitleOctopus, bukan dari ingatan):
 *  - cast.framework.CastReceiverContext#getInstance, getPlayerManager
 *  - playerManager.setMediaElement(video)
 *  - playerManager.setMessageInterceptor(LOAD, fn)
 *  - context.addCustomMessageListener(namespace, fn)
 *  - CastReceiverOptions.customNamespaces (wajib sebelum start;
 *    tanpa ini namespace khusus tidak terdaftar)
 *  - new SubtitlesOctopus({video, subUrl/subContent, workerUrl,
 *    legacyWorkerUrl, fallbackFont, onReady, onError})
 *  - instance.setTrackByUrl / setTrack / freeTrack / dispose
 */
(function () {
  'use strict';

  var NS_SUBS = 'urn:x-cast:com.rin.rincast.subs';

  var video = document.getElementById('video');
  var overlay = document.getElementById('overlay');
  var overlayText = document.getElementById('overlay-text');
  var overlayFile = document.getElementById('overlay-file');
  var msgBox = document.getElementById('msg');
  var msgText = document.getElementById('msg-text');

  var octopus = null;     // instance SubtitleOctopus yang aktif
  var assActive = false;  // true bila ASS sedang dirender
  var vttTrackEl = null;  // elemen <track> VTT cadangan
  var pending = { videoUrl: '', assUrl: '', vttUrl: '', fileName: '' };
  var pushBuf = null;     // {id, total, parts[], received}
  var assWatchdog = null; // timer: ASS tak kunjung siap -> VTT

  function showOverlay(text, file) {
    overlayText.textContent = text || '';
    overlayFile.textContent = file || '';
    overlay.className = '';
  }
  function hideOverlay() { overlay.className = 'hidden'; }
  function showMsg(t) { msgText.textContent = t; msgBox.style.display = 'block'; }
  function hideMsg() { msgBox.style.display = 'none'; }

  function clearWatchdog() {
    if (assWatchdog !== null) { clearTimeout(assWatchdog); assWatchdog = null; }
  }

  function disposeOctopus() {
    clearWatchdog();
    if (octopus) {
      try { octopus.dispose(); } catch (e) { /* sudah mati */ }
      octopus = null;
    }
    assActive = false;
  }

  function removeVttTrack() {
    if (vttTrackEl) {
      try { vttTrackEl.track.mode = 'disabled'; } catch (e) { /* abaikan */ }
      if (vttTrackEl.parentNode) vttTrackEl.parentNode.removeChild(vttTrackEl);
      vttTrackEl = null;
    }
  }

  /* Jalur 3 — VTT sebagai <track> di elemen video (jalur media,
   * sama seperti yang dipakai Default Media Receiver hari ini). */
  function attachVttTrack() {
    if (!pending.vttUrl || vttTrackEl) return;
    var tr = document.createElement('track');
    tr.kind = 'subtitles';
    tr.label = 'Indonesia';
    tr.srclang = 'id';
    tr.src = pending.vttUrl;
    tr['default'] = true;
    tr.addEventListener('load', function () {
      try { tr.track.mode = 'showing'; } catch (e) { /* abaikan */ }
    });
    video.appendChild(tr);
    vttTrackEl = tr;
  }

  function onAssReady() {
    assActive = true;
    clearWatchdog();
    hideMsg();
    removeVttTrack();
  }

  function onAssFailed() {
    if (assActive) return;
    clearWatchdog();
    if (pending.vttUrl) {
      showMsg('Subtitle ASS gagal dimuat \u2014 memakai VTT.');
      attachVttTrack();
    } else {
      showMsg('Subtitle ASS gagal dimuat.');
    }
  }

  /* Pengaman: kalau onError tidak pernah terpanggil (mis. worker diam),
   * setelah 8 detik anggap ASS gagal supaya TV tidak diam tanpa subtitle. */
  function armWatchdog() {
    clearWatchdog();
    assWatchdog = setTimeout(function () {
      assWatchdog = null;
      if (!assActive) onAssFailed();
    }, 8000);
  }

  function createOctopus(opts) {
    disposeOctopus();
    removeVttTrack();
    hideMsg();
    var base = {
      video: video,
      workerUrl: 'libass/subtitles-octopus-worker.js',
      legacyWorkerUrl: 'libass/subtitles-octopus-worker-legacy.js',
      fallbackFont: 'fonts/MPLUS1-Regular.ttf',
      onReady: onAssReady,
      onError: onAssFailed
    };
    if (opts.subUrl) base.subUrl = opts.subUrl;
    if (opts.subContent) base.subContent = opts.subContent;
    try {
      octopus = new SubtitlesOctopus(base);
      armWatchdog();
    } catch (e) {
      onAssFailed();
    }
  }

  /* Jalur 1 — fetch assUrl lewat SubtitleOctopus. */
  function startAssFromPending() {
    if (pending.assUrl) {
      createOctopus({ subUrl: pending.assUrl });
    } else if (pending.vttUrl) {
      attachVttTrack();
    }
    /* Tanpa subtitle sama sekali: tidak ada overlay, tidak error. */
  }

  /* Jalur 2 — dorongan ASS lewat namespace khusus. Pesan:
   *  {type:'ASS_CHUNK', id, seq, total, data(base64)}
   *  {type:'ASS_END', id, total}
   * Potongan disusun ulang, di-decode base64 -> teks ASS, lalu
   * dirender lewat subContent (tanpa fetch sama sekali). */
  function onSubsMessage(event) {
    var d = event && event.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'ASS_CHUNK') {
      if (!pushBuf || pushBuf.id !== d.id) {
        pushBuf = { id: d.id, total: d.total, parts: [], received: 0 };
      }
      if (d.seq === 0) {
        pushBuf.parts = [];
        pushBuf.received = 0;
        pushBuf.total = d.total;
      }
      if (typeof d.seq === 'number' && typeof d.data === 'string'
          && !pushBuf.parts[d.seq]) {
        pushBuf.parts[d.seq] = d.data;
        pushBuf.received++;
      }
    } else if (d.type === 'ASS_END') {
      if (!pushBuf || pushBuf.id !== d.id) return;
      if (pushBuf.received < pushBuf.total) return; /* belum lengkap */
      var b64 = '';
      for (var i = 0; i < pushBuf.total; i++) b64 += (pushBuf.parts[i] || '');
      pushBuf = null;
      var text = null;
      try {
        var bin = atob(b64);
        var bytes = new Uint8Array(bin.length);
        for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
        text = new TextDecoder('utf-8').decode(bytes);
      } catch (e) { text = null; }
      if (text) {
        if (assActive) return; /* jalur fetch sudah menang */
        createOctopus({ subContent: text });
      }
    }
  }

  /* LOAD dari pengirim: customData dibaca di sini (media.customData
   * dulu, lalu customData tingkat atas sebagai cadangan). */
  function onLoad(loadRequestData) {
    var cd = null;
    if (loadRequestData.media && loadRequestData.media.customData) {
      cd = loadRequestData.media.customData;
    } else if (loadRequestData.customData) {
      cd = loadRequestData.customData;
    }
    disposeOctopus();
    removeVttTrack();
    pushBuf = null;
    pending = { videoUrl: '', assUrl: '', vttUrl: '', fileName: '' };
    if (cd) {
      if (cd.videoUrl) pending.videoUrl = cd.videoUrl;
      if (cd.assUrl) pending.assUrl = cd.assUrl;
      if (cd.vttUrl) pending.vttUrl = cd.vttUrl;
      if (cd.fileName) pending.fileName = cd.fileName;
    }
    showOverlay('Memutar', pending.fileName);
    startAssFromPending();
    return loadRequestData;
  }

  video.addEventListener('playing', function () { hideOverlay(); });
  video.addEventListener('ended', function () {
    disposeOctopus();
    removeVttTrack();
    showOverlay('Selesai', pending.fileName);
  });
  video.addEventListener('error', function () {
    showOverlay('Video gagal dimuat', pending.fileName);
  });

  var context = cast.framework.CastReceiverContext.getInstance();
  var playerManager = context.getPlayerManager();
  playerManager.setMediaElement(video);
  context.addCustomMessageListener(NS_SUBS, onSubsMessage);
  playerManager.setMessageInterceptor(
    cast.framework.messages.MessageType.LOAD, onLoad);
  var options = new cast.framework.CastReceiverOptions();
  options.customNamespaces = {};
  options.customNamespaces[NS_SUBS] =
    cast.framework.system.MessageType.JSON;
  context.start(options);
})();
