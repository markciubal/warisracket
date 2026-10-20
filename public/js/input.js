// Keyboard + pointer-locked mouse. `pressed*` are edge-triggered and cleared every frame.
// In touch mode the on-screen controls (touch.js) drive the same state instead.
const GAME_KEYS = new Set(['Tab', 'Space', 'KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

// Which mouse button does what: right-handed, left bonks and right (hold) throws or shoots;
// left-handed, the other way round. The touch THROW button presses the ranged one too.
export const BUTTON = { melee: 0, ranged: 2 };
export function setLefty(on) {
  BUTTON.melee = on ? 2 : 0;
  BUTTON.ranged = on ? 0 : 2;
}
// for hints: what the ranged and melee buttons are called right now
export const buttonName = which => (BUTTON[which] === 0 ? 'LMB' : 'RMB');

export class Input {
  constructor(canvas, touch = false) {
    this.canvas = canvas;
    this.touch = touch;
    this.keys = new Set();
    this.keysPressed = new Set();
    this.buttons = new Set();
    this.buttonsPressed = new Set();
    this.dx = 0;
    this.dy = 0;
    this.stick = [0, 0];     // thumbstick: x right, y forward, each -1..1
    this.locked = false;
    this.enabled = false;
    this.onLockChange = null;

    addEventListener('keydown', e => {
      if (e.target instanceof HTMLInputElement) return;
      if (this.enabled && GAME_KEYS.has(e.code)) e.preventDefault();
      if (!this.keys.has(e.code)) this.keysPressed.add(e.code);
      this.keys.add(e.code);
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => { this.keys.clear(); this.buttons.clear(); });

    addEventListener('mousedown', e => {
      // phones fire a fake mouse click after every tap; the touch controls already handled it
      if (!this.enabled || this.touch) return;
      if (!this.locked) {
        // clicking the game (or the "click to ooga" screen, but not its buttons) grabs the mouse
        if (e.target === canvas || (e.target.closest?.('#lock-hint') && !e.target.closest('button'))) this.lock();
        return;
      }
      this.buttons.add(e.button);
      this.buttonsPressed.add(e.button);
    });
    addEventListener('mouseup', e => { if (!this.touch) this.buttons.delete(e.button); });
    addEventListener('mousemove', e => {
      if (!this.locked || this.touch) return;
      this.dx += e.movementX || 0;
      this.dy += e.movementY || 0;
    });
    addEventListener('contextmenu', e => { if (this.enabled) e.preventDefault(); });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === canvas;
      if (!this.locked) this.buttons.clear();
      this.onLockChange?.(this.locked);
    });
  }

  lock() {
    if (this.touch) {
      // nothing to capture on a touch screen: "locked" just means the controls are live
      this.locked = true;
      this.onLockChange?.(true);
      return;
    }
    try {
      const p = this.canvas.requestPointerLock();
      if (p && p.catch) p.catch(() => {});
    } catch { /* browser refused; user can click again */ }
  }

  unlock() {
    if (this.touch) {
      this.locked = false;
      this.buttons.clear();
      this.onLockChange?.(false);
    } else if (document.pointerLockElement) {
      document.exitPointerLock();
    }
  }

  // ---- for the touch controls
  setKey(code, on) {
    if (on && !this.keys.has(code)) this.keysPressed.add(code);
    if (on) this.keys.add(code); else this.keys.delete(code);
  }
  tapKey(code) { this.keysPressed.add(code); }
  setButton(b, on) {
    if (on && !this.buttons.has(b)) this.buttonsPressed.add(b);
    if (on) this.buttons.add(b); else this.buttons.delete(b);
  }
  look(dx, dy) {
    this.dx += dx;
    this.dy += dy;
  }

  down(code) { return this.keys.has(code); }
  pressed(code) { return this.keysPressed.has(code); }
  mouseDown(b) { return this.buttons.has(b); }
  mousePressed(b) { return this.buttonsPressed.has(b); }

  consumeMouse() {
    const d = [this.dx, this.dy];
    this.dx = this.dy = 0;
    return d;
  }

  endFrame() {
    this.keysPressed.clear();
    this.buttonsPressed.clear();
  }
}
