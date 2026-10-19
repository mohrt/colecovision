import { BIOS_SIZE } from '../bus';
import type { KeyValueStore } from '../storage/store';

/** CRC-32 of the Coleco BIOS ROM (the one every ColecoVision shipped with). */
export const KNOWN_BIOS_CRC = 0x3aa93ef3;
const KEY = 'bios';

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

export interface BiosCheck {
  bios: Uint8Array;
  /** Set when the image is the right size but not the usual Coleco BIOS (a patched or homebrew one). */
  warning: string | null;
}

/** Checks a file meant to be the BIOS; throws if it can't be one. */
export function checkBios(bytes: Uint8Array): BiosCheck {
  if (bytes.length !== BIOS_SIZE) {
    throw new Error(`A ColecoVision BIOS is exactly ${BIOS_SIZE} bytes (8K); that file is ${bytes.length}.`);
  }
  const warning =
    crc32(bytes) === KNOWN_BIOS_CRC ? null : 'That BIOS is not the usual Coleco one; games may not all work with it.';
  return { bios: bytes, warning };
}

/** The user's BIOS, kept in browser storage so it only has to be given once. */
export class BiosStore {
  constructor(private readonly store: KeyValueStore<Uint8Array>) {}

  load(): Promise<Uint8Array | undefined> {
    return this.store.get(KEY);
  }

  save(bios: Uint8Array): Promise<void> {
    return this.store.put(KEY, bios);
  }

  forget(): Promise<void> {
    return this.store.delete(KEY);
  }
}
