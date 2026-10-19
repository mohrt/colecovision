import { StandardCartridge, type Cartridge, type CartridgeKind } from './cartridge';
import { BANK_SIZE, MegaCart } from './megacart';

const STANDARD_MAX = 0x8000;

/** Coleco's cartridge test: AA 55 (show the title screen) or 55 AA (skip it) at the start of the code. */
export function hasHeader(image: Uint8Array, offset = 0): boolean {
  const first = image[offset];
  const second = image[offset + 1];
  return (first === 0xaa && second === 0x55) || (first === 0x55 && second === 0xaa);
}

/** Images bigger than the 32K window must bank switch; MegaCart is the scheme they all use. */
export function detectKind(image: Uint8Array): CartridgeKind {
  return image.length > STANDARD_MAX ? 'megacart' : 'standard';
}

/** A warning for images that don't look like ColecoVision cartridges, or null if they do. */
export function headerWarning(image: Uint8Array, kind: CartridgeKind): string | null {
  const offset = kind === 'megacart' ? (Math.ceil(image.length / BANK_SIZE) - 1) * BANK_SIZE : 0;
  if (hasHeader(image, offset)) return null;
  return 'This image has no ColecoVision cartridge header, so the console may not start it.';
}

export function createCartridge(image: Uint8Array, kind: CartridgeKind): Cartridge {
  if (kind === 'standard' && image.length > STANDARD_MAX) {
    throw new Error('That image is bigger than 32K, so it needs the MegaCart scheme.');
  }
  return kind === 'megacart' ? new MegaCart(image) : new StandardCartridge(image);
}
