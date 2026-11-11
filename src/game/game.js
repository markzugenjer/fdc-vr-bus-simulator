import * as THREE from 'three';
import { P } from './palette.js';
import { buildWorld, LANE, WALK, ROAD_HALF } from './world.js';
import { buildBus, DRIVER_EYE, SEAT_TOP } from './bus.js';
import { BUS, drawLogo, drawQR, WEBSITE } from './livery.js';
import { Driver } from './drive.js';
import { Traffic } from './traffic.js';
import { buildHud } from './hud.js';
import { Vignette } from './comfort.js';
import { ChillMusic } from './music.js';
import { makePerson, animatePerson, RIG, ShadowPool } from './people.js';
import { config, CHOICES } from './config.js';
import { makePanel, makeButton, tickButtons, text, roundRect, card, wrap } from '../core/ui.js';
import { rng, store } from '../core/util.js';

/**
 * FDC Smile Bus: the game.
 *
 *   title    you stand beside the Smile Bus at the FDC clinic; start, settings, how to play
 *   drive    from the driver's seat: follow the route, stop in the green zone at each halte,
 *            open the door, let everyone board, close it, drive on; obey the traffic lights;
 *            drive smoothly to keep the passengers smiling
 *   finish   back at the clinic: open the door, everyone gets off for their check-up
 *   result   score, stars, the FDC app QR, play again
 */
const FROM_LOBBY = (() => {
  const q = new URLSearchParams(location.search).get('from') === 'lobby';
  try { if (q) sessionStorage.setItem('fdc.bus.from', 'lobby'); return sessionStorage.getItem('fdc.bus.from') === 'lobby'; } catch { return q; }
})();
const LOBBY_URL = location.port === '5177' ? `${location.protocol}//${location.hostname}:5173/?from=bus` : '/?from=bus';
const BEST_KEY = 'fdc.bus.best';
const DOOR_LOCAL = new THREE.Vector3(-BUS.width / 2 - 0.7, 0.16, -(BUS.door[0] + BUS.door[1]) / 2);

