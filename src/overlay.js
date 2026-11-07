/**
 * The small HTML card shown in a normal browser window: status and "Masuk VR".
 * It hides itself while you are inside VR.
 */
export function setupOverlay(app) {
  const hud = document.getElementById('hud');
  const status = document.getElementById('status');
  const enterBtn = document.getElementById('enter-vr');
  const sessionInit = { optionalFeatures: ['local-floor', 'bounded-floor', 'hand-tracking', 'layers'] };
  let session = null;

  async function enterVR() {
    if (session) return;
    try {
      session = await navigator.xr.requestSession('immersive-vr', sessionInit);
      session.addEventListener('end', () => { session = null; });
      await app.renderer.xr.setSession(session);
      // a steady 90 Hz feels smoother than 120 Hz that keeps dropping
      if (session.supportedFrameRates?.includes?.(90)) session.updateTargetFrameRate(90).catch(() => {});
    } catch (err) {
      session = null;
      status.textContent = `VR tidak bisa dimulai (${err.message}). Tekan Masuk VR lagi.`;
    }
  }

  if ('xr' in navigator) {
    navigator.xr.isSessionSupported('immersive-vr').then((ok) => {
      if (!ok) {
        status.textContent = 'Pratinjau desktop. Buka di Meta Quest 3 untuk VR.';
        return;
      }
      enterBtn.hidden = false;
      status.textContent = 'Headset VR siap.';
      if (window.matchMedia('(display-mode: standalone)').matches) enterVR();
    }).catch(() => {
      status.textContent = 'Pratinjau desktop. VR tidak tersedia di sini.';
    });
    navigator.xr.addEventListener?.('sessiongranted', enterVR);
  } else {
    status.textContent = window.isSecureContext
      ? 'Pratinjau desktop. Browser ini tidak punya WebXR.'
      : 'Pratinjau desktop. VR butuh https:// atau localhost.';
  }

  enterBtn.addEventListener('click', () => { app.sfx.unlock(); enterVR(); });
  app.on((type, value) => { if (type === 'xr') hud.hidden = value; });
}
