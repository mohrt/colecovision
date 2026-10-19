import { describe, expect, it } from 'vitest';
import { ColecoVision } from '../src/colecovision';
import {
  BORDER_X,
  BORDER_Y,
  FRAME_WIDTH,
  STATUS_COINCIDENCE,
  STATUS_FIFTH_SPRITE,
  STATUS_INTERRUPT,
  Tms9918,
} from '../src/vdp/tms9918';

function setRegister(vdp: Tms9918, register: number, value: number): void {
  vdp.writeControl(value);
  vdp.writeControl(0x80 | register);
}

/** The colour of active-area pixel (x, y). */
function pixel(vdp: Tms9918, x: number, y: number): number {
  return vdp.framebuffer[(y + BORDER_Y) * FRAME_WIDTH + BORDER_X + x];
}

/** Graphics I with names at 1800, colours at 2000, patterns at 0000 and sprites at 1B00/3800. */
function graphics1(): Tms9918 {
  const vdp = new Tms9918();
  setRegister(vdp, 0, 0x00);
  setRegister(vdp, 1, 0x40);
  setRegister(vdp, 2, 0x06);
  setRegister(vdp, 3, 0x80);
  setRegister(vdp, 4, 0x00);
  setRegister(vdp, 5, 0x36);
  setRegister(vdp, 6, 0x07);
  setRegister(vdp, 7, 0x04);
  vdp.vram[0x1b00] = 0xd0; // no sprites
  return vdp;
}

describe('TMS9918A ports', () => {
  it('auto-increments the address and reads through the read-ahead buffer', () => {
    const vdp = new Tms9918();
    vdp.vram.set([1, 2, 3], 0x1000);
    vdp.writeControl(0x00);
    vdp.writeControl(0x10); // read from 1000
    expect([vdp.readData(), vdp.readData(), vdp.readData()]).toEqual([1, 2, 3]);
    vdp.writeControl(0xff);
    vdp.writeControl(0x7f); // write to 3FFF, then wrap to 0000
    vdp.writeData(0xaa);
    vdp.writeData(0xbb);
    expect([vdp.vram[0x3fff], vdp.vram[0]]).toEqual([0xaa, 0xbb]);
  });

  it('resets the control latch when the status is read', () => {
    const vdp = new Tms9918();
    vdp.writeControl(0x05);
    vdp.readStatus();
    vdp.writeControl(0x02);
    vdp.writeControl(0x87);
    expect(vdp.registers[7]).toBe(0x02);
  });
});

describe('TMS9918A interrupt', () => {
  it('raises INT at vertical blank when enabled, and reading the status clears it', () => {
    const vdp = new Tms9918();
    const changes: boolean[] = [];
    vdp.onInterrupt = (active) => changes.push(active);
    vdp.startVerticalBlank();
    expect(vdp.interrupt).toBe(false);
    setRegister(vdp, 1, 0x20); // enabling with the flag already set interrupts straight away
    expect(vdp.interrupt).toBe(true);
    expect(vdp.readStatus() & STATUS_INTERRUPT).toBe(STATUS_INTERRUPT);
    expect(vdp.interrupt).toBe(false);
    expect(changes).toEqual([true, false]);
  });

  it('interrupts the Z80 through NMI once per frame', () => {
    const machine = new ColecoVision();
    machine.vdp.registers[1] = 0x20;
    let nmis = 0;
    const nmi = machine.cpu.nmi.bind(machine.cpu);
    machine.cpu.nmi = () => {
      nmis++;
      nmi();
    };
    machine.bus.bios = new Uint8Array(0x2000); // NOPs
    machine.bus.bios.set([0xdb, 0xbf, 0xed, 0x45], 0x66); // IN A,(BFh); RETN
    for (let frame = 0; frame < 3; frame++) machine.runFrame();
    expect(nmis).toBe(3);
  });
});