export function createGame(app) {
  const rand = rng(11);
  const group = new THREE.Group();
  const world = buildWorld({ rand });
  const route = world.route;
  const L = route.length;
  group.add(world.group);
  const bus = buildBus(app);
  group.add(bus.group);
  const traffic = new Traffic(route, world, { rand });
  group.add(traffic.group);
  const hud = buildHud(bus, route);
  const driver = new Driver(app, route);
  const vignette = new Vignette(app.camera);
  const music = new ChillMusic(app, { volume: 0.2 });
  const sfx = app.sfx;
  const fx = new Confetti(group);
  // soft shadows under everyone on foot (one instanced mesh)
  const shadows = new ShadowPool(96);
  group.add(shadows.mesh);
  let mirrorTick = 0;
  let everHeld = false; // show the "hold the wheel here" hint until the player first grabs it
  const shadowList = () => (alighting.length ? [...world.people, ...alighting.filter((p) => !world.people.includes(p))] : world.people);

  // controller "hands" (small mitts so you can see your hands on the wheel)
  const hands = app.pointers.controllers.map((p) => {
    const m = new THREE.Group();
    const mitt = new THREE.Mesh(new THREE.SphereGeometry(0.035, 14, 10), new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.4 }));
    mitt.scale.set(1, 0.8, 1.3);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.03, 0.01, 6, 16), new THREE.MeshStandardMaterial({ color: P.busGreen, roughness: 0.5 }));
    cuff.position.z = 0.04;
    m.add(mitt, cuff);
    p.object.add(m);
    return m;
  });

  // ------------------------------------------------------------------ state
  let state = 'title';
  let paused = false;
  let lap = 0;
  let lastS = world.CLINIC_S;
  let sAbs = world.CLINIC_S;
  let stopIdx = 0; // 0..2 = halte, 3 = clinic
  let served = false;
  let boarding = null;
  let seated = [];
  let score = 0;
  let smile = 1;
  let time = 0;
  let lightsPassed = new Set();
  let msgTimer = 0;
  let resultT = 0;
  let carHitCd = 0;
  let finishIn = 0; // countdown from arriving at the clinic to the result board
  const stats = { stops: [], red: 0, bumps: 0, cars: 0, missed: 0 };
  const seat = { offset: new THREE.Vector3(0, 1.6, 0), yawOff: 0 };
  const targets = () => [...world.stops.map((st) => ({ abs: st.s, name: st.name, st })), { abs: L + world.CLINIC_S, name: 'FDC Dental Clinic', final: true }];

  hud.nav.stops = [...world.stops.map((st, i) => ({ ...route.at(st.s), icon: `${i + 1}`, st })), { ...route.at(world.CLINIC_S), icon: '+', final: true }];
  hud.nav.total = world.stops.length;

  // ------------------------------------------------------------------ title (outside the bus)
  const titleUi = new THREE.Group();
  group.add(titleUi);
  const viewer = route.at(world.CLINIC_S + 12, WALK + 2.4);
  const busSpot = route.at(world.CLINIC_S, LANE);
  const viewYaw = Math.atan2(-(busSpot.x - viewer.x), -(busSpot.z - viewer.z)) + 0.32;
  titleUi.position.set(viewer.x, 0.12, viewer.z);
  titleUi.rotation.y = viewYaw;
  let titleView = 'main';
  const titlePanel = makePanel(1.5, 1.0, (c, W, H) => drawTitle(c, W, H));
  titlePanel.mesh.position.set(-0.95, 1.55, -1.9);
  titlePanel.mesh.rotation.y = 0.42;
  titleUi.add(titlePanel.mesh);
  const tBtn = (label, tone, x, y, fn, w = 0.42) => {
    const b = makeButton(app, { label, tone, w, h: 0.12, onSelect: fn });
    b.position.set(x, y, 0.02);
    titlePanel.mesh.add(b);
    return b;
  };
  const bStart = tBtn('Mulai menyetir', 'mint', -0.24, -0.6, () => startDrive(), 0.6);
  const bSettings = tBtn('Pengaturan', 'light', 0.3, -0.6, () => { titleView = titleView === 'settings' ? 'main' : 'settings'; refreshTitle(); }, 0.4);
  const bHow = tBtn('Cara main', 'light', -0.3, -0.75, () => { titleView = titleView === 'how' ? 'main' : 'how'; refreshTitle(); }, 0.4);
  const bLobby = tBtn('Lobby FDC', 'pink', 0.18, -0.75, () => toLobby(), 0.4);
  bLobby.visible = FROM_LOBBY;
  const SETTINGS = [
    ['mode', () => `Mode: ${config.label('mode')}`],
    ['comfort', () => `Anti pusing: ${config.label('comfort')}`],
    ['maxSpeed', () => `Kecepatan maks: ${config.maxSpeed} km/j`],
    ['traffic', () => `Mobil lain: ${config.traffic ? 'Nyala' : 'Mati'}`],
    ['radio', () => `Radio musik: ${config.radio ? 'Nyala' : 'Mati'}`],
  ];
  const setBtns = SETTINGS.map(([key, label], i) => {
    const b = makeButton(app, { label: label(), tone: 'light', w: 0.9, h: 0.1, onSelect: () => { config.cycle(key); applySettings(); refreshTitle(); } });
    b.position.set(0, 0.22 - i * 0.12, 0.02);
    titlePanel.mesh.add(b);
    return b;
  });
  function refreshTitle() {
    SETTINGS.forEach(([, label], i) => setBtns[i].userData.setLabel(label()));
    for (const b of setBtns) b.visible = titleView === 'settings' && state === 'title';
    bSettings.userData.setLabel(titleView === 'settings' ? 'Selesai' : 'Pengaturan');
    bHow.userData.setLabel(titleView === 'how' ? 'Kembali' : 'Cara main');
    titlePanel.redraw();
  }
  function drawTitle(c, W, H) {
    card(c, W, H, { r: 0.08, fill: 'rgba(255,255,255,0.95)', stroke: P.busGreen });
    const pad = W * 0.06;
    drawLogo(c, pad, H * 0.05, H * 0.15, { green: P.busGreen });
    text(c, 'Smile Bus', pad + H * 0.38, H * 0.13, { size: H * 0.09, weight: 900, color: P.busPink });
    text(c, 'Membawa Senyum Lebih Dekat', pad + H * 0.38, H * 0.19, { size: H * 0.04, weight: 700, color: P.muted });
    if (titleView === 'settings') {
      text(c, 'Pengaturan (tersimpan di headset)', W / 2, H * 0.3, { size: H * 0.045, weight: 800, color: P.mintDark, align: 'center' });
      return;
    }
    if (titleView === 'how') {
      const lines = [
        ['Tujuan', 'Jemput penumpang di 3 halte, antar ke FDC Dental Clinic.'],
        ['Gas / rem', 'Pelatuk kanan = gas, pelatuk kiri = rem.'],
        ['Setir', 'Pegang setir: dekatkan tangan ke setir, tahan tombol grip, lalu putar seperti setir sungguhan. Pakai satu atau dua tangan. (Stik kiri/kanan juga bisa.)'],
        ['Halte', 'Berhenti di zona hijau, tekan A untuk buka pintu.'],
        ['Lampu', 'Berhenti di garis saat lampu merah.'],
        ['Senyum', 'Nyetir halus = penumpang senang = skor tinggi!'],
        ['Lainnya', 'X = klakson, B/Y = jeda. Mode Santai: bus jalan sendiri.'],
      ];
      lines.forEach(([a, b], i) => {
        const y = H * (0.31 + i * 0.075);
        text(c, a, pad, y, { size: H * 0.04, weight: 900, color: P.busPink });
        text(c, b, pad + W * 0.2, y, { size: H * 0.036, weight: 600, color: P.ink, maxWidth: W - pad * 2 - W * 0.2 });
      });
      return;
    }
    c.font = `600 ${Math.round(H * 0.045)}px system-ui`;
    const intro = wrap(c, 'Kamu sopir Smile Bus FDC hari ini! Jemput warga di 3 halte dan antar mereka ke FDC Dental Clinic untuk cek gigi gratis. Nyetir yang halus supaya semua tetap tersenyum.', W - pad * 2);
    intro.forEach((l, i) => text(c, l, pad, H * (0.33 + i * 0.065), { size: H * 0.045, weight: 600, color: P.ink }));
    const best = store.get(BEST_KEY, 0);
    text(c, `Mode: ${config.label('mode')}   ·   Anti pusing: ${config.label('comfort')}`, pad, H * 0.62, { size: H * 0.038, weight: 700, color: P.muted });
    if (best) text(c, `Skor terbaik: ${best}`, pad, H * 0.69, { size: H * 0.045, weight: 900, color: P.mintDark });
  }

  // ------------------------------------------------------------------ in-cab panels: dash buttons, pause, result
  const dash = new THREE.Group();
  bus.inside.add(dash);
  const dBtn = (label, tone, x, fn) => {
    const b = makeButton(app, { label, tone, w: 0.15, h: 0.065, onSelect: fn });
    b.position.set(x, 1.53, -3.69); // on the centre console, in front of the dash
    b.rotation.x = -0.7;
    dash.add(b);
    return b;
  };
  const dDoor = dBtn('Pintu', 'mint', -0.5, () => toggleDoor());
  const dHorn = dBtn('Klakson', 'pink', -0.33, () => horn());
  const dRadio = dBtn('Radio', 'light', -0.16, () => { config.radio = !config.radio; config.save(); applySettings(); });
  const dGear = dBtn('Mundur', 'light', 0.01, () => toggleReverse());
  void dDoor; void dHorn;

  const pausePanel = makePanel(0.9, 0.62, (c, W, H) => {
    card(c, W, H, { r: 0.08, fill: 'rgba(255,255,255,0.96)', stroke: P.busGreen });
    text(c, 'Jeda', W / 2, H * 0.16, { size: H * 0.11, weight: 900, color: P.mintDark, align: 'center' });
  });
  pausePanel.mesh.position.set(0.3, 2.2, -5.4); // beyond the windscreen, ~2 m away
  pausePanel.mesh.scale.setScalar(1.25);
  bus.inside.add(pausePanel.mesh);
  const pBtn = (label, tone, y, fn) => {
    const b = makeButton(app, { label, tone, w: 0.6, h: 0.085, onSelect: fn });
    b.position.set(0, y, 0.02);
    pausePanel.mesh.add(b);
    return b;
  };
  pBtn('Lanjut', 'mint', 0.12, () => setPaused(false));
  pBtn('Atur posisi duduk', 'light', 0.02, () => { recenter(); setPaused(false); });
  pBtn('Mulai ulang', 'light', -0.08, () => { setPaused(false); startDrive(); });
  pBtn('Menu utama', 'light', -0.18, () => { setPaused(false); toTitle(); });
  const pLobby = pBtn('Lobby FDC', 'pink', -0.28, () => toLobby());
  pLobby.visible = FROM_LOBBY;
  pausePanel.mesh.visible = false;

  let result = null;
  const resultPanel = makePanel(1.25, 0.82, (c, W, H) => drawResult(c, W, H));
  resultPanel.mesh.position.set(0.3, 2.25, -5.7);
  resultPanel.mesh.scale.setScalar(1.3);
  bus.inside.add(resultPanel.mesh);
  const rBtn = (label, tone, x, fn) => {
    const b = makeButton(app, { label, tone, w: 0.36, h: 0.09, onSelect: fn });
    b.position.set(x, -0.33, 0.02);
    resultPanel.mesh.add(b);
    return b;
  };
  rBtn('Main lagi', 'mint', -0.4, () => startDrive());
  rBtn('Menu', 'light', 0, () => toTitle());
  const rLobby = rBtn('Lobby FDC', 'pink', 0.4, () => toLobby());
  rLobby.visible = FROM_LOBBY;
  resultPanel.mesh.visible = false;
  function drawResult(c, W, H) {
    if (!result) return;
    card(c, W, H, { r: 0.07, fill: 'rgba(255,255,255,0.97)', stroke: P.busPink });
    const pad = W * 0.05;
    text(c, 'Perjalanan selesai!', pad, H * 0.12, { size: H * 0.075, weight: 900, color: P.mintDark });
    // stars
    for (let i = 0; i < 3; i++) {
      const on = i < result.stars;
      star(c, pad + H * 0.07 + i * H * 0.14, H * 0.25, H * 0.055, on ? P.gold : '#e3e7ea');
    }
    text(c, `${result.score}`, pad + H * 0.5, H * 0.29, { size: H * 0.12, weight: 900, color: P.ink });
    text(c, result.best ? 'Skor terbaik baru!' : `Terbaik: ${result.bestScore}`, pad + H * 0.5, H * 0.35, { size: H * 0.04, weight: 800, color: result.best ? P.busPink : P.muted });
    const rows = [
      [`Penumpang diantar`, `${result.passengers}`],
      ['Halte tepat waktu', `${result.servedStops}/${result.totalStops}`],
      ['Senyum penumpang', `${Math.round(result.smile * 100)}%`],
      ['Waktu', fmt(result.time)],
      ['Lampu merah dilanggar', `${result.red}`],
      ['Senggolan', `${result.bumps + result.cars}`],
    ];
    rows.forEach(([a, b], i) => {
      const y = H * (0.47 + i * 0.065);
      text(c, a, pad, y, { size: H * 0.042, weight: 600, color: P.ink });
      text(c, b, W * 0.6, y, { size: H * 0.042, weight: 900, color: P.mintDark, align: 'right' });
    });
    // FDC app QR
    const qs = H * 0.42;
    const qx = W - pad - qs;
    drawQR(c, `https://${WEBSITE}`, qx, H * 0.08, qs, { dark: '#1f3a2a' });
    text(c, 'Download aplikasi FDC', qx + qs / 2, H * 0.56, { size: H * 0.036, weight: 900, color: P.busPink, align: 'center' });
    text(c, WEBSITE, qx + qs / 2, H * 0.61, { size: H * 0.03, weight: 700, color: P.muted, align: 'center' });
    text(c, 'Cek gigi rutin tiap 6 bulan,', qx + qs / 2, H * 0.68, { size: H * 0.032, weight: 700, color: P.mintDark, align: 'center' });
    text(c, 'senyum sehat setiap hari!', qx + qs / 2, H * 0.72, { size: H * 0.032, weight: 700, color: P.mintDark, align: 'center' });
  }

  // ------------------------------------------------------------------ actions
  function applySettings() {
    vignette.setLevel(config.comfort);
    traffic.setEnabled(config.traffic);
    hud.state.max = config.maxSpeed;
    hud.state.mode = config.mode;
    dRadio.userData.setLabel(config.radio ? 'Radio' : 'Radio off');
    if (state !== 'title') music.setOn(config.radio);
  }

  function toLobby() {
    sfx.setEngine(false);
    music.stop();
    app.openPage(LOBBY_URL);
  }

  function horn() {
    sfx.play('horn');
    world.honk(driver.x, driver.z);
  }

  function toggleReverse() {
    if (Math.abs(driver.v) > 0.3) { say('Berhenti dulu untuk ganti gigi', '', 'warn', 2); return; }
    driver.reverse = !driver.reverse;
    dGear.userData.setLabel(driver.reverse ? 'Maju' : 'Mundur');
    sfx.play('click');
  }

  function say(t, sub = '', tone = 'info', secs = 0) {
    hud.say(t, sub, tone);
    msgTimer = secs;
  }

  function toggleDoor() {
    if (state !== 'drive') return;
    const open = !bus.doorClosed;
    if (!open) {
      if (Math.abs(driver.v) > 0.15) { say('Berhenti dulu sebelum buka pintu', '', 'warn', 2); sfx.play('buzz'); return; }
      bus.setDoor(true);
      sfx.play('doorOpen');
      sfx.play('bell');
    } else {
      if (boarding && !boarding.done) { say('Tunggu, penumpang masih naik!', '', 'warn', 2); return; }
      bus.setDoor(false);
      sfx.play('doorClose');
    }
  }

  driver.pressed = (code) => {
    if (state === 'title' || paused) return;
    if (code === 'KeyE' || code === 'ButtonA') toggleDoor();
    else if (code === 'KeyH' || code === 'ButtonX') horn();
    else if (code === 'KeyR') toggleReverse();
  };

  function setPaused(v) {
    if (state === 'title' || state === 'result') v = false;
    paused = v;
    pausePanel.mesh.visible = paused;
    music.setOn(!paused && config.radio);
    app.pointers.lasers = paused || state === 'result' ? true : 'auto';
  }
  app.on((type) => { if (type === 'menu' && state !== 'title') setPaused(!paused); });

  function recenter() {
    const xr = app.renderer.xr.isPresenting;
    if (xr) {
      seat.offset.copy(app.camera.position);
      const e = new THREE.Euler().setFromQuaternion(app.camera.quaternion, 'YXZ');
      seat.yawOff = -e.y;
    } else {
      seat.offset.set(0, 1.6, 0);
      seat.yawOff = 0;
      app.loco.yaw = 0;
      app.loco.pitch = -0.12;
    }
  }

  async function startDrive() {
    await app.fadeTo(1, 0.3);
    resetRun();
    state = 'drive';
    titleUi.visible = false;
    resultPanel.mesh.visible = false;
    bus.inside.visible = true;
    hud.cluster.mesh.visible = true;
    app.loco.enabled = false;
    app.pointers.lasers = 'auto';
    recenter();
    placeBus();
    followSeat();
    sfx.unlock();
    sfx.setEngine(true, 0, 0);
    if (config.radio) { music.on = true; music.setOn(true); }
    applySettings();
    say(`Halte pertama: ${world.stops[0].name}`, config.mode === 'santai' ? 'Bus jalan sendiri, kamu yang menyetir. Rem = pelatuk kiri.' : 'Pegang setir (grip) dan putar · Gas = pelatuk kanan · Rem = pelatuk kiri', 'good', 7);
    await app.fadeTo(0, 0.5);
  }

  function resetRun() {
    driver.reset(world.CLINIC_S, LANE);
    driver.reverse = false;
    dGear.userData.setLabel('Mundur');
    lap = 0;
    lastS = world.CLINIC_S;
    sAbs = world.CLINIC_S;
    stopIdx = 0;
    served = false;
    boarding = null;
    finishIn = 0;
    score = 0;
    smile = 1;
    time = 0;
    lightsPassed = new Set();
    stats.stops = [];
    stats.red = stats.bumps = stats.cars = stats.missed = 0;
    movers.length = 0;
    for (const p of seated) bus.inside.remove(p);
    seated = [];
    bus.setDoor(false);
    hud.nav.done = 0;
    for (const n of hud.nav.stops) n.done = false;
    // put the waiting people back at their halte
    for (const st of world.stops) {
      st.served = false;
      for (const p of st.waiting) {
        if (p.parent !== world.group) world.group.add(p);
        p.visible = true;
        Object.assign(p.userData, { busy: false, sit: 0, noShadow: false, arrived: false, seat: null, baseY: 0.16 });
        p.rotation.z = 0;
        if (p.userData.home) { p.position.copy(p.userData.home); p.rotation.y = p.userData.homeYaw; }
      }
    }
    for (const p of world.crowd) p.userData.cheer = false;
    for (const p of alighting) group.remove(p);
    alighting.length = 0;
    paused = false;
    pausePanel.mesh.visible = false;
  }

  function toTitle() {
    state = 'title';
    titleView = 'main';
    resetRun();
    sfx.setEngine(false);
    music.stop();
    resultPanel.mesh.visible = false;
    titleUi.visible = true;
    app.loco.enabled = false;
    app.pointers.lasers = true;
    hud.say('');
    placeBus();
    // stand on the clinic forecourt looking at the bus
    app.rig.position.set(viewer.x, 0.12, viewer.z);
    app.rig.rotation.set(0, viewYaw, 0);
    app.loco.yaw = 0;
    app.loco.pitch = -0.05;
    vignette.amount = 0;
    vignette.update(0, 0, 0, 0);
    refreshTitle();
  }

  // ------------------------------------------------------------------ the bus and the seat
  function placeBus() {
    bus.group.position.set(driver.x, 0, driver.z);
    bus.group.rotation.set(0, driver.yaw, 0);
    bus.group.updateMatrixWorld(true);
  }
  const eyeW = new THREE.Vector3();
  const off = new THREE.Vector3();
  function followSeat() {
    const yaw = driver.yaw + seat.yawOff;
    app.rig.rotation.set(0, yaw, 0);
    eyeW.copy(DRIVER_EYE).applyMatrix4(bus.group.matrixWorld);
    off.copy(seat.offset).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    app.rig.position.set(eyeW.x - off.x, eyeW.y - seat.offset.y, eyeW.z - off.z);
  }

  // ------------------------------------------------------------------ boarding and alighting
  // Passengers really walk: from the halte to the door, up the steps, down the aisle to a free
  // seat where they turn round and sit down. At the clinic they stand up, walk to the front, step
  // down out of the door and stroll to the entrance. Positions inside are in bus space.
  const alighting = [];
  const movers = []; // { p, path: [Vector3], i, speed, from, segLen, then }
  const HALF_W = BUS.width / 2;
  const DOOR_Z = -(BUS.door[0] + BUS.door[1]) / 2;
  const FLOOR_Y = 0.8;
  const STEP_IN = new THREE.Vector3(-HALF_W + 0.32, 0.63, DOOR_Z);
  const SILL = new THREE.Vector3(-HALF_W - 0.05, 0.36, DOOR_Z);
  const FRONT = new THREE.Vector3(-0.22, FLOOR_Y, -3.0);
  const AISLE_FRONT = new THREE.Vector3(0, FLOOR_Y, -2.2);
  const v1 = new THREE.Vector3();

  /** Walk someone along a list of points (in their parent's space); `then` runs at the end. */
  function walk(p, path, { speed = 1.1, then = null, wait = 0 } = {}) {
    const m = { p, path, i: 0, speed, then, wait, from: p.position.clone() };
    m.segLen = Math.max(0.01, Math.hypot(path[0].x - m.from.x, path[0].z - m.from.z));
    movers.push(m);
    return m;
  }
  function turnTowards(p, yaw, k) {
    let d = yaw - p.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    p.rotation.y += d * Math.min(1, k);
  }
  function updateMovers(dt, t) {
    for (let n = movers.length - 1; n >= 0; n--) {
      const m = movers[n];
      const p = m.p;
      if (m.wait > 0) { m.wait -= dt; animatePerson(p, t, 'idle', p.userData.phase || 0); continue; }
      if (m.anim) { // sitting down / standing up
        m.anim.t += dt / m.anim.dur;
        const k = Math.min(1, m.anim.t);
        const e = k * k * (3 - 2 * k);
        p.userData.sit = m.anim.sit0 + (m.anim.sit1 - m.anim.sit0) * e;
        p.position.lerpVectors(m.anim.a, m.anim.b, e);
        p.userData.baseY = p.position.y;
        turnTowards(p, m.anim.yaw, dt * 8);
        animatePerson(p, t, 'idle', p.userData.phase || 0);
        if (k >= 1) { const f = m.anim.done; m.anim = null; movers.splice(n, 1); f?.(); }
        continue;
      }
      const tgt = m.path[m.i];
      const dx = tgt.x - p.position.x;
      const dz = tgt.z - p.position.z;
      const d = Math.hypot(dx, dz);
      const step = m.speed * dt;
      if (d <= step) {
        p.position.x = tgt.x;
        p.position.z = tgt.z;
        p.userData.baseY = tgt.y;
        m.i++;
        m.onPoint?.(m.i);
        if (m.i >= m.path.length) { movers.splice(n, 1); m.then?.(); continue; }
        m.from = p.position.clone();
        const nx = m.path[m.i];
        m.segLen = Math.max(0.01, Math.hypot(nx.x - m.from.x, nx.z - m.from.z));
      } else {
        p.position.x += (dx / d) * step;
        p.position.z += (dz / d) * step;
        const k = 1 - Math.min(1, d / m.segLen);
        p.userData.baseY = m.from.y + (tgt.y - m.from.y) * k;
        turnTowards(p, Math.atan2(dx, dz), dt * 10);
      }
      animatePerson(p, t * (m.speed / 1.15), 'walk', p.userData.phase || 0);
    }
  }
  /** Sit down on (or stand up from) a seat, as a little animation in the movers list. */
  function sitAnim(p, sp, down, done) {
    const s = p.userData.scale || 1;
    const standAt = new THREE.Vector3(sp.x, FLOOR_Y, sp.z - 0.3);
    const sitAt = new THREE.Vector3(sp.x, FLOOR_Y + SEAT_TOP + 0.07 - RIG.hip * s, sp.z + 0.07);
    movers.push({ p, anim: { t: 0, dur: 0.8, a: down ? standAt : sitAt, b: down ? sitAt : standAt, sit0: down ? 0 : 1, sit1: down ? 1 : 0, yaw: Math.PI, done } });
  }
  const seatFront = (sp) => new THREE.Vector3(sp.x, FLOOR_Y, sp.z - 0.3);

  function startBoarding(st) {
    const door = DOOR_LOCAL.clone().applyMatrix4(bus.group.matrixWorld);
    boarding = { st, t: 0, done: false, people: st.waiting.map((p, i) => ({ p, start: i * 0.9, done: false, started: false })), door };
    for (const b of boarding.people) {
      b.p.userData.busy = true;
      if (!b.p.userData.home) { b.p.userData.home = b.p.position.clone(); b.p.userData.homeYaw = b.p.rotation.y; }
    }
    say('Penumpang naik...', 'Selamat datang di Smile Bus!', 'good');
  }

  function updateBoarding(dt, t) {
    const b = boarding;
    if (!b || b.done) return;
    if (!bus.doorOpen) return; // wait for the door
    b.t += dt;
    let all = true;
    for (const x of b.people) {
      if (x.done) continue;
      all = false;
      if (x.started) continue;
      if (b.t < x.start) { animatePerson(x.p, t, 'idle', 0); continue; }
      x.started = true;
      const p = x.p;
      p.userData.wave = false;
      // to the door (world), then inside: up the steps, along the aisle to a free seat
      walk(p, [b.door.clone().setY(0.16)], {
        speed: 1.5,
        then: () => {
          const sp = freeSeat();
          bus.group.worldToLocal(v1.copy(p.position));
          bus.inside.add(p);
          p.position.copy(v1);
          p.rotation.y -= driver.yaw;
          p.userData.noShadow = true;
          p.userData.seat = sp;
          seated.push(p);
          const path = [SILL.clone(), STEP_IN.clone(), FRONT.clone(), AISLE_FRONT.clone(), new THREE.Vector3(0, FLOOR_Y, sp.z - 0.3), seatFront(sp)];
          const m = walk(p, path, { speed: 1.05, then: () => sitAnim(p, sp, true) });
          m.onPoint = (i) => {
            if (i === 2) { // up the step and inside: one more passenger on board
              x.done = true;
              sfx.play('step');
              sfx.play('coin');
            }
          };
        },
      });
    }
    if (all) {
      b.done = true;
      served = true;
      const ds = Math.abs(sAbs - targets()[stopIdx].abs);
      const precise = Math.max(0, 1 - ds / 6.5);
      const pts = 100 + Math.round(precise * 60) + b.people.length * 20;
      score += pts;
      stats.stops.push({ name: b.st.name, pts, precise, people: b.people.length });
      b.st.served = true;
      hud.nav.stops[stopIdx].done = true;
      hud.nav.done = stopIdx + 1;
      smile = Math.min(1, smile + 0.06);
      sfx.play('yay');
      say(`+${pts}  ${precise > 0.75 ? 'Berhenti pas sekali!' : 'Semua sudah naik!'}`, 'Tutup pintu (A) lalu jalan lagi', 'good');
    }
  }

  function freeSeat() {
    const free = bus.seats.filter((sp) => !seated.some((p) => p.userData.seat === sp));
    return free[Math.floor(rand() * Math.min(free.length, 10))] || free[0] || bus.seats[0];
  }

  /** Someone already sitting (used by tests and to fill the bus). */
  function addSeated(p = makePerson(rand)) {
    const sp = freeSeat();
    const s = p.userData.scale || 1;
    p.position.set(sp.x, FLOOR_Y + SEAT_TOP + 0.07 - RIG.hip * s, sp.z + 0.07);
    p.rotation.y = Math.PI; // facing the front
    p.userData.seat = sp;
    p.userData.sit = 1;
    p.userData.baseY = p.position.y;
    p.userData.phase = rand() * 6;
    p.userData.noShadow = true;
    p.userData.busy = true;
    bus.inside.add(p);
    seated.push(p);
    return p;
  }

  function startAlighting() {
    const door = DOOR_LOCAL.clone().applyMatrix4(bus.group.matrixWorld);
    const target = world.clinicDoor;
    // the front rows get off first
    const order = [...seated].sort((a, b) => a.userData.seat.z - b.userData.seat.z);
    const ground = route.nearest(door.x, door.z).lat > ROAD_HALF ? 0.16 : 0.03;
    order.forEach((p, i) => {
      const sp = p.userData.seat;
      // still finishing sitting down? let that finish first
      const k = movers.findIndex((m) => m.p === p);
      if (k >= 0) movers.splice(k, 1);
      const delay = 0.4 + i * 0.75;
      // wait for your turn (seated), stand up, walk out
      walk(p, [p.position.clone()], { wait: delay, then: () => sitAnim(p, sp, false, () => {
        const out = new THREE.Vector3(-HALF_W - 0.75, ground, DOOR_Z + (i % 3 - 1) * 0.25);
        const path = [new THREE.Vector3(0, FLOOR_Y, sp.z - 0.3), AISLE_FRONT.clone(), FRONT.clone(), STEP_IN.clone(), SILL.clone(), out];
        walk(p, path, {
          speed: 1.05,
          then: () => {
            // outside: back into the world, off to the clinic for a check-up
            bus.group.localToWorld(v1.copy(p.position));
            group.add(p);
            p.position.copy(v1);
            p.rotation.y += driver.yaw;
            p.userData.noShadow = false;
            p.userData.baseY = v1.y;
            const tgt = target.clone().add(new THREE.Vector3((rand() - 0.5) * 4.5, 0, (rand() - 0.5) * 2));
            const mid = v1.clone().lerp(tgt, 0.5).setY(0.12);
            walk(p, [mid, tgt.setY(0.1)], { speed: 1.3, then: () => { p.userData.arrived = true; } });
          },
        });
      }) });
      alighting.push(p);
    });
    seated = [];
    for (const p of world.crowd) p.userData.cheer = true;
    sfx.play('fanfare');
    sfx.play('clap');
    fx.burst(door.clone().add(new THREE.Vector3(0, 3, 0)), 140);
    fx.burst(world.clinicDoor.clone().add(new THREE.Vector3(0, 4, 0)), 140);
    say('Sampai di FDC Dental Clinic!', 'Semua penumpang turun untuk cek gigi. Terima kasih, Pak/Bu Sopir!', 'pink');
    return order.length;
  }

  function updateAlighting(dt, t) {
    updateMovers(dt, t);
    for (const p of alighting) if (p.userData.arrived) animatePerson(p, t, 'hop', p.id);
  }

  function finish() {
    state = 'result';
    resultT = 0;
    const passengers = stats.stops.reduce((a, s) => a + s.people, 0);
    const timeBonus = Math.max(0, Math.round((330 - time) * 1.5));
    score += Math.round(smile * 300) + timeBonus;
    score = Math.max(0, score);
    const bestScore = store.get(BEST_KEY, 0);
    const best = score > bestScore;
    if (best) store.set(BEST_KEY, score);
    const stars = score >= 1300 ? 3 : score >= 900 ? 2 : 1;
    result = { score, stars, passengers, servedStops: stats.stops.length, totalStops: world.stops.length, smile, time, red: stats.red, bumps: stats.bumps, cars: stats.cars, best, bestScore: Math.max(bestScore, score) };
    resultPanel.redraw();
    resultPanel.mesh.visible = true;
    app.pointers.lasers = true;
    sfx.play('win');
    hud.say('');
  }

  // ------------------------------------------------------------------ driving rules per frame
  function santaiSpeed() {
    const cruise = Math.min(config.maxSpeed / 3.6, 9);
    if (!bus.doorClosed || (boarding && !boarding.done) || state !== 'drive') return 0;
    let v = cruise;
    const tg = targets()[stopIdx];
    if (tg && !served) {
      const d = tg.abs - sAbs;
      if (d > -1) v = Math.min(v, Math.sqrt(2 * 1.0 * Math.max(0, d)) * 0.95);
    }
    for (const [i, l] of world.lights.entries()) {
      if (lightsPassed.has(i)) continue;
      const d = l.s - (sAbs + BUS.front);
      if (d > -0.5 && d < 45 && l.state !== 'green') v = Math.min(v, Math.sqrt(2 * 1.2 * Math.max(0, d - 1.0)));
    }
    return v;
  }

  function updateDrive(dt, t) {
    if (!(finishIn > 0)) time += dt; // the clock stops when you arrive
    const assist = config.mode === 'santai' && !driver.reverse ? santaiSpeed() : null;
    driver.readInput(dt, { wheelPivot: bus.wheelPivot });
    driver.locked = !bus.doorClosed;
    const ev = driver.step(dt, { maxSpeed: config.maxSpeed / 3.6, assistSpeed: assist });
    if (ev.bump) {
      sfx.play('bump');
      stats.bumps++;
      smile = Math.max(0, smile - 0.04 * ev.bump - 0.01);
      say('Hati-hati, jangan naik trotoar!', '', 'warn', 2);
    }
    // cars
    carHitCd = Math.max(0, carHitCd - dt);
    const car = traffic.hit(driver.x, driver.z, driver.yaw);
    if (car && carHitCd <= 0) {
      carHitCd = 2.5;
      driver.v = 0;
      driver.a = 0;
      car.v = 0;
      stats.cars++;
      score -= 40;
      smile = Math.max(0, smile - 0.1);
      sfx.play('bump');
      sfx.play('horn');
      say('Awas mobil! Tetap di lajur kiri', '-40', 'warn', 2.5);
    }
    // progress along the route (unwrapped over the lap)
    const s = driver.s;
    if (s - lastS < -L / 2) lap++;
    else if (s - lastS > L / 2) lap--;
    lastS = s;
    sAbs = lap * L + s;
    // traffic lights: passing the line on red
    for (const [i, l] of world.lights.entries()) {
      if (lightsPassed.has(i)) continue;
      if (sAbs + BUS.front > l.s + 0.5 && sAbs < l.s + 30) { // the front bumper crossed the line
        lightsPassed.add(i);
        if (l.state === 'red') {
          stats.red++;
          score -= 60;
          smile = Math.max(0, smile - 0.08);
          sfx.play('buzz');
          say('Lampu merah dilanggar!', '-60  ·  Berhenti di garis putih saat merah', 'warn', 3);
        }
      }
    }
    // the next stop
    const tg = targets()[stopIdx];
    const d = tg.abs - sAbs;
    if (!served && d < -9 && !(boarding && !boarding.done)) {
      // drove past it
      stats.missed++;
      smile = Math.max(0, smile - 0.15);
      sfx.play('aw');
      if (!tg.final) {
        for (const p of tg.st.waiting) p.userData.hopUntil = 0;
        hud.nav.stops[stopIdx].done = true;
        say(`${tg.name} terlewat!`, 'Penumpangnya kecewa... ayo ke halte berikutnya', 'warn', 3);
        stopIdx++;
        served = false;
        boarding = null;
      } else {
        say('Kelewatan! Putar balik ke FDC Dental Clinic', 'Gunakan Mundur (R) lalu masuk zona hijau', 'warn', 3);
      }
    } else if (!served) {
      const inZone = Math.abs(d) < 6.5 && driver.lat > 0.6 && driver.lat < 3.3;
      if (inZone && Math.abs(driver.v) < 0.15) {
        if (bus.doorClosed) say('Buka pintu!', 'Tombol A (atau E di keyboard)', 'pink');
        else if (!boarding && bus.doorOpen) {
          if (tg.final) { served = true; const n = startAlighting(); finishIn = Math.min(12, 5.5 + n * 0.45); }
          else startBoarding(tg.st);
        }
      } else if (d < 70 && d > -9 && msgTimer <= 0) {
        say(`${tg.name}: ${Math.max(0, Math.round(d))} m`, 'Berhenti di zona hijau di lajur kiri', 'info');
      } else if (msgTimer <= 0) hud.say('');
    } else if (served && bus.doorClosed && boarding && boarding.done) {
      // door closed after boarding: on to the next stop
      stopIdx++;
      served = false;
      boarding = null;
      const nx = targets()[stopIdx];
      say(`Berikutnya: ${nx.name}`, nx.final ? 'Antar semua penumpang ke klinik!' : '', 'good', 3);
    }
    updateBoarding(dt, t);
    if (finishIn > 0) { finishIn -= dt; if (finishIn <= 0) finish(); }

    // passengers' smile: smooth driving keeps it up
    const lat = Math.abs(driver.v * driver.yawRate);
    if (driver.a < -3.0) smile -= dt * 0.05;
    if (lat > 2.4) smile -= dt * 0.04;
    if (driver.kmh > config.maxSpeed + 3) smile -= dt * 0.02;
    if (driver.a > -2 && lat < 1.5) smile += dt * 0.004;
    smile = THREE.MathUtils.clamp(smile, 0, 1);

    // seated passengers sway a little with the bus (and hop when happy at the end)
    for (const p of seated) {
      if (p.userData.sit < 1 || movers.some((m) => m.p === p)) continue;
      animatePerson(p, t, 'idle', p.userData.phase || 0);
      p.rotation.z = THREE.MathUtils.clamp(-driver.yawRate * driver.v * 0.03, -0.15, 0.15);
    }

    // dashboard
    hud.state.speed = driver.kmh;
    hud.state.gear = driver.reverse ? 'R' : Math.abs(driver.v) < 0.05 ? 'N' : 'D';
    hud.state.door = !bus.doorClosed;
    hud.state.smile = smile;
    hud.state.gas = driver.gas;
    hud.state.brake = driver.brake;
    const nx = targets()[stopIdx];
    hud.nav.next = hud.nav.stops[stopIdx];
    hud.nav.nextName = nx.name;
    hud.nav.dist = nx.abs - sAbs;
    hud.nav.busX = driver.x;
    hud.nav.busZ = driver.z;
    hud.nav.yaw = driver.yaw;
    let light = null;
    for (const [i, l] of world.lights.entries()) if (!lightsPassed.has(i) && l.s - sAbs < 90 && l.s - sAbs > -5) light = l.state;
    hud.nav.light = light;
    if (msgTimer > 0) { msgTimer -= dt; }
  }

  // ------------------------------------------------------------------ frame
  function update(dt, t) {
    tickButtons(group, dt);
    app.camera.getWorldPosition(world.sky.position);
    world.update(dt, t);
    fx.update(dt);
    if (state === 'drive' && !paused) updateDrive(dt, t);
    if (state === 'drive' || state === 'result') updateAlighting(dt, t);
    if (state === 'result') {
      resultT += dt;
      driver.locked = true;
      driver.readInput(dt);
      driver.step(dt, {});
      if (config.boothMode && resultT > config.resetAfterSeconds) toTitle();
    }
    placeBus();
    shadows.update(shadowList());
    // the side mirrors: one per frame while driving, now and then on the title screen
    if (!paused && (state !== 'title' || mirrorTick++ % 8 === 0)) bus.renderMirrors(app.renderer, app.scene);
    traffic.update(state === 'title' ? dt : paused ? 0 : dt, { x: driver.x, z: driver.z, yaw: driver.yaw });
    const roll = driver.v / BUS.wheelR;
    bus.update(dt, { roll, steer: driver.steer, wheelAngle: driver.wheelAngle, accel: driver.a, lights: driver.brake > 0.1, t });
    if (state !== 'title') followSeat();
    vignette.update(dt, state === 'drive' && !paused ? driver.yawRate : 0, state === 'drive' ? driver.a : 0, Math.abs(driver.v));
    hud.update(dt);
    if (state !== 'title') { sfx.setEngine(true, Math.abs(driver.v), driver.gas); music.update(); }
    // hands on the wheel: a controller holding the rim shows its hand on the wheel instead
    const xr = app.renderer.xr.isPresenting;
    const holding = { left: null, right: null };
    for (const [p, gr] of driver.grabs) holding[p.handedness === 'left' ? 'left' : 'right'] = gr.anchor;
    app.pointers.controllers.forEach((p, i) => { if (hands[i]) hands[i].visible = xr && !driver.grabs.has(p); });
    bus.setHold('left', xr ? holding.left : null);
    bus.setHold('right', xr ? holding.right : null);
    if (driver.grabs.size) everHeld = true;
    bus.setWheelHint({ near: xr && driver.near > 0 && !driver.grabs.size, hint: xr && state === 'drive' && !everHeld && !paused, t });
  }

  traffic.onHonk = (c) => {
    if (state !== 'drive') return;
    const d = Math.hypot(c.x - driver.x, c.z - driver.z);
    if (d < 30) sfx.play('horn');
  };

  // the bus waits at the clinic with its door open on the title screen
  toTitle();
  bus.setDoor(true);
  applySettings();
  hud.cluster.mesh.visible = true;

  // test hooks
  window.busGame = {
    get state() { return state; }, get sAbs() { return sAbs; }, get stopIdx() { return stopIdx; }, get score() { return score; }, get smile() { return smile; },
    get served() { return served; }, get boarding() { return boarding; }, get result() { return result; }, get message() { return hud.message; },
    get seated() { return seated; }, get alighting() { return alighting; }, get movers() { return movers; }, addSeated,
    driver, bus, world, traffic, startDrive, toTitle, toggleDoor, finish, horn,
    input(o) { driver.override = o; },
    teleport(s, lat = LANE) { driver.reset(s, lat); lastS = route.wrap(s); lap = Math.floor(s / L); sAbs = s; },
  };

  return {
    group,
    pitch: -0.05,
    spawn: { x: viewer.x, y: 0.12, z: viewer.z, yaw: viewYaw },
    fog: new THREE.Fog('#dff1f8', 110, 360),
    update,
    dispose() {
      driver.dispose();
      vignette.dispose();
      music.stop();
      sfx.setEngine(false);
      for (const h of hands) h.parent?.remove(h);
      delete window.busGame;
    },
  };
}

