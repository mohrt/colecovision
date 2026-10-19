import type { Cartridge } from './cartridge';

export const BANK_SIZE = 0x4000;
/** Reading any address from here up selects the bank at C000-FFFF. */
const BANK_SELECT = 0xffc0;

/**
 * A MegaCart: ROM in 16K banks (64K up to 1M), with the last bank fixed at
 * 8000-BFFF and the bank at C000-FFFF chosen by reading FFC0-FFFF (the low
 * address bits are the bank number).
 */
export class MegaCart implements Cartridge {
  readonly kind = 'megacart';
  readonly banks: number;
  bank = 0;
  private readonly fixedBank: number;

  constructor(readonly rom: Uint8Array) {
    this.banks = Math.max(1, Math.ceil(rom.length / BANK_SIZE));
    this.fixedBank = this.banks - 1;
  }

  read(address: number): number {
    if (address < 0xc000) return this.byte(this.fixedBank * BANK_SIZE + address - 0x8000);
    if (address >= BANK_SELECT) this.bank = (address - BANK_SELECT) % this.banks;
    return this.byte(this.bank * BANK_SIZE + address - 0xc000);
  }

  private byte(offset: number): number {
    return offset < this.rom.length ? this.rom[offset] : 0xff;
  }

  reset(): void {
    this.bank = 0;
  }
}
