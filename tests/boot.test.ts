import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBios } from '../src/bios/bios-store';
import { ColecoVision } from '../src/colecovision';

// The real BIOS is copyrighted and never committed: this runs with the site's copy in
// public/roms/system/coleco.rom, or one given as COLECO_BIOS=/path/to/coleco.rom.
const sitePath = join(import.meta.dirname, '..', 'public', 'roms', 'system', 'coleco.rom');
const biosPath = process.env.COLECO_BIOS ?? (existsSync(sitePath) ? sitePath : undefined);

describe.skipIf(!biosPath)('the Coleco BIOS', () => {
  it('starts up and draws its screen with no cartridge in', () => {
    const machine = new ColecoVision();
    machine.setBios(checkBios(new Uint8Array(readFileSync(biosPath!))).bios);
    for (let frame = 0; frame < 120; frame++) machine.runFrame();
    expect(machine.vdp.registers[1] & 0x40).toBe(0x40);
    expect(new Set(machine.vdp.framebuffer).size).toBeGreaterThan(1);
  });
});
