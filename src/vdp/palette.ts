/**
 * The TMS9918A's colours as RGB (colour 0 is transparent, shown as the
 * backdrop, so it never reaches the screen as itself; it is drawn black).
 */
export const PALETTE_RGB: readonly number[] = [
  0x000000, // 0 transparent
  0x000000, // 1 black
  0x21c842, // 2 medium green
  0x5edc78, // 3 light green
  0x5455ed, // 4 dark blue
  0x7d76fc, // 5 light blue
  0xd4524d, // 6 dark red
  0x42ebf5, // 7 cyan
  0xfc5554, // 8 medium red
  0xff7978, // 9 light red
  0xd4c154, // 10 dark yellow
  0xe6ce80, // 11 light yellow
  0x21b03b, // 12 dark green
  0xc95bba, // 13 magenta
  0xcccccc, // 14 grey
  0xffffff, // 15 white
];

/** The palette as canvas pixels (little-endian ABGR). */
export const PALETTE: Uint32Array = Uint32Array.from(PALETTE_RGB, (rgb) => {
  const r = (rgb >> 16) & 0xff;
  const g = (rgb >> 8) & 0xff;
  const b = rgb & 0xff;
  return (0xff000000 | (b << 16) | (g << 8) | r) >>> 0;
});
