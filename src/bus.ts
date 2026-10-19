import type { Cartridge } from './cart/cartridge';
import type { Z80Bus } from './cpu/z80';
import type { Controllers } from './io/controllers';
import type { SuperGameModule } from './sgm';
import type { Sn76489 } from './sound/sn76489';
import type { Tms9918 } from './vdp/tms9918';

export const BIOS_SIZE = 0x2000;
const RAM_SIZE = 0x400;
const OPEN_BUS = 0xff;

/**
 * The ColecoVision's memory map and I/O decoding.
 *
 * Memory: BIOS at 0000-1FFF, the expansion port at 2000-5FFF, 1K of RAM
 * repeated through 6000-7FFF and the cartridge at 8000-FFFF (the Super Game
 * Module can page its RAM over the first two).
 *
 * I/O: address lines A7-A5 pick the device: 80-9F keypad mode, A0-BF the VDP
 * (A0 picks data or control), C0-DF joystick mode, E0-FF the sound chip
 * (writes) or a controller (reads; A1 picks which). Ports below 80 belong to
 * expansions such as the Super Game Module.
 */
export class ColecoBus implements Z80Bus {
  readonly ram = new Uint8Array(RAM_SIZE);
  bios: Uint8Array | null = null;
  cartridge: Cartridge | null = null;

  constructor(
    private readonly vdp: Tms9918,
    private readonly psg: Sn76489,
    private readonly controllers: Controllers,
    private readonly sgm: SuperGameModule,
  ) {}

  read(address: number): number {
    if (address < 0x2000) {
      if (this.sgm.lowerRam) return this.sgm.ram[address];
      return this.bios ? this.bios[address] : OPEN_BUS;
    }
    if (address < 0x8000) {
      if (this.sgm.upperRam) return this.sgm.ram[address];
      return address >= 0x6000 ? this.ram[address & (RAM_SIZE - 1)] : OPEN_BUS;
    }
    return this.cartridge ? this.cartridge.read(address) : OPEN_BUS;
  }

  write(address: number, value: number): void {
    if (address < 0x2000) {
      if (this.sgm.lowerRam) this.sgm.ram[address] = value;
    } else if (address < 0x8000) {
      if (this.sgm.upperRam) this.sgm.ram[address] = value;
      else if (address >= 0x6000) this.ram[address & (RAM_SIZE - 1)] = value;
    }
  }

  input(port: number): number {
    port &= 0xff;
    switch (port & 0xe0) {
      case 0xa0:
        return port & 0x01 ? this.vdp.readStatus() : this.vdp.readData();
      case 0xe0:
        return this.controllers.read(port & 0x02 ? 1 : 0);
      case 0x80:
      case 0xc0:
        return OPEN_BUS;
    }
    return this.sgm.input(port) ?? OPEN_BUS;
  }

  output(port: number, value: number): void {
    port &= 0xff;
    switch (port & 0xe0) {
      case 0x80:
        this.controllers.keypadMode = true;
        return;
      case 0xa0:
        if (port & 0x01) this.vdp.writeControl(value);
        else this.vdp.writeData(value);
        return;
      case 0xc0:
        this.controllers.keypadMode = false;
        return;
      case 0xe0:
        this.psg.write(value);
        return;
    }
    this.sgm.output(port, value);
  }
}
