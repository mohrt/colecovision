import { Dir, keyBit, type KeypadKey, type PadState } from './controllers';

/** The parts of the browser's Gamepad object we use (so tests can pass plain objects). */
export interface GamepadLike {
  readonly id: string;
  readonly index: number;
  readonly mapping: string;
  readonly connected?: boolean;
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly pressed: boolean }[];
}

const AXIS_THRESHOLD = 0.5;
/** Axes never go past ±1; a hat switch reads about 1.29 when centred. */
const HAT_NEUTRAL_LIMIT = 1.05;

// Standard gamepad mapping (https://w3c.github.io/gamepad/#remapping)
const DPAD_UP = 12;
const DPAD_DOWN = 13;
const DPAD_LEFT = 14;
const DPAD_RIGHT = 15;
const LEFT_FIRE_BUTTONS = [0, 6];
const RIGHT_FIRE_BUTTONS = [1, 7];
/** Face, shoulder and middle buttons give the keypad keys games most often ask for. */
const KEYPAD_BUTTONS: [number, KeypadKey][] = [
  [2, '*'],
  [3, '#'],
  [4, '3'],
  [5, '4'],
  [8, '2'],
  [9, '1'],
];

const HAT_STEPS = [
  Dir.Up,
  Dir.Up | Dir.Right,
  Dir.Right,
  Dir.Down | Dir.Right,
  Dir.Down,
  Dir.Down | Dir.Left,
  Dir.Left,
  Dir.Up | Dir.Left,
];

/**
 * Directions of a hat switch reported as one axis: eight positions from -1
 * (up) clockwise in steps of 2/7, and a value beyond ±1 when centred. Many USB
 * joysticks report their stick this way when the browser has no standard mapping.
 */
export function hatDirections(value: number): number {
  if (Math.abs(value) > HAT_NEUTRAL_LIMIT) return 0;
  return HAT_STEPS[Math.round((value + 1) * 3.5)] ?? 0;
}

/** Axes seen resting beyond ±1, which makes them hat switches, by pad id. */
const knownHatAxes = new Map<string, Set<number>>();

function hatAxes(pad: GamepadLike): Set<number> {
  let hats = knownHatAxes.get(pad.id);
  if (!hats) {
    hats = new Set();
    knownHatAxes.set(pad.id, hats);
  }
  pad.axes.forEach((value, index) => {
    if (Math.abs(value) > HAT_NEUTRAL_LIMIT) hats.add(index);
  });
  return hats;
}

function axisPairDirs(x: number, y: number): number {
  let dirs = 0;
  if (y < -AXIS_THRESHOLD) dirs |= Dir.Up;
  if (y > AXIS_THRESHOLD) dirs |= Dir.Down;
  if (x < -AXIS_THRESHOLD) dirs |= Dir.Left;
  if (x > AXIS_THRESHOLD) dirs |= Dir.Right;
  return dirs;
}

/** A pad as a ColecoVision controller: D-pad or stick, A/B for the side buttons, the rest for keypad keys. */
export function readGamepad(pad: GamepadLike): PadState {
  const pressed = (i: number) => pad.buttons[i]?.pressed ?? false;
  const axes = pad.axes;
  let dirs = 0;
  if (pad.mapping === 'standard') {
    if (pressed(DPAD_UP)) dirs |= Dir.Up;
    if (pressed(DPAD_DOWN)) dirs |= Dir.Down;
    if (pressed(DPAD_LEFT)) dirs |= Dir.Left;
    if (pressed(DPAD_RIGHT)) dirs |= Dir.Right;
    dirs |= axisPairDirs(axes[0] ?? 0, axes[1] ?? 0);
  } else {
    const hats = hatAxes(pad);
    if (!hats.has(0) && !hats.has(1)) dirs |= axisPairDirs(axes[0] ?? 0, axes[1] ?? 0);
    for (const index of hats) dirs |= hatDirections(axes[index] ?? 2);
  }
  let keys = 0;
  for (const [button, key] of KEYPAD_BUTTONS) if (pressed(button)) keys |= keyBit(key);
  return {
    dirs,
    leftFire: LEFT_FIRE_BUTTONS.some(pressed),
    rightFire: RIGHT_FIRE_BUTTONS.some(pressed),
    keys,
  };
}

/** Connected gamepads in the order they were plugged in; the first is player 1, the second player 2. */
export class GamepadManager {
  private readonly connectOrder: number[] = [];

  constructor(private readonly source: () => readonly (GamepadLike | null)[] = browserGamepads) {}

  attach(target: Window): void {
    target.addEventListener('gamepadconnected', (event) => this.noteConnected((event as GamepadEvent).gamepad.index));
    target.addEventListener('gamepaddisconnected', (event) => {
      const at = this.connectOrder.indexOf((event as GamepadEvent).gamepad.index);
      if (at >= 0) this.connectOrder.splice(at, 1);
    });
  }

  private noteConnected(index: number): void {
    if (!this.connectOrder.includes(index)) this.connectOrder.push(index);
  }

  connected(): GamepadLike[] {
    const pads = [...this.source()].filter((pad): pad is GamepadLike => pad !== null && pad.connected !== false);
    for (const pad of pads) this.noteConnected(pad.index);
    const rank = (pad: GamepadLike) => this.connectOrder.indexOf(pad.index);
    return pads.sort((a, b) => rank(a) - rank(b));
  }
}

function browserGamepads(): readonly (GamepadLike | null)[] {
  try {
    return navigator.getGamepads?.() ?? [];
  } catch {
    // Blocked by a permissions policy.
    return [];
  }
}

/** A short, readable name for a pad (browsers add vendor and product codes). */
export function padName(pad: GamepadLike): string {
  return pad.id.replace(/\s*\(.*\)\s*$/, '').trim() || 'Gamepad';
}
