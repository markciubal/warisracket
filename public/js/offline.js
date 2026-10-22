// Playing offline: the game's own rock (room.js, the very code the server runs) goes in a worker
// in the browser, with you and the bots on it. OfflineSocket stands in for the WebSocket: the
// same JSON messages both ways, so main.js just plays.
export const OFFLINE_ROOM = 'OFFLINE';

export class OfflineSocket {
  constructor() {
    this.readyState = 0;
    this.worker = new Worker('/js/offline-worker.js', { type: 'module' });
    this.worker.onmessage = e => this.onmessage?.({ data: e.data });
    this.worker.onerror = e => { console.error('offline rock:', e.message || e); this.close(); };
    // (open on the next turn, as a real socket would, once main.js has set its handlers)
    setTimeout(() => {
      if (this.readyState !== 0) return;
      this.readyState = 1;
      this.onopen?.();
    }, 0);
  }

  send(data) {
    if (this.readyState === 1) this.worker.postMessage(data);
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.worker.terminate();
    this.onclose?.();
  }
}
