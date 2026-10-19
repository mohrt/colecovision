import { describe, expect, it } from 'vitest';
import { Controllers, Dir, keyBit } from '../src/io/controllers';
import { GamepadManager, hatDirections, readGamepad, type GamepadLike } from '../src/io/gamepad-input';

function pad(overrides: Partial<GamepadLike> & { pressed?: number[] }): GamepadLike {
  const pressed = new Set(overrides.pressed ?? []);
  return {
    id: 'Test pad',
    index: 0,
    mapping: 'standard',
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: pressed.has(i) })),
    ...overrides,
  };
}

describe('controllers', () => {
  it('combines keys pressed together by pulling their lines low', () => {
    const controllers = new Controllers();
    controllers.keypadMode = true;
    controllers.inputs[0].set('a', { keys: keyBit('1') | keyBit('2') });
    expect(controllers.read(0) & 0x0f).toBe(0x0d & 0x07);
  });

  it('merges sources and forgets one when it is cleared', () => {
    const controllers = new Controllers();
    const input = controllers.inputs[0];
    input.set('keyboard', { dirs: Dir.Left });
    input.set('gamepad', { dirs: Dir.Up, leftFire: true });
    expect(controllers.read(0)).toBe(0x30 | (0x0f & ~(Dir.Left | Dir.Up)));
    input.clear('gamepad');
    expect(controllers.read(0)).toBe(0x70 | (0x0f & ~Dir.Left));
  });
});

describe('gamepads', () => {
  it('reads a standard pad: D-pad and stick, side buttons and keypad keys', () => {
    const state = readGamepad(pad({ pressed: [12, 0, 9], axes: [0.9, 0, 0, 0] }));
    expect(state.dirs).toBe(Dir.Up | Dir.Right);
    expect(state.leftFire).toBe(true);
    expect(state.rightFire).toBe(false);
    expect(state.keys).toBe(keyBit('1'));
  });

  it('reads a hat switch on a pad without the standard mapping', () => {
    expect(hatDirections(-1)).toBe(Dir.Up);
    expect(hatDirections(1.28)).toBe(0);
    const resting = pad({ id: 'Generic stick', mapping: '', axes: [0, 0, 1.28] });
    expect(readGamepad(resting).dirs).toBe(0);
    const right = pad({ id: 'Generic stick', mapping: '', axes: [0, 0, -1 + 2 / 7 * 2] });
    expect(readGamepad(right).dirs).toBe(Dir.Right);
  });

  it('orders pads by when they were connected', () => {
    let pads: (GamepadLike | null)[] = [null, pad({ index: 1, id: 'second' })];
    const manager = new GamepadManager(() => pads);
    expect(manager.connected().map((p) => p.id)).toEqual(['second']);
    pads = [pad({ index: 0, id: 'first' }), pads[1]];
    expect(manager.connected().map((p) => p.id)).toEqual(['second', 'first']);
  });
});