// ------------------------------------------------------------------ helpers
function fmt(s) {
  const m = Math.floor(s / 60);
  const r = Math.floor(s % 60);
  return `${m}:${String(r).padStart(2, '0')}`;
}

function star(c, x, y, r, color) {
  c.fillStyle = color;
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rr = i % 2 ? r * 0.45 : r;
    c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  c.closePath();
  c.fill();
}

/** Confetti bursts: instanced coloured paper that tumbles down. */
class Confetti {
  constructor(parent, max = 320) {
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.07, 0.045), new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, toneMapped: false }), max);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    parent.add(this.mesh);
    this.parts = [];
    this.max = max;
    this.next = 0;
    this.m = new THREE.Matrix4();
    this.q = new THREE.Quaternion();
    this.e = new THREE.Euler();
    this.c = new THREE.Color();
    this.cols = [P.busPink, P.busGreen, P.gold, '#ffffff', '#4a9be8', '#ff7a6b'];
  }

  burst(at, n) {
    for (let i = 0; i < n; i++) {
      const k = this.next++ % this.max;
      this.parts[k] = { x: at.x, y: at.y, z: at.z, vx: (Math.random() - 0.5) * 5, vy: 2 + Math.random() * 4, vz: (Math.random() - 0.5) * 5, life: 4 + Math.random() * 2, ph: Math.random() * 6 };
      this.mesh.setColorAt(k, this.c.set(this.cols[k % this.cols.length]));
    }
    this.mesh.count = Math.min(this.max, Math.max(this.mesh.count, this.next));
    this.mesh.instanceColor.needsUpdate = true;
  }

  update(dt) {
    if (!this.mesh.count) return;
    let alive = 0;
    for (let k = 0; k < this.mesh.count; k++) {
      const p = this.parts[k];
      if (!p || p.life <= 0) { this.m.makeScale(0, 0, 0); this.mesh.setMatrixAt(k, this.m); continue; }
      alive++;
      p.life -= dt;
      p.vy -= 3.5 * dt;
      p.vx *= 1 - dt * 1.2;
      p.vz *= 1 - dt * 1.2;
      if (p.vy < -1.2) p.vy = -1.2;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      p.ph += dt * 6;
      this.e.set(p.ph, p.ph * 0.7, 0);
      this.m.compose(new THREE.Vector3(p.x, Math.max(0.05, p.y), p.z), this.q.setFromEuler(this.e), new THREE.Vector3(1, 1, 1));
      this.mesh.setMatrixAt(k, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!alive) { this.mesh.count = 0; this.next = 0; }
  }
}
