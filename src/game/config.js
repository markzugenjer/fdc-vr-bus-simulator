import { store } from '../core/util.js';

/**
 * Game settings. The defaults are what a fresh headset starts with; players change them on the
 * start screen (Pengaturan) and the choice is saved on the headset.
 * To change the defaults for everyone (for an event, say), edit DEFAULTS and push.
 */
export const DEFAULTS = {
  mode: 'normal', // normal: you drive (gas + brake) | santai: the bus drives itself, you steer
  comfort: 'sedang', // tunnel vision while turning or braking, against motion sickness: mati | sedang | kuat
  maxSpeed: 40, // km/h
  traffic: true, // oncoming cars
  radio: true, // chill music on the bus radio
  boothMode: true, // go back to the start screen by itself after the result
  resetAfterSeconds: 40,
};

export const CHOICES = {
  mode: [{ id: 'normal', label: 'Normal (gas + rem)' }, { id: 'santai', label: 'Santai (jalan sendiri)' }],
  comfort: [{ id: 'mati', label: 'Mati' }, { id: 'sedang', label: 'Sedang' }, { id: 'kuat', label: 'Kuat' }],
  maxSpeed: [30, 40, 50],
};

const KEY = 'fdc.bus.config';
export const config = {
  ...DEFAULTS,
  ...store.get(KEY, {}),
  save() {
    const { save, cycle, label, ...data } = this;
    void save; void cycle; void label;
    store.set(KEY, data);
  },
  cycle(key) {
    const list = CHOICES[key];
    if (list) {
      const ids = list.map((c) => (typeof c === 'object' ? c.id : c));
      this[key] = ids[(ids.indexOf(this[key]) + 1) % ids.length];
    } else this[key] = !this[key];
    this.save();
  },
  label(key) {
    const v = this[key];
    const c = CHOICES[key]?.find((x) => (typeof x === 'object' ? x.id === v : x === v));
    return typeof c === 'object' ? c.label : `${v}`;
  },
};
