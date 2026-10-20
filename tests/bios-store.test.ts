import { describe, expect, it } from 'vitest';
import { BiosStore, checkBios } from '../src/bios/bios-store';
import { BIOS_SIZE } from '../src/bus';
import { MemoryStore } from '../src/storage/store';

describe('BIOS', () => {
  it('accepts any 8K image, warning when it is not the usual Coleco BIOS', () => {
    expect(checkBios(new Uint8Array(BIOS_SIZE)).warning).toMatch(/not the usual Coleco/);
    expect(() => checkBios(new Uint8Array(100))).toThrow(/exactly 8192 bytes/);
  });

  it('is kept between page loads until forgotten', async () => {
    const backing = new MemoryStore<Uint8Array>();
    await new BiosStore(backing).save(new Uint8Array(BIOS_SIZE).fill(7));
    const reloaded = new BiosStore(backing);
    expect((await reloaded.load())?.[0]).toBe(7);
    await reloaded.forget();
    expect(await reloaded.load()).toBeUndefined();
  });
});
