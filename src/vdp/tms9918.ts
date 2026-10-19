/** Active display: 256 x 192 pixels. */
export const ACTIVE_WIDTH = 256;
export const ACTIVE_LINES = 192;
/** The frame shown also has some of the border (the backdrop colour) around the picture. */
export const BORDER_X = 8;
export const BORDER_Y = 8;
export const FRAME_WIDTH = ACTIVE_WIDTH + 2 * BORDER_X;
export const FRAME_HEIGHT = ACTIVE_LINES + 2 * BORDER_Y;

export const STATUS_INTERRUPT = 0x80;
export const STATUS_FIFTH_SPRITE = 0x40;
export const STATUS_COINCIDENCE = 0x20;

const VRAM_SIZE = 0x4000;
const SPRITE_TERMINATOR = 0xd0;
const MAX_SPRITES_PER_LINE = 4;

/**
 * The Texas Instruments TMS9918A video display processor: 16K of VRAM, eight
 * write-only registers and a status register, drawn one scanline at a time in
 * Graphics I, Graphics II, Multicolor and Text modes, with 32 sprites.
 *
 * Pixels are colour indexes (1-15; transparent pixels show the backdrop).
 */
export class Tms9918 {
  readonly vram = new Uint8Array(VRAM_SIZE);
  readonly registers = new Uint8Array(8);
  status = 0;
  /** The 14-bit VRAM address used by the data port. */
  address = 0;
  /** True after the first byte of a two-byte control port write. */
  latched = false;
  latchedValue = 0;
  /** The read-ahead buffer: data port reads return the byte fetched by the previous access. */
  readBuffer = 0;
  /** The finished picture, FRAME_WIDTH x FRAME_HEIGHT colour indexes. */
  readonly framebuffer = new Uint8Array(FRAME_WIDTH * FRAME_HEIGHT);
  /** Called whenever the INT output changes (on the ColecoVision it drives the Z80's NMI). */
  onInterrupt: (active: boolean) => void = () => {};
  private interruptActive = false;
  /** Sprite pixels on the current line, for priority and coincidence. */
  private readonly spriteLine = new Uint8Array(ACTIVE_WIDTH);

  reset(): void {
    this.registers.fill(0);
    this.status = 0;
    this.address = 0;
    this.latched = false;
    this.latchedValue = 0;
    this.readBuffer = 0;
    this.updateInterrupt();
  }

  get interrupt(): boolean {
    return this.interruptActive;
  }

  // --- Ports ------------------------------------------------------------------------

  writeControl(value: number): void {
    if (!this.latched) {
      this.latchedValue = value;
      this.address = (this.address & 0x3f00) | value;
      this.latched = true;
      return;
    }
    this.latched = false;
    if (value & 0x80) {
      this.registers[value & 0x07] = this.latchedValue;
      this.updateInterrupt();
      return;
    }
    this.address = ((value & 0x3f) << 8) | this.latchedValue;
    if ((value & 0x40) === 0) {
      // Setting up a read fetches the first byte straight away.
      this.readBuffer = this.vram[this.address];
      this.address = (this.address + 1) & 0x3fff;
    }
  }

  readStatus(): number {
    const value = this.status;
    this.status &= ~(STATUS_INTERRUPT | STATUS_FIFTH_SPRITE | STATUS_COINCIDENCE);
    this.latched = false;
    this.updateInterrupt();
    return value;
  }

  writeData(value: number): void {
    this.latched = false;
    this.vram[this.address] = value;
    this.readBuffer = value;
    this.address = (this.address + 1) & 0x3fff;
  }

  readData(): number {
    this.latched = false;
    const value = this.readBuffer;
    this.readBuffer = this.vram[this.address];
    this.address = (this.address + 1) & 0x3fff;
    return value;
  }

  private updateInterrupt(): void {
    const active = (this.status & STATUS_INTERRUPT) !== 0 && (this.registers[1] & 0x20) !== 0;
    if (active === this.interruptActive) return;
    this.interruptActive = active;
    this.onInterrupt(active);
  }

