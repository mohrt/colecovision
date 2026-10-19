/** Joystick directions, as the bits of the controller port in joystick mode (read active low). */
export const Dir = { Up: 0x01, Right: 0x02, Down: 0x04, Left: 0x08 } as const;

/** The keypad's keys; a key's index is its bit in `PadState.keys`. */
export const KEYPAD_KEYS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '#'] as const;
export type KeypadKey = (typeof KEYPAD_KEYS)[number];
export const keyBit = (key: KeypadKey): number => 1 << KEYPAD_KEYS.indexOf(key);

/** What each key puts on the low four lines in keypad mode (several keys pull their lines together). */
const KEYPAD_CODES = [0x0a, 0x0d, 0x07, 0x0c, 0x02, 0x03, 0x0e, 0x05, 0x01, 0x0b, 0x09, 0x06];
const NO_KEY = 0x0f;
const FIRE = 0x40;
/** Lines 4 and 5 belong to the spinner of the Super Action controller; idle, they read high. */
const IDLE_LINES = 0x30;

export interface PadState {
  dirs: number;
  /** The left button is read in joystick mode, the right one in keypad mode. */
  leftFire: boolean;
  rightFire: boolean;
  /** Pressed keypad keys, one bit per entry of KEYPAD_KEYS. */
  keys: number;
}

const idle = (): PadState => ({ dirs: 0, leftFire: false, rightFire: false, keys: 0 });

/** One controller, pressed by several input sources (keyboard, gamepad, on-screen keypad) at once. */
export class ControllerInput {
  private readonly sources = new Map<string, PadState>();

  set(source: string, state: Partial<PadState>): void {
    this.sources.set(source, { ...idle(), ...state });
  }

  clear(source: string): void {
    this.sources.delete(source);
  }

  get state(): PadState {
    const merged = idle();
    for (const state of this.sources.values()) {
      merged.dirs |= state.dirs;
      merged.leftFire ||= state.leftFire;
      merged.rightFire ||= state.rightFire;
      merged.keys |= state.keys;
    }
    return merged;
  }
}

/**
 * The two controller ports. Writing to ports 80-9F switches both to keypad
 * mode, writing to C0-DF to joystick mode; each read then gives that half of
 * the controller, active low.
 */
export class Controllers {
  keypadMode = false;
  readonly inputs: readonly [ControllerInput, ControllerInput] = [new ControllerInput(), new ControllerInput()];

  reset(): void {
    this.keypadMode = false;
  }

  read(port: 0 | 1): number {
    const state = this.inputs[port].state;
    if (this.keypadMode) {
      let code = NO_KEY;
      KEYPAD_CODES.forEach((keyCode, key) => {
        if (state.keys & (1 << key)) code &= keyCode;
      });
      return IDLE_LINES | code | (state.rightFire ? 0 : FIRE);
    }
    return IDLE_LINES | (~state.dirs & 0x0f) | (state.leftFire ? 0 : FIRE);
  }
}
