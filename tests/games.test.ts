import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBios } from '../src/bios/bios-store';
import { createCartridge, detectKind } from '../src/cart/detect';
import { CARTRIDGE_EXTENSIONS } from '../src/cart/load';
import { ColecoVision } from '../src/colecovision';
import { framePng } from './helpers/png';

// Cartridge images and the BIOS are never committed. These run the free games (npm run
// build:games puts them in public/games/) and your own cartridges in roms/, given the
// BIOS as COLECO_BIOS=/path/to/coleco.rom.
const root = join(import.meta.dirname, '..');
const localBios = join(root, 'public', 'roms', 'system', 'coleco.rom');
const biosPath = process.env.COLECO_BIOS ?? localBios;
const cartridgesIn = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => CARTRIDGE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext)))
        .map((name) => join(dir, name))
    : [];
const cartridges = existsSync(biosPath)
  ? [...cartridgesIn(join(root, 'public', 'games')), ...cartridgesIn(join(root, 'roms'))]
  : [];
/** Set SHOTS=<dir> to save screenshots of the title screen and the game. */
const shotsDir = process.env.SHOTS;
const SECONDS_TO_RUN = 20;
const FPS = 60;

describe.skipIf(cartridges.length === 0)('cartridges', () => {
  for (const path of cartridges) {
    const name = basename(path);
    it(`${name} gets past the title screen and runs its own code`, () => {
      const machine = new ColecoVision();
      machine.setBios(checkBios(new Uint8Array(readFileSync(biosPath))).bios);
      const image = new Uint8Array(readFileSync(path));
      machine.insertCartridge(createCartridge(image, detectKind(image)));
      let framesInCartridge = 0;
      for (let frame = 1; frame <= SECONDS_TO_RUN * FPS; frame++) {
        machine.runFrame();
        if (machine.cpu.pc >= 0x8000) framesInCartridge++;
        if (shotsDir && (frame === 3 * FPS || frame === SECONDS_TO_RUN * FPS)) {
          mkdirSync(shotsDir, { recursive: true });
          const label = frame === 3 * FPS ? 'title' : 'game';
          writeFileSync(join(shotsDir, `${name.replace(/\.[^.]+$/, '')} - ${label}.png`), framePng(machine.vdp.framebuffer));
        }
      }
      expect(framesInCartridge).toBeGreaterThan(FPS);
      expect(machine.vdp.registers[1] & 0x40).toBe(0x40);
      expect(new Set(machine.vdp.framebuffer).size).toBeGreaterThan(2);
    }, 60_000);
  }
});