  // --- Timing -----------------------------------------------------------------------

  /** The end of the active picture: sets the frame flag (and INT, if enabled) and draws the border rows. */
  startVerticalBlank(): void {
    this.status |= STATUS_INTERRUPT;
    this.updateInterrupt();
    const backdrop = this.backdrop;
    this.framebuffer.fill(backdrop, 0, BORDER_Y * FRAME_WIDTH);
    this.framebuffer.fill(backdrop, (BORDER_Y + ACTIVE_LINES) * FRAME_WIDTH);
  }

  private get backdrop(): number {
    return this.registers[7] & 0x0f;
  }

  // --- Drawing ----------------------------------------------------------------------

  /** Draws active line `line` (0-191) into the framebuffer, and runs the sprite checks for it. */
  renderLine(line: number): void {
    const frame = this.framebuffer;
    const start = (line + BORDER_Y) * FRAME_WIDTH;
    const backdrop = this.backdrop;
    frame.fill(backdrop, start, start + BORDER_X);
    frame.fill(backdrop, start + BORDER_X + ACTIVE_WIDTH, start + FRAME_WIDTH);
    const out = start + BORDER_X;
    const r0 = this.registers[0];
    const r1 = this.registers[1];
    if ((r1 & 0x40) === 0) {
      frame.fill(backdrop, out, out + ACTIVE_WIDTH);
      return;
    }
    if (r1 & 0x10) {
      this.renderText(line, out, backdrop);
      return; // No sprites in Text mode.
    }
    if (r1 & 0x08) this.renderMulticolor(line, out, backdrop);
    else if (r0 & 0x02) this.renderGraphics2(line, out, backdrop);
    else this.renderGraphics1(line, out, backdrop);
    this.renderSprites(line, out);
  }

  /** Eight pixels of a pattern byte in two colours (0 = the backdrop). */
  private drawPattern(out: number, pattern: number, foreground: number, background: number, backdrop: number): void {
    const fg = foreground || backdrop;
    const bg = background || backdrop;
    const frame = this.framebuffer;
    for (let bit = 0; bit < 8; bit++) frame[out + bit] = pattern & (0x80 >> bit) ? fg : bg;
  }

  private renderGraphics1(line: number, out: number, backdrop: number): void {
    const { vram, registers } = this;
    const names = (registers[2] & 0x0f) << 10;
    const colors = registers[3] << 6;
    const patterns = (registers[4] & 0x07) << 11;
    const row = names + (line >> 3) * 32;
    for (let column = 0; column < 32; column++) {
      const name = vram[row + column];
      const color = vram[colors + (name >> 3)];
      this.drawPattern(out + column * 8, vram[patterns + name * 8 + (line & 7)], color >> 4, color & 0x0f, backdrop);
    }
  }

  private renderGraphics2(line: number, out: number, backdrop: number): void {
    const { vram, registers } = this;
    const names = (registers[2] & 0x0f) << 10;
    // R3 and R4 hold a base bit and masks that let a screen third reuse another's tables.
    const colorBase = (registers[3] & 0x80) << 6;
    const colorMask = ((registers[3] & 0x7f) << 6) | 0x3f;
    const patternBase = (registers[4] & 0x04) << 11;
    const patternMask = ((registers[4] & 0x03) << 11) | 0x7ff;
    const row = names + (line >> 3) * 32;
    const third = (line >> 6) << 8;
    for (let column = 0; column < 32; column++) {
      const offset = (((third | vram[row + column]) << 3) | (line & 7)) & 0x1fff;
      const color = vram[colorBase | (offset & colorMask)];
      this.drawPattern(out + column * 8, vram[patternBase | (offset & patternMask)], color >> 4, color & 0x0f, backdrop);
    }
  }

