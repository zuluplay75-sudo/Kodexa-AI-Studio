import { OfficeStore } from './net/store';
import { createWorld } from './world';

const store = new OfficeStore();
const canvas = document.querySelector<HTMLCanvasElement>('#office-map')!;
let world: ReturnType<typeof createWorld> | undefined;
window.addEventListener('kodexa-office-ready', () => {
  if (world) return;
  const now = Date.now();
  store.snapshot = {
    rev: 1, serverTime: now, rooms: [], agents: [], accounts: [],
    meta: { demo: false, sources: [], startedAt: now, version: '' }
  };
  world = createWorld(canvas, store);
});
