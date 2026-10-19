/** Output level for each 4-bit amplitude (roughly 3 dB per step). */
export const AY_VOLUMES: readonly number[] = [
  0, 0.0106, 0.015, 0.0222, 0.0361, 0.0533, 0.0789, 0.1124, 0.1529, 0.2268, 0.3376, 0.4777, 0.5932, 0.7406, 0.8681, 1,
];

/** Bits of each register that exist; the rest read back as 0. */
const REGISTER_MASKS = [0xff, 0x0f, 0xff, 0x0f, 0xff, 0x0f, 0x1f, 0xff, 0x1f, 0x1f, 0x1f, 0xff, 0xff, 0x0f, 0xff, 0xff];
const ENVELOPE_SHAPE = 13;

/**
 * The General Instrument AY-3-8910 (on the Super Game Module): three tone
 * channels, a noise generator and an envelope generator, mixed per channel by
 * register 7. `tick` advances it by 8 cycles of its input clock, the rate at
 * which its square waves can change.
 */
export class Ay8910 {
  readonly registers = new Uint8Array(16);
  selected = 0;
  readonly toneCounters = new Uint16Array(3);
  readonly toneOutputs = new Uint8Array(3);
  noiseCounter = 0;
  /** 17-bit shift register; bit 0 is the noise output. */
  noiseShifter = 1;
  envelopeCounter = 0;
  envelopeStep = 0x0f;
  envelopeAttack = 0;
  envelopeHold = false;
  envelopeAlternate = false;
  envelopeHolding = false;
  envelopeVolume = 0;
  /** Noise and envelope run at half the tone rate. */
  private prescale = 0;

  reset(): void {
    this.registers.fill(0);
    this.selected = 0;
    this.toneCounters.fill(0);
    this.toneOutputs.fill(0);
    this.noiseCounter = 0;
    this.noiseShifter = 1;
    this.envelopeCounter = 0;
    this.prescale = 0;
    this.startEnvelope(0);
  }

  select(register: number): void {
    this.selected = register & 0x0f;
  }

  read(): number {
    return this.registers[this.selected];
  }

  write(value: number): void {
    const register = this.selected;
    this.registers[register] = value & REGISTER_MASKS[register];
    if (register === ENVELOPE_SHAPE) this.startEnvelope(value & 0x0f);
  }

  private startEnvelope(shape: number): void {
    this.envelopeAttack = shape & 0x04 ? 0x0f : 0;
    if ((shape & 0x08) === 0) {
      // Shapes 0-7 run once, then hold at 0.
      this.envelopeHold = true;
      this.envelopeAlternate = this.envelopeAttack !== 0;
    } else {
      this.envelopeHold = (shape & 0x01) !== 0;
      this.envelopeAlternate = (shape & 0x02) !== 0;
    }
    this.envelopeStep = 0x0f;
    this.envelopeHolding = false;
    this.envelopeCounter = 0;
    this.envelopeVolume = this.envelopeStep ^ this.envelopeAttack;
  }

  private period(channel: number): number {
    return this.registers[channel * 2] | (this.registers[channel * 2 + 1] << 8) || 1;
  }

  /** Advances 8 input clocks and returns the mixed level, 0 to 3. */
  tick(): number {
    const { toneCounters, toneOutputs, registers } = this;
    for (let channel = 0; channel < 3; channel++) {
      if (++toneCounters[channel] >= this.period(channel)) {
        toneCounters[channel] = 0;
        toneOutputs[channel] ^= 1;
      }
    }
    this.prescale ^= 1;
    if (this.prescale) {
      if (++this.noiseCounter >= (registers[6] || 1)) {
        this.noiseCounter = 0;
        const s = this.noiseShifter;
        this.noiseShifter = (s >> 1) | (((s ^ (s >> 3)) & 1) << 16);
      }
      if (++this.envelopeCounter >= (registers[11] | (registers[12] << 8) || 1)) {
        this.envelopeCounter = 0;
        this.stepEnvelope();
      }
    }
    const mixer = registers[7];
    const noise = this.noiseShifter & 1;
    let level = 0;
    for (let channel = 0; channel < 3; channel++) {
      const tone = toneOutputs[channel] | ((mixer >> channel) & 1);
      const noiseOn = noise | ((mixer >> (channel + 3)) & 1);
      if (!(tone & noiseOn)) continue;
      const amplitude = registers[8 + channel];
      level += AY_VOLUMES[amplitude & 0x10 ? this.envelopeVolume : amplitude & 0x0f];
    }
    return level;
  }

  private stepEnvelope(): void {
    if (this.envelopeHolding) return;
    this.envelopeStep--;
    if (this.envelopeStep < 0) {
      if (this.envelopeHold) {
        if (this.envelopeAlternate) this.envelopeAttack ^= 0x0f;
        this.envelopeHolding = true;
        this.envelopeStep = 0;
      } else {
        if (this.envelopeAlternate) this.envelopeAttack ^= 0x0f;
        this.envelopeStep = 0x0f;
      }
    }
    this.envelopeVolume = this.envelopeStep ^ this.envelopeAttack;
  }
}
