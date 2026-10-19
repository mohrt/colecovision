import { describe, expect, it } from 'vitest';
import { checkBios, crc32 } from '../src/bios/bios-store';
import { createCartridge, detectKind, hasHeader, headerWarning } from '../src/cart/detect';
import { MegaCart } from '../src/cart/megacart';
import { ColecoVision } from '../src/colecovision';
import { keyBit } from '../src/io/controllers';

function megaImage(banks: number): Uint8Array {
  const image = new Uint8Array(banks * 0x4000);
  for (let bank = 0; bank < banks; bank++) image.fill(bank, bank * 0x4000, (bank + 1) * 0x4000);
  image.set([0x55, 0xaa], (banks - 1) * 0x4000);
  return image;
}

describe('memory map', () => {
  it('maps the BIOS, mirrors 1K of RAM through 6000-7FFF and leaves the expansion area open', () => {
    const machine = new ColecoVision();
    const bios = new Uint8Array(0x2000).fill(0x11);
    machine.setBios(bios);
    const { bus } = machine;
    expect(bus.read(0x0000)).toBe(0x11);
    bus.write(0x0000, 0x99);
    expect(bus.read(0x0000)).toBe(0x11);
    expect(bus.read(0x4000)).toBe(0xff);
    bus.write(0x6005, 0x42);
    expect(bus.read(0x7c05)).toBe(0x42);
    expect(bus.read(0x8000)).toBe(0xff);
  });

  it('maps a cartridge at 8000, with open bus past its end', () => {
    const machine = new ColecoVision();
    const image = new Uint8Array(0x2000).fill(0x77);
    image.set([0xaa, 0x55]);
    machine.insertCartridge(createCartridge(image, detectKind(image)));
    expect(machine.bus.read(0x8000)).toBe(0xaa);
    expect(machine.bus.read(0x9fff)).toBe(0x77);
    expect(machine.bus.read(0xa000)).toBe(0xff);
  });
});

describe('I/O decoding', () => {
  it('reaches the VDP through any port in A0-BF and the sound chip through E0-FF', () => {
    const machine = new ColecoVision();
    machine.bus.output(0xbf, 0x00);
    machine.bus.output(0xbf, 0x40); // write address 0000
    machine.bus.output(0xbe, 0x5a);
    machine.bus.output(0xa0, 0x33); // data port mirror
    expect([machine.vdp.vram[0], machine.vdp.vram[1]]).toEqual([0x5a, 0x33]);
    machine.bus.output(0xff, 0x9f); // channel 0 attenuation 15
    expect(machine.psg.volumes[0]).toBe(15);
  });

  it('reads controllers in joystick or keypad mode, active low', () => {
    const machine = new ColecoVision();
    const [player1, player2] = machine.controllers.inputs;
    player1.set('test', { dirs: 0x01, leftFire: true, rightFire: false, keys: keyBit('1') });
    player2.set('test', { rightFire: true, keys: keyBit('#') });
    machine.bus.output(0xc0, 0);
    expect(machine.bus.input(0xfc)).toBe(0x3e);
    expect(machine.bus.input(0xff)).toBe(0x7f);
    machine.bus.output(0x80, 0);
    expect(machine.bus.input(0xfc)).toBe(0x70 | 0x0d);
    expect(machine.bus.input(0xff)).toBe(0x30 | 0x06);
  });
});

describe('MegaCart', () => {
  it('fixes the last bank at 8000 and switches C000-FFFF by reading FFC0-FFFF', () => {
    const image = megaImage(8);
    expect(detectKind(image)).toBe('megacart');
    expect(headerWarning(image, 'megacart')).toBeNull();
    const cart = createCartridge(image, 'megacart') as MegaCart;
    expect(cart.read(0x8002)).toBe(7);
    expect(cart.read(0xc000)).toBe(0);
    cart.read(0xffc3);
    expect(cart.read(0xc123)).toBe(3);
    cart.read(0xffc0 + 9); // wraps to bank 1 of 8
    expect(cart.read(0xc000)).toBe(1);
    cart.reset();
    expect(cart.bank).toBe(0);
  });

  it('refuses a big image as a standard cartridge and warns about missing headers', () => {
    const image = new Uint8Array(0x10000);
    expect(() => createCartridge(image, 'standard')).toThrow(/MegaCart/);
    expect(hasHeader(image)).toBe(false);
    expect(headerWarning(image, 'megacart')).toMatch(/header/);
  });
});

describe('Super Game Module', () => {
  it('pages RAM over 2000-7FFF and over the BIOS, and drives the AY', () => {
    const machine = new ColecoVision();
    machine.setBios(new Uint8Array(0x2000).fill(0x22));
    const { bus, sgm } = machine;
    bus.write(0x6000, 0x01);
    bus.output(0x53, 0x01);
    expect(bus.read(0x2000)).toBe(0x00);
    bus.write(0x2000, 0x44);
    bus.write(0x6000, 0x55);
    expect(bus.read(0x2000)).toBe(0x44);
    bus.output(0x7f, 0x0d); // bit 1 clear: RAM over the BIOS
    expect(bus.read(0x0000)).toBe(0x00);
    bus.write(0x0000, 0x66);
    expect(bus.read(0x0000)).toBe(0x66);
    bus.output(0x7f, 0x0f);
    expect(bus.read(0x0000)).toBe(0x22);
    bus.output(0x53, 0x00);
    expect(bus.read(0x6000)).toBe(0x01);

    bus.output(0x50, 0x07);
    bus.output(0x51, 0x38);
    expect(bus.input(0x52)).toBe(0x38);
    expect(sgm.ay.registers[7]).toBe(0x38);
  });

  it('does nothing when unplugged', () => {
    const machine = new ColecoVision();
    machine.sgm.enabled = false;
    machine.bus.output(0x53, 0x01);
    expect(machine.bus.read(0x2000)).toBe(0xff);
    expect(machine.bus.input(0x52)).toBe(0xff);
  });
});

describe('BIOS check', () => {
  it('needs exactly 8K and warns about an unknown image', () => {
    expect(() => checkBios(new Uint8Array(100))).toThrow(/8192/);
    expect(checkBios(new Uint8Array(0x2000)).warning).toMatch(/not the usual/);
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
  });
});
