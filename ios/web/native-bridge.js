// À brancher dans cloud/public/app.js en PHASE 3 (pas encore actif).
// Dans la coque iPhone, « Enregistrer » utilise l'enregistreur natif ; dans Safari, rien ne change (raccourcis).

const native = window.Capacitor?.isNativePlatform?.() ? window.Capacitor.Plugins.EcamRecorder : null;

// Remplace record(ev) quand on est dans la coque
async function recordNative(ev) {
  await api('/arm', { method: 'POST', json: ev });          // le cours qui recevra l'enregistrement
  await native.start({ course: ev.subject, uploadUrl: await linkFor('upload') });
  recordingSheet(ev);
}

// Écran d'enregistrement : chrono, Pause / Reprendre, Arrêter et envoyer
function recordingSheet(ev) {
  openSheet(`<h2>${icon('mic')} Enregistrement</h2><p class="note">${esc(ev.subject)}</p>
    <div class="rec-time" id="r-time">00:00</div>
    <button class="btn secondary" id="r-pause">Pause</button>
    <button class="btn" id="r-stop">Arrêter et envoyer</button>
    <p class="note">Tu peux verrouiller l'écran ou changer d'app : l'enregistrement continue (Dynamic Island).</p>`, (sh) => {
    const tick = setInterval(async () => {
      const s = await native.status();
      if (!s.active) return clearInterval(tick);
      const t = Math.floor(s.seconds);
      $('#r-time', sh).textContent = `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
      $('#r-pause', sh).textContent = s.recording ? 'Pause' : 'Reprendre';
    }, 1000);
    $('#r-pause', sh).onclick = async () => ((await native.status()).recording ? native.pause() : native.resume());
    $('#r-stop', sh).onclick = async () => { clearInterval(tick); await native.stop(); closeSheet(); toast('Envoi en cours — tu seras notifié'); };
  });
}

// Branchement (phase 3) : dans bind(), remplacer
//   on('rec', () => (store.get('recReady') ? record(ev) : recGuide(ev)));
// par
//   on('rec', () => (native ? recordNative(ev) : store.get('recReady') ? record(ev) : recGuide(ev)));