  private renderMulticolor(line: number, out: number, backdrop: number): void {
    const { vram, registers, framebuffer } = this;
    const names = (registers[2] & 0x0f) << 10;
    const patterns = (registers[4] & 0x07) << 11;
    const row = names + (line >> 3) * 32;
    const byteInPattern = ((line >> 3) & 3) * 2 + ((line >> 2) & 1);
    for (let column = 0; column < 32; column++) {
      const colors = vram[patterns + vram[row + column] * 8 + byteInPattern];
      const left = colors >> 4 || backdrop;
      const right = colors & 0x0f || backdrop;
      const x = out + column * 8;
      framebuffer.fill(left, x, x + 4);
      framebuffer.fill(right, x + 4, x + 8);
    }
  }

  /** 40 columns of 6-pixel characters, with 8 pixels of backdrop either side. */
  private renderText(line: number, out: number, backdrop: number): void {
    const { vram, registers, framebuffer } = this;
    const names = (registers[2] & 0x0f) << 10;
    const patterns = (registers[4] & 0x07) << 11;
    const fg = registers[7] >> 4 || backdrop;
    const bg = backdrop;
    framebuffer.fill(bg, out, out + 8);
    framebuffer.fill(bg, out + 248, out + ACTIVE_WIDTH);
    const row = names + (line >> 3) * 40;
    for (let column = 0; column < 40; column++) {
      const pattern = vram[patterns + vram[row + column] * 8 + (line & 7)];
      const x = out + 8 + column * 6;
      for (let bit = 0; bit < 6; bit++) framebuffer[x + bit] = pattern & (0x80 >> bit) ? fg : bg;
    }
  }

  /**
   * Draws the sprites on `line`: lower-numbered sprites win, only four fit on
   * a line (the fifth sets the 5S flag and its number), and any two sprites'
   * set pixels meeting set the coincidence flag.
   */
  private renderSprites(line: number, out: number): void {
    const { vram, registers, framebuffer, spriteLine } = this;
    const attributes = (registers[5] & 0x7f) << 7;
    const patterns = (registers[6] & 0x07) << 11;
    const large = (registers[1] & 0x02) !== 0;
    const magnify = (registers[1] & 0x01) !== 0 ? 1 : 0;
    const size = (large ? 16 : 8) << magnify;
    spriteLine.fill(0);
    let visible = 0;
    let sprite = 0;
    for (; sprite < 32; sprite++) {
      const entry = attributes + sprite * 4;
      const rawY = vram[entry];
      if (rawY === SPRITE_TERMINATOR) break;
      const y = rawY > SPRITE_TERMINATOR ? rawY - 256 : rawY;
      const row = line - (y + 1);
      if (row < 0 || row >= size) continue;
      if (visible === MAX_SPRITES_PER_LINE) {
        if ((this.status & STATUS_FIFTH_SPRITE) === 0) {
          this.status = (this.status & STATUS_INTERRUPT) | (this.status & STATUS_COINCIDENCE) | STATUS_FIFTH_SPRITE | sprite;
        }
        break;
      }
      visible++;
      const color = vram[entry + 3];
      const x = vram[entry + 1] - (color & 0x80 ? 32 : 0);
      const name = large ? vram[entry + 2] & 0xfc : vram[entry + 2];
      const patternRow = row >> magnify;
      const left = vram[patterns + name * 8 + patternRow];
      const bits = large ? (left << 8) | vram[patterns + name * 8 + 16 + patternRow] : left << 8;
      const width = large ? 16 : 8;
      const ink = color & 0x0f;
      for (let px = 0; px < width << magnify; px++) {
        if ((bits & (0x8000 >> (px >> magnify))) === 0) continue;
        const sx = x + px;
        if (sx < 0 || sx >= ACTIVE_WIDTH) continue;
        // Bit 0: some sprite has a pixel here; bit 1: a sprite has coloured it (transparent ones don't hide those below).
        const taken = spriteLine[sx];
        if (taken & 1) this.status |= STATUS_COINCIDENCE;
        if (ink && (taken & 2) === 0) {
          framebuffer[out + sx] = ink;
          spriteLine[sx] = 3;
        } else {
          spriteLine[sx] = taken | 1;
        }
      }
    }
    if ((this.status & STATUS_FIFTH_SPRITE) === 0) this.status = (this.status & 0xe0) | Math.min(sprite, 31);
  }
}
