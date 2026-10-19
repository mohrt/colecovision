export type CartridgeKind = 'standard' | 'megacart';

export const CARTRIDGE_KIND_LABELS: Record<CartridgeKind, string> = {
  standard: 'Standard (up to 32K)',
  megacart: 'MegaCart (bank switched)',
};

/** A cartridge in the slot, answering reads of 8000-FFFF. */
export interface Cartridge {
  readonly kind: CartridgeKind;
  readonly rom: Uint8Array;
  read(address: number): number;
  /** Back to the power-on state (the first bank, for bank-switched carts). */
  reset(): void;
}

/** A plain cartridge: up to 32K of ROM at 8000; addresses past its end read as $FF. */
export class StandardCartridge implements Cartridge {
  readonly kind = 'standard';

  constructor(readonly rom: Uint8Array) {}

  read(address: number): number {
    const offset = address - 0x8000;
    return offset < this.rom.length ? this.rom[offset] : 0xff;
  }

  reset(): void {}
}
