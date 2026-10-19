/** Output level for each 4-bit attenuation: 2 dB per step, 15 = off. */
export const SN_VOLUMES: readonly number[] = Array.from({ length: 16 }, (_, i) => (i === 15 ? 0 : 10 ** (-i / 10)));

/** The TI chips' 15-bit noise shift register, reset to its top bit. */
const NOISE_SEED = 0x4000;

/**
 * The Texas Instruments SN76489AN sound chip: three square-wave tone
 * channels and a noise channel, each with 4-bit attenuation. `tick` advances
 * it one step of its internal clock (the input clock divided by 16).
 */
export class Sn76489 {
  /** 10-bit tone periods for channels 0-2. */
  readonly tones = new Uint16Array(3);
  /** Attenuation of channels 0-3 (15 = silent). */
  readonly volumes = new Uint8Array([15, 15, 15, 15]);
  readonly counters = new Uint16Array(4);
  /** Square-wave output of each channel (the noise channel's is the shift register's bit 0). */
  readonly outputs = new Uint8Array(4);
  /** Noise control: bit 2 = white noise, bits 1-0 = rate (3 = follow tone channel 2). */
  noise = 0;
  shifter = NOISE_SEED;
  /** The register selected by the last latch byte: channel * 2 + (1 for attenuation). */
  latch = 0;
  /** The noise channel's own square wave, which clocks the shift register. */
  private noiseToggle = 0;

  reset(): void {
    this.tones.fill(0);
    this.volumes.fill(15);
    this.counters.fill(0);
    this.outputs.fill(0);
    this.noise = 0;
    this.shifter = NOISE_SEED;
    this.latch = 0;
    this.noiseToggle = 0;
  }

  write(value: number): void {
    if (value & 0x80) {
      this.latch = (value >> 4) & 0x07;
      this.writeLatched(value & 0x0f, true);
    } else {
      this.writeLatched(value, false);
    }
  }

  private writeLatched(data: number, low: boolean): void {
    const channel = this.latch >> 1;
    if (this.latch & 1) {
      this.volumes[channel] = data & 0x0f;
    } else if (channel === 3) {
      this.noise = data & 0x07;
      this.shifter = NOISE_SEED;
    } else if (low) {
      this.tones[channel] = (this.tones[channel] & 0x3f0) | (data & 0x0f);
    } else {
      this.tones[channel] = (this.tones[channel] & 0x00f) | ((data & 0x3f) << 4);
    }
  }

  /** Advances one internal clock (input / 16) and returns the mixed level, 0 to 4. */
  tick(): number {
    const { counters, outputs, tones } = this;
    for (let channel = 0; channel < 3; channel++) {
      if (counters[channel] > 0) counters[channel]--;
      if (counters[channel] === 0) {
        // A period of 0 counts as 1024 on the TI parts.
        counters[channel] = tones[channel] || 0x400;
        outputs[channel] ^= 1;
      }
    }
    if (counters[3] > 0) counters[3]--;
    if (counters[3] === 0) {
      const rate = this.noise & 3;
      counters[3] = rate === 3 ? tones[2] || 0x400 : 0x10 << rate;
      this.noiseToggle ^= 1;
      if (this.noiseToggle) this.shiftNoise();
    }
    outputs[3] = this.shifter & 1;
    const { volumes } = this;
    return (
      (outputs[0] ? SN_VOLUMES[volumes[0]] : 0) +
      (outputs[1] ? SN_VOLUMES[volumes[1]] : 0) +
      (outputs[2] ? SN_VOLUMES[volumes[2]] : 0) +
      (outputs[3] ? SN_VOLUMES[volumes[3]] : 0)
    );
  }

  private shiftNoise(): void {
    const s = this.shifter;
    // White noise feeds back bits 0 and 1; periodic noise just rotates bit 0 round.
    const feedback = this.noise & 0x04 ? (s ^ (s >> 1)) & 1 : s & 1;
    this.shifter = (s >> 1) | (feedback << 14);
  }
}
