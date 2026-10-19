import { ColecoVision, CYCLES_PER_LINE, type TvStandard } from './colecovision';
import type { Screen } from './render/screen';

/** Longest gap we catch up on, so a backgrounded tab doesn't run a burst of frames. */
const MAX_CATCH_UP_MS = 100;

/** Glues the machine to the screen and the speakers, and runs it in step with real time. */
export class Emulator {
  readonly machine = new ColecoVision();
  private cycleDebt = 0;
  private audioRate = 48000;

  constructor(private readonly screen: Screen) {
    this.machine.onFrame = (frame) => screen.capture(frame);
    this.updateAudioRate();
  }

  /** The console needs its BIOS before it can do anything. */
  get canRun(): boolean {
    return this.machine.bios !== null;
  }

  setAudioRate(rate: number): void {
    this.audioRate = rate;
    this.updateAudioRate();
  }

  setTv(tv: TvStandard): void {
    if (tv === this.machine.tv) return;
    this.machine.setTv(tv);
    this.updateAudioRate();
  }

  /** Follows the TV standard of a restored save state. */
  restored(): void {
    this.updateAudioRate();
    this.resetTiming();
  }

  private updateAudioRate(): void {
    this.machine.audio.setRates(this.machine.clockHz, this.audioRate);
  }

  /** Forgets time owed, e.g. after a pause, so the machine doesn't race to catch up. */
  resetTiming(): void {
    this.cycleDebt = 0;
  }

  /** Runs the machine for `elapsedMs` of real time (no more than MAX_CATCH_UP_MS). */
  run(elapsedMs: number): void {
    if (!this.canRun) {
      this.screen.showSnow();
      return;
    }
    this.cycleDebt += (Math.min(elapsedMs, MAX_CATCH_UP_MS) * this.machine.clockHz) / 1000;
    while (this.cycleDebt >= CYCLES_PER_LINE) {
      this.machine.runLine();
      this.cycleDebt -= CYCLES_PER_LINE;
    }
  }

  takeAudioSamples(): Float32Array {
    return this.machine.audio.takeSamples();
  }
}
