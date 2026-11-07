import { App } from './core/app.js';
import { setupOverlay } from './overlay.js';
import { createGame } from './game/game.js';

const app = new App(document.getElementById('app'), { drive: createGame });
setupOverlay(app);
app.goTo('drive');

window.fdcApp = app; // handy in the browser console
