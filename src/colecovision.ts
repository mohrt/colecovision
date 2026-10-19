import { BIOS_SIZE, ColecoBus } from './bus';
import type { Cartridge } from './cart/cartridge';
import { Z80 } from './cpu/z80';
import { Controllers } from './io/controllers';
import { SuperGameModule } from './sgm';
import { AudioMixer } from './sound/mixer';
import { Sn76489 } from './sound/sn76489';
import { captureState, restoreState, type StateNode } from './state/snapshot';
import { ACTIVE_LINES, Tms9918 } from './vdp/tms9918';

export type TvStandard = 'ntsc' | 'pal';

/** The Z80 runs at the VDP's crystal divided by 3. */
export const CPU_HZ: Record<TvStandard, number> = { ntsc: 3_579_545, pal: 3_546_894 };
export const LINES_PER_FRAME: Record<TvStandard, number> = { ntsc: 262, pal: 313 };
/** A line is 342 VDP pixel clocks, and the CPU clock is two thirds of the pixel clock. */
export const CYCLES_PER_LINE = 228;

/**
 * The whole console: Z80, TMS9918A, SN76489, 1K of RAM, two controllers,
 * the BIOS and cartridge, and the Super Game Module. Runs a scanline at a
 * time; the VDP's interrupt is wired to the Z80's NMI.
 */
export class ColecoVision {
  readonly vdp = new Tms9918();
  readonly psg = new Sn76489();
  readonly sgm = new SuperGameModule();
  readonly controllers = new Controllers();
  readonly bus = new ColecoBus(this.vdp, this.psg, this.controllers, this.sgm);
  readonly cpu = new Z80(this.bus);
  readonly audio = new AudioMixer(this.psg, this.sgm.ay, () => this.sgm.enabled);
  tv: TvStandard = 'ntsc';
  /** The scanline about to run (0 = the first line of the picture). */
  line = 0;
  /** CPU cycles the last line overran by, taken off the next one. */
  overrun = 0;
  /** Called once the picture of a frame is complete (at the start of vertical blank). */
  onFrame: (framebuffer: Uint8Array) => void = () => {};

  constructor() {
    // NMI is edge-triggered: only the VDP's INT going active interrupts.
    this.vdp.onInterrupt = (active) => {
      if (active) this.cpu.nmi();
    };
    this.reset();
  }

  get clockHz(): number {
    return CPU_HZ[this.tv];
  }

  get bios(): Uint8Array | null {
    return this.bus.bios;
  }

  get cartridge(): Cartridge | null {
    return this.bus.cartridge;
  }

  setBios(bios: Uint8Array | null): void {
    if (bios && bios.length !== BIOS_SIZE) throw new Error(`The BIOS must be ${BIOS_SIZE} bytes.`);
    this.bus.bios = bios;
    this.reset();
  }

  /** Changing cartridges means switching off first, as the console's manual insists. */
  insertCartridge(cartridge: Cartridge | null): void {
    this.bus.cartridge = cartridge;
    this.reset();
  }

  setTv(tv: TvStandard): void {
    this.tv = tv;
    this.line = 0;
  }

  /** Power on: everything back to its initial state (RAM cleared). */
  reset(): void {
    this.cpu.reset();
    this.vdp.reset();
    this.psg.reset();
    this.sgm.reset();
    this.controllers.reset();
    this.bus.ram.fill(0);
    this.bus.cartridge?.reset();
    this.line = 0;
    this.overrun = 0;
  }

  /** The console's reset button: restarts the CPU, keeping memory. */
  pressReset(): void {
    this.cpu.reset();
    this.bus.cartridge?.reset();
  }

  /** Runs one scanline: the CPU for its share of cycles, then the VDP draws the line. */
  runLine(): void {
    const budget = CYCLES_PER_LINE - this.overrun;
    let ran = 0;
    while (ran < budget) ran += this.cpu.step();
    this.overrun = ran - budget;
    this.audio.run(ran);
    if (this.line < ACTIVE_LINES) this.vdp.renderLine(this.line);
    if (this.line === ACTIVE_LINES - 1) {
      this.vdp.startVerticalBlank();
      this.onFrame(this.vdp.framebuffer);
    }
    if (++this.line === LINES_PER_FRAME[this.tv]) this.line = 0;
  }

  /** Runs lines until the next frame's picture is complete. */
  runFrame(): void {
    do this.runLine();
    while (this.line !== ACTIVE_LINES);
  }

  /** Everything in the console except the BIOS and cartridge ROM (bank switching state included). */
  saveState(): StateNode {
    return captureState(this);
  }

  /** Restores a saved state; the same kind of cartridge must already be in. */
  loadState(state: StateNode): void {
    restoreState(this, state);
  }
}