describe('TMS9918A modes', () => {
  it('draws Graphics I patterns in their colour group, with 0 showing the backdrop', () => {
    const vdp = graphics1();
    vdp.vram[0x1800] = 0x08; // name 8 at the top left
    vdp.vram[0x0040] = 0xf0; // its first row: left half set
    vdp.vram[0x2001] = 0xa0; // colour group 1: yellow on transparent
    vdp.renderLine(0);
    expect(pixel(vdp, 0, 0)).toBe(0x0a);
    expect(pixel(vdp, 4, 0)).toBe(0x04);
    expect(vdp.framebuffer[BORDER_Y * FRAME_WIDTH]).toBe(0x04); // border
  });

  it('draws Graphics II with a pattern and colour per row, per screen third', () => {
    const vdp = graphics1();
    setRegister(vdp, 0, 0x02);
    setRegister(vdp, 3, 0xff); // colours at 2000
    setRegister(vdp, 4, 0x03); // patterns at 0000
    vdp.vram[0x1800 + 8 * 32] = 0x05; // line 64 (second third), name 5
    const offset = (0x100 + 5) * 8;
    vdp.vram[offset] = 0x80;
    vdp.vram[0x2000 + offset] = 0x6f;
    vdp.renderLine(64);
    expect(pixel(vdp, 0, 64)).toBe(0x06);
    expect(pixel(vdp, 1, 64)).toBe(0x0f);
  });

  it('draws Multicolor blocks of 4x4 pixels', () => {
    const vdp = graphics1();
    setRegister(vdp, 1, 0x48);
    vdp.vram[0x1800] = 0x01;
    vdp.vram[0x0008] = 0x2d; // name 1, first byte: green then magenta
    vdp.renderLine(3);
    expect([pixel(vdp, 0, 3), pixel(vdp, 3, 3), pixel(vdp, 4, 3)]).toEqual([2, 2, 13]);
  });

  it('draws Text mode in 6-pixel columns with the R7 colours', () => {
    const vdp = graphics1();
    setRegister(vdp, 1, 0x50);
    setRegister(vdp, 7, 0xf1);
    vdp.vram[0x1801] = 0x02; // second column
    vdp.vram[0x0010] = 0xfc;
    vdp.renderLine(0);
    expect(pixel(vdp, 7, 0)).toBe(1);
    expect(pixel(vdp, 14, 0)).toBe(15);
    expect(pixel(vdp, 19, 0)).toBe(15);
    expect(pixel(vdp, 20, 0)).toBe(1);
  });

  it('shows only the backdrop while the display is blanked', () => {
    const vdp = graphics1();
    setRegister(vdp, 1, 0x00);
    vdp.vram[0x1800] = 0x08;
    vdp.vram[0x0040] = 0xff;
    vdp.vram[0x2001] = 0xf0;
    vdp.renderLine(0);
    expect(pixel(vdp, 0, 0)).toBe(4);
  });
});

describe('TMS9918A sprites', () => {
  function sprite(vdp: Tms9918, index: number, y: number, x: number, name: number, color: number): void {
    vdp.vram.set([y, x, name, color], 0x1b00 + index * 4);
  }

  it('draws a sprite one line below its Y, with the early clock shifting it 32 pixels left', () => {
    const vdp = graphics1();
    vdp.vram.fill(0xff, 0x3800, 0x3808);
    sprite(vdp, 0, 9, 40, 0, 0x08);
    sprite(vdp, 1, 9, 40, 0, 0x8f);
    vdp.vram[0x1b08] = 0xd0;
    vdp.renderLine(9);
    expect(pixel(vdp, 40, 9)).toBe(4);
    vdp.renderLine(10);
    expect(pixel(vdp, 40, 10)).toBe(8);
    expect(pixel(vdp, 8, 10)).toBe(15);
  });

  it('gives lower-numbered sprites priority and flags coincidence', () => {
    const vdp = graphics1();
    vdp.vram.fill(0xff, 0x3800, 0x3808);
    sprite(vdp, 0, 0, 0, 0, 0x02);
    sprite(vdp, 1, 0, 4, 0, 0x06);
    vdp.vram[0x1b08] = 0xd0;
    vdp.renderLine(1);
    expect([pixel(vdp, 3, 1), pixel(vdp, 4, 1), pixel(vdp, 8, 1)]).toEqual([2, 2, 6]);
    expect(vdp.status & STATUS_COINCIDENCE).toBe(STATUS_COINCIDENCE);
  });

  it('lets lower sprites show through a transparent one', () => {
    const vdp = graphics1();
    vdp.vram.fill(0xff, 0x3800, 0x3808);
    sprite(vdp, 0, 0, 0, 0, 0x00);
    sprite(vdp, 1, 0, 0, 0, 0x06);
    vdp.vram[0x1b08] = 0xd0;
    vdp.renderLine(1);
    expect(pixel(vdp, 0, 1)).toBe(6);
  });

  it('draws only four sprites on a line and reports the fifth', () => {
    const vdp = graphics1();
    vdp.vram.fill(0xff, 0x3800, 0x3808);
    for (let i = 0; i < 6; i++) sprite(vdp, i, 0, i * 16, 0, 0x0f);
    vdp.vram[0x1b18] = 0xd0;
    vdp.renderLine(1);
    expect(pixel(vdp, 48, 1)).toBe(15);
    expect(pixel(vdp, 64, 1)).toBe(4);
    expect(vdp.status & (STATUS_FIFTH_SPRITE | 0x1f)).toBe(STATUS_FIFTH_SPRITE | 4);
    vdp.readStatus();
    expect(vdp.status & STATUS_FIFTH_SPRITE).toBe(0);
  });

  it('draws 16x16 sprites from four patterns, magnified to 32x32', () => {
    const vdp = graphics1();
    setRegister(vdp, 1, 0x43);
    vdp.vram[0x3800 + 4 * 8] = 0x80; // name 4 (top left quarter), row 0
    vdp.vram[0x3800 + 4 * 8 + 16] = 0x01; // top right quarter, row 0
    sprite(vdp, 0, 0xff, 0, 0x05, 0x0d); // Y = -1: starts on line 0; name 5 is rounded down to 4
    vdp.renderLine(1);
    expect([pixel(vdp, 0, 1), pixel(vdp, 1, 1), pixel(vdp, 2, 1)]).toEqual([13, 13, 4]);
    expect([pixel(vdp, 29, 1), pixel(vdp, 30, 1), pixel(vdp, 31, 1)]).toEqual([4, 13, 13]);
    vdp.renderLine(2);
    expect(pixel(vdp, 0, 2)).toBe(4);
  });
});
