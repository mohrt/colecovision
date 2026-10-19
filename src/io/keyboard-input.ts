import { Dir, keyBit, type ControllerInput, type KeypadKey } from './controllers';

const DIRECTION_KEYS: Record<string, number> = {
  ArrowUp: Dir.Up,
  ArrowDown: Dir.Down,
  ArrowLeft: Dir.Left,
  ArrowRight: Dir.Right,
};
const LEFT_FIRE_KEYS = new Set(['Space', 'KeyZ']);
const RIGHT_FIRE_KEYS = new Set(['KeyX', 'KeyC']);
const KEYPAD_CODES: Record<string, KeypadKey> = {
  Minus: '*',
  NumpadMultiply: '*',
  Equal: '#',
  NumpadDivide: '#',
};
for (let digit = 0; digit <= 9; digit++) {
  KEYPAD_CODES[`Digit${digit}`] = String(digit) as KeypadKey;
  KEYPAD_CODES[`Numpad${digit}`] = String(digit) as KeypadKey;
}
const PAUSE_KEYS = new Set(['Pause', 'KeyP']);

export interface KeyboardCallbacks {
  onPause(): void;
}

/** True when a key press belongs to a form field rather than the game. */
function typingInField(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return !!target && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName));
}

/**
 * Player 1 on the keyboard: arrows for the joystick, Space or Z for the left
 * button, X or C for the right one, and the number keys, - (*) and = (#) for
 * the keypad.
 */
export class KeyboardInput {
  private readonly held = new Set<string>();

  constructor(
    private readonly controller: ControllerInput,
    private readonly callbacks: KeyboardCallbacks,
  ) {}

  attach(target: Window): void {
    target.addEventListener('keydown', (event) => this.onKey(event, true));
    target.addEventListener('keyup', (event) => this.onKey(event, false));
    target.addEventListener('blur', () => {
      this.held.clear();
      this.update();
    });
  }

  private onKey(event: KeyboardEvent, down: boolean): void {
    if (down && (event.ctrlKey || event.metaKey || event.altKey || typingInField(event))) return;
    const code = event.code;
    if (PAUSE_KEYS.has(code)) {
      if (down && !event.repeat) this.callbacks.onPause();
      event.preventDefault();
      return;
    }
    const handled =
      code in DIRECTION_KEYS || LEFT_FIRE_KEYS.has(code) || RIGHT_FIRE_KEYS.has(code) || code in KEYPAD_CODES;
    if (!handled) return;
    event.preventDefault();
    if (down) this.held.add(code);
    else this.held.delete(code);
    this.update();
  }

  private update(): void {
    let dirs = 0;
    let keys = 0;
    let leftFire = false;
    let rightFire = false;
    for (const code of this.held) {
      dirs |= DIRECTION_KEYS[code] ?? 0;
      leftFire ||= LEFT_FIRE_KEYS.has(code);
      rightFire ||= RIGHT_FIRE_KEYS.has(code);
      const key = KEYPAD_CODES[code];
      if (key) keys |= keyBit(key);
    }
    this.controller.set('keyboard', { dirs, keys, leftFire, rightFire });
  }
}
