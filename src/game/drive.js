import * as THREE from 'three';
import { ROAD_HALF } from './world.js';
import { BUS } from './livery.js';
import { WHEEL_R } from './bus.js';

/**
 * Bus driving: controls and a gentle, comfortable vehicle model.
 *
 * Controls
 *   VR       right trigger = gas, left trigger = brake (or right stick up/down)
 *            either thumbstick left/right = steer, or grab the wheel with the grip buttons and turn it
 *            A = door, X = horn, B / Y = pause
 *   Desktop  W / ↑ gas, S / ↓ brake, A D / ← → steer, E door, H horn, R reverse, M pause
 *
 * Comfort: acceleration is jerk-limited (no sudden lurches), steering is rate-limited and eased,
 * the bus never pitches or rolls, and the speed is capped low (40 km/h by default).
 */
export const WHEEL_MAX = 2.4; // steering wheel turn each way (rad), about 140°
const WHEELBASE = BUS.axleFront - BUS.axleRear; // 4.65 m
const REAR = -BUS.axleRear; // rear axle at bus z = +2.35
const DEAD = 0.15;

export class Driver {
  constructor(app, route) {
    this.app = app;
    this.route = route;
    this.keys = new Set();
    this.reset(0);
    this.onKey = (e) => {
      if (e.type === 'keydown') {
        if (!this.keys.has(e.code)) this.pressed?.(e.code);
        this.keys.add(e.code);
      } else this.keys.delete(e.code);
    };
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    this.grabs = new Map(); // pointer → { last angle, anchor on the rim }
    this.gripWas = new Map();
    this.near = 0; // hands close enough to grab the wheel (for the glow)
    this.nearNow = 0;
    this.buttonsHeld = new Map();
  }

  dispose() {
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
  }

  /** Put the bus on the route at distance s, in the left lane, stopped. */
  reset(s, lat = 1.85) {
    const p = this.route.at(s, lat);
    this.x = p.x;
    this.z = p.z;
    this.yaw = p.yaw;
    this.v = 0;
    this.a = 0;
    this.steer = 0;
    this.wheelAngle = 0;
    this.yawRate = 0;
    this.gas = 0;
    this.brake = 0;
    this.reverse = false;
    this.locked = false; // door open / paused: the bus holds still
    this.bumped = 0;
    this.lat = lat;
    this.s = s;
  }

