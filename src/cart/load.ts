import { isZip, usableFilesInZip } from './zip';

export const CARTRIDGE_EXTENSIONS = ['.col', '.cv', '.bin', '.rom'];
export const STATE_EXTENSION = '.colstate';
/** The biggest MegaCart is 1M. */
const MAX_IMAGE_SIZE = 0x100000;

export type Media =
  | { kind: 'cartridge'; image: Uint8Array; name: string }
  | { kind: 'state'; bytes: Uint8Array; name: string };

/** gzip files start with $1F $8B; save states are gzipped. */
export function looksLikeSaveState(bytes: Uint8Array): boolean {
  return bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** A display name from a file name: no extension, underscores as spaces. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.[^.]+$/, '').replace(/[_]+/g, ' ').trim() || name;
}

/** Works out what a file is: a cartridge image or a save state. */
export async function readMedia(file: File): Promise<Media> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const name = file.name.toLowerCase();
  if (name.endsWith(STATE_EXTENSION) || looksLikeSaveState(bytes)) return { kind: 'state', bytes, name: file.name };
  if (bytes.length === 0) throw new Error(`${file.name} is empty.`);
  if (bytes.length > MAX_IMAGE_SIZE) throw new Error(`${file.name} is too big to be a ColecoVision cartridge.`);
  const knownExtension = CARTRIDGE_EXTENSIONS.some((ext) => name.endsWith(ext));
  // Files with other extensions are accepted if their size looks like a cartridge.
  if (!knownExtension && bytes.length % 0x400 !== 0) {
    throw new Error(`${file.name} isn't something the ColecoVision can use. Try a .col or .rom file.`);
  }
  return { kind: 'cartridge', image: bytes, name: file.name };
}

/** The usable files in a dropped file: itself, or the cartridge images and states inside a zip. */
export async function filesFrom(file: File): Promise<File[]> {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  if (!isZip(head) && !file.name.toLowerCase().endsWith('.zip')) return [file];
  const files = await usableFilesInZip(new Uint8Array(await file.arrayBuffer()));
  if (files.length === 0) throw new Error(`${file.name} has no cartridge images in it.`);
  return files;
}
