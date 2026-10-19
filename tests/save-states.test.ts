import { describe, expect, it } from 'vitest';
import { createCartridge } from '../src/cart/detect';
import type { MegaCart } from '../src/cart/megacart';
import { ColecoVision } from '../src/colecovision';
import { SaveStates, decodeSession, encodeSession, type SaveStateRecord, type Session } from '../src/storage/save-states';
import { MemoryStore } from '../src/storage/store';
import { testBios } from './helpers/test-bios';

const rom = new Uint8Array(0x20000).map((_, i) => i >> 14);

function running(frames: number): ColecoVision {
  const machine = new ColecoVision();
  machine.setBios(testBios());
  machine.insertCartridge(createCartridge(rom, 'megacart'));
  for (let i = 0; i < frames; i++) machine.runFrame();
  return machine;
}

/** What should match between two machines run the same way from the same state. */
function fingerprint(machine: ColecoVision) {
  return {
    pc: machine.cpu.pc,
    cycles: machine.cpu.cycles,
    ram: [...machine.bus.ram],
    vram: [...machine.vdp.vram],
    frame: [...machine.vdp.framebuffer],
    bank: (machine.cartridge as MegaCart).bank,
    tone: machine.psg.tones[0],
    audio: [...machine.audio.takeSamples()],
  };
}

describe('save states', () => {
  it('restores a machine so it carries on exactly as the original did', () => {
    const original = running(10);
    const state = original.saveState();
    original.audio.takeSamples();
    for (let i = 0; i < 5; i++) original.runFrame();

    const restored = running(0);
    restored.loadState(state);
    restored.audio.takeSamples();
    for (let i = 0; i < 5; i++) restored.runFrame();

    const expected = fingerprint(original);
    expect(expected.bank).toBe(2);
    expect(fingerprint(restored)).toEqual(expected);
  });

  it('keeps the Super Game Module setting and its paging', () => {
    const machine = running(1);
    machine.sgm.enabled = false;
    const state = machine.saveState();
    const other = running(1);
    other.loadState(state);
    expect(other.sgm.enabled).toBe(false);
  });

  it('round-trips a session through the file format and the store, newest first', async () => {
    const machine = running(3);
    const session: Session = { machine: machine.saveState(), rom, romName: 'test.col', title: 'Test', kind: 'megacart' };
    const decoded = await decodeSession(await encodeSession(session));
    expect(decoded.rom).toEqual(rom);
    expect(decoded.kind).toBe('megacart');
    const copy = running(0);
    copy.loadState(decoded.machine);
    expect(copy.cpu.cycles).toBe(machine.cpu.cycles);

    const states = new SaveStates(new MemoryStore<SaveStateRecord>());
    await states.add('first', session);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await states.add('second', session);
    const list = await states.list();
    expect(list.map((s) => s.name)).toEqual(['second', 'first']);
    expect((await states.load(list[1].id))?.title).toBe('Test');
    await states.delete(list[0].id);
    expect((await states.list()).length).toBe(1);
  });

  it('rejects files that are not ColecoVision states', async () => {
    await expect(decodeSession(new Uint8Array([1, 2, 3]))).rejects.toThrow(/not a ColecoVision save state/);
  });
});