  /** Read the controls. `assist` (santai mode) gives a target speed instead of the gas pedal. */
  readInput(dt, { wheelPivot } = {}) {
    const xr = this.app.renderer.xr.isPresenting;
    let gas = 0;
    let brake = 0;
    let steerIn = 0;
    let steering = false;
    this.nearNow = 0;
    if (xr) {
      for (const p of this.app.pointers.controllers) {
        const gp = p.gamepad;
        if (!p.connected || !gp) continue;
        const trig = gp.buttons[0]?.value ?? 0;
        const grip = gp.buttons[1]?.value ?? 0;
        const ax = gp.axes[2] ?? 0;
        const ay = gp.axes[3] ?? 0;
        if (p.handedness === 'right') {
          gas = Math.max(gas, trig);
          if (ay < -DEAD) gas = Math.max(gas, -ay);
          if (ay > DEAD) brake = Math.max(brake, ay);
        } else {
          brake = Math.max(brake, trig);
        }
        if (Math.abs(ax) > DEAD) { steerIn += ax; steering = true; }
        // buttons: A/X (index 4)
        const btn = !!gp.buttons[4]?.pressed;
        const held = this.buttonsHeld.get(p) || false;
        if (btn && !held) this.pressed?.(p.handedness === 'right' ? 'ButtonA' : 'ButtonX');
        this.buttonsHeld.set(p, btn);
        // grab the wheel with the grip
        if (wheelPivot) this.grabWheel(p, grip > 0.6, wheelPivot);
      }
    } else {
      const k = this.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) gas = 1;
      if (k.has('KeyS') || k.has('ArrowDown') || k.has('Space')) brake = 1;
      if (k.has('KeyA') || k.has('ArrowLeft')) { steerIn -= 1; steering = true; }
      if (k.has('KeyD') || k.has('ArrowRight')) { steerIn += 1; steering = true; }
    }
    this.near = this.nearNow;
    if (this.override) ({ gas, brake, steerIn, steering } = { ...{ gas, brake, steerIn, steering }, ...this.override });
    this.gas = gas;
    this.brake = brake;
    const grabbing = this.grabs.size > 0;
    if (!grabbing) {
      if (steering) {
        const target = THREE.MathUtils.clamp(steerIn, -1, 1) * WHEEL_MAX;
        const d = target - this.wheelAngle;
        this.wheelAngle += Math.sign(d) * Math.min(Math.abs(d), dt * 3.2);
      } else {
        // the wheel returns to centre by itself as the bus rolls
        this.wheelAngle *= 1 - Math.min(1, dt * (0.6 + Math.min(1.6, Math.abs(this.v) * 0.25)));
      }
    }
    this.wheelAngle = THREE.MathUtils.clamp(this.wheelAngle, -WHEEL_MAX, WHEEL_MAX);
  }

  /**
   * Hold the wheel: bring a hand near the rim and squeeze the grip. While held, the wheel turns
   * with your hand going round it (like a real one); with two hands it follows both. The grab
   * zone is generous (a hand within ~17 cm of the rim) because you can't feel it in VR.
   */
  grabWheel(p, down, wheelPivot) {
    const g = this.grabs.get(p);
    const pos = new THREE.Vector3().setFromMatrixPosition(p.object.matrixWorld);
    const local = wheelPivot.worldToLocal(pos);
    const r = Math.hypot(local.x, local.y);
    const ang = Math.atan2(local.y, local.x);
    const near = Math.abs(local.z) < 0.22 && Math.abs(r - WHEEL_R) < 0.17;
    if (near && !g) this.nearNow++;
    if (down && !g) {
      if (near && !this.gripWas.get(p)) {
        // where on the rim the hand holds, in the wheel's own (turning) frame
        this.grabs.set(p, { last: ang, anchor: ang + this.wheelAngle, tick: this.wheelAngle });
        p.gamepad?.hapticActuators?.[0]?.pulse?.(0.5, 40);
      }
    } else if (g && down) {
      let d = ang - g.last;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      g.last = ang;
      // turning the wheel clockwise (seen by the driver) steers right
      this.wheelAngle -= d / Math.max(1, this.grabs.size);
      // a little click in the hand every ~15° of turn
      if (Math.abs(this.wheelAngle - g.tick) > 0.26) { g.tick = this.wheelAngle; p.gamepad?.hapticActuators?.[0]?.pulse?.(0.12, 12); }
    } else if (g && !down) this.grabs.delete(p);
    this.gripWas.set(p, down);
  }


  /** Advance the bus. `maxSpeed` in m/s. Returns events (bump). */
  step(dt, { maxSpeed = 11.1, assistSpeed = null } = {}) {
    const ev = {};
    // pedals → target acceleration
    let gas = this.gas;
    let brake = this.brake;
    if (assistSpeed != null && brake < 0.05) {
      // santai: hold a target speed (gas or brake as needed); the player's own pedals still win
      const err = assistSpeed - this.v;
      if (err > 0.1) gas = Math.max(gas, Math.min(1, err * 0.5));
      else if (err < -0.1) brake = Math.max(brake, Math.min(1, -err * 0.6));
    }
    const dir = this.reverse ? -1 : 1;
    const vmax = this.reverse ? 3 : maxSpeed;
    let target = gas * 1.7 * Math.max(0, 1 - Math.abs(this.v) / vmax) * dir;
    if (brake > 0.02 && Math.abs(this.v) > 0.02) target -= Math.sign(this.v) * brake * 4.2;
    target -= this.v * 0.03 + Math.sign(this.v) * (Math.abs(this.v) > 0.05 ? 0.12 : 0); // drag + rolling
    if (this.locked) target = -this.v * 3;
    // jerk limit: accel can only change so fast (no lurching)
    const jerk = 4.5;
    this.a += THREE.MathUtils.clamp(target - this.a, -jerk * dt, jerk * dt);
    const before = this.v;
    this.v += this.a * dt;
    if ((brake > 0.02 || this.locked) && Math.sign(this.v) !== Math.sign(before) && before !== 0) { this.v = 0; this.a = 0; }
    if (Math.abs(this.v) < 0.03 && gas < 0.02) { this.v = 0; if (this.a * dir < 0 || brake > 0.02) this.a = 0; }
    if (Math.abs(this.v) > vmax + 0.5) this.v = Math.sign(this.v) * (vmax + 0.5);

    // steering: wheel angle → front wheels, gentler at speed, rate-limited
    const maxSteer = 0.62 / (1 + Math.abs(this.v) * 0.07);
    const want = (this.wheelAngle / WHEEL_MAX) * maxSteer;
    this.steer += THREE.MathUtils.clamp(want - this.steer, -dt * 0.9, dt * 0.9);

    // bicycle model around the rear axle
    // the rear axle is behind the centre (bus +z); forward is (-sin yaw, -cos yaw)
    let rx = this.x + Math.sin(this.yaw) * REAR;
    let rz = this.z + Math.cos(this.yaw) * REAR;
    this.yawRate = (this.v / WHEELBASE) * Math.tan(this.steer);
    // turning left (steer < 0 = wheel turned left) must increase yaw (three.js: +yaw turns left)
    this.yaw -= this.yawRate * dt;
    rx += -Math.sin(this.yaw) * this.v * dt;
    rz += -Math.cos(this.yaw) * this.v * dt;
    this.x = rx - Math.sin(this.yaw) * REAR;
    this.z = rz - Math.cos(this.yaw) * REAR;

    // keep the bus on the road: soft kerbs at the front and back corners
    this.bumped = Math.max(0, this.bumped - dt);
    const near = this.route.nearest(this.x, this.z, this.s);
    this.s = near.s;
    this.lat = near.lat;
    for (const zl of [-(BUS.front - 0.3), 0, -BUS.rear - 0.3]) { // front bumper, centre, rear (bus z)
      const px = this.x + Math.sin(this.yaw) * zl;
      const pz = this.z + Math.cos(this.yaw) * zl;
      const n = this.route.nearest(px, pz, this.s - zl);
      const limit = ROAD_HALF - 1.25;
      const over = Math.abs(n.lat) - limit;
      if (over > 0) {
        const o = this.route.at(n.s);
        const push = Math.min(over, 0.5) * Math.sign(n.lat);
        this.x -= o.nx * push * Math.min(1, dt * 8 + 0.3);
        this.z -= o.nz * push * Math.min(1, dt * 8 + 0.3);
        if (Math.abs(this.v) > 0.5) {
          this.v *= 1 - Math.min(0.5, dt * 1.6);
          if (this.bumped <= 0) { ev.bump = Math.min(1, Math.abs(this.v) / 8); this.bumped = 0.8; }
        }
        // ease the heading back along the road
        const roadYaw = o.yaw + (this.v < 0 ? Math.PI : 0);
        let dy = roadYaw - this.yaw;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        if (Math.abs(dy) < 1.2) this.yaw += dy * Math.min(1, dt * 1.2);
      }
    }
    return ev;
  }

  get kmh() { return Math.abs(this.v) * 3.6; }
}
