import { describe, expect, it } from 'vitest';
import { Ay8910 } from '../src/sound/ay8910';
import { AudioMixer, CPU_CYCLES_PER_TICK } from '../src/sound/mixer';
import { SN_VOLUMES, Sn76489 } from '../src/sound/sn76489';

/** Ticks between output changes of a channel, over `ticks` ticks. */
function toggleSpacing(tick: () => void, output: () => number, ticks: number): number[] {
  const changes: number[] = [];
  let last = output();
  for (let i = 0; i < ticks; i++) {
    tick();
    if (output() !== last) {
      changes.push(i);
      last = output();
    }
  }
  return changes.slice(1).map((at, i) => at - changes[i]);
}

describe('SN76489', () => {
  it('latches a 10-bit tone period from two writes', () => {
    const psg = new Sn76489();
    psg.write(0x80 | 0x0e); // channel 0, low bits E
    psg.write(0x0f); // high bits 0F
    expect(psg.tones[0]).toBe(0x0fe);
    psg.write(0xa0 | 0x05); // channel 1 low bits only
    expect(psg.tones[1]).toBe(0x005);
  });

  it('toggles a tone every period ticks', () => {
    const psg = new Sn76489();
    psg.write(0x85);
    psg.write(0x00);
    psg.write(0x90); // full volume
    expect(new Set(toggleSpacing(() => psg.tick(), () => psg.outputs[0], 100))).toEqual(new Set([5]));
  });

  it('applies 2 dB attenuation steps, with 15 silent', () => {
    expect(SN_VOLUMES[0]).toBe(1);
    expect(SN_VOLUMES[1]).toBeCloseTo(0.794, 3);
    expect(SN_VOLUMES[15]).toBe(0);
    const psg = new Sn76489();
    psg.write(0x81);
    psg.write(0x00);
    psg.write(0x9f);
    for (let i = 0; i < 10; i++) expect(psg.tick()).toBe(0);
  });

  it('makes a 15-step periodic noise and a longer white noise', () => {
    const sequence = (control: number) => {
      const psg = new Sn76489();
      psg.write(0xe0 | control);
      const bits: number[] = [];
      for (let i = 0; i < 32 * 64; i++) {
        psg.tick();
        if (i % 32 === 31) bits.push(psg.shifter & 1);
      }
      return bits.join('');
    };
    const periodic = sequence(0x00);
    expect(periodic.slice(0, 15)).toBe(periodic.slice(15, 30));
    const white = sequence(0x04);
    expect(white.slice(0, 15)).not.toBe(white.slice(15, 30));
    expect(white).toMatch(/1/);
  });
});

describe('AY-3-8910', () => {
  it('masks registers to their width', () => {
    const ay = new Ay8910();
    ay.select(1);
    ay.write(0xff);
    expect(ay.read()).toBe(0x0f);
    ay.select(6);
    ay.write(0xff);
    expect(ay.read()).toBe(0x1f);
  });

  it('toggles a tone every period ticks when the mixer lets it through', () => {
    const ay = new Ay8910();
    ay.select(0);
    ay.write(3);
    ay.select(7);
    ay.write(0x3e); // tone A on, everything else off
    ay.select(8);
    ay.write(0x0f);
    expect(new Set(toggleSpacing(() => ay.tick(), () => ay.toneOutputs[0], 60))).toEqual(new Set([3]));
    const levels = new Set(Array.from({ length: 12 }, () => ay.tick()));
    expect(levels).toEqual(new Set([0, 1]));
  });

  it('ramps the envelope down once and holds at 0 for shape 0', () => {
    const ay = new Ay8910();
    ay.select(11);
    ay.write(1);
    ay.select(13);
    ay.write(0x00);
    const volumes: number[] = [];
    for (let i = 0; i < 40; i++) {
      ay.tick();
      volumes.push(ay.envelopeVolume);
    }
    expect(volumes.slice(0, 32).filter((_, i) => i % 2 === 1)).toEqual([14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 0]);
    expect(volumes.slice(32).every((v) => v === 0)).toBe(true);
  });

  it('repeats a sawtooth for shape 8 and a triangle for shape 14', () => {
    const run = (shape: number) => {
      const ay = new Ay8910();
      ay.select(11);
      ay.write(1);
      ay.select(13);
      ay.write(shape);
      const volumes: number[] = [];
      for (let i = 0; i < 128; i++) {
        ay.tick();
        if (i % 2 === 1) volumes.push(ay.envelopeVolume);
      }
      return volumes;
    };
    const saw = run(0x08);
    expect(saw.slice(14, 18)).toEqual([0, 15, 14, 13]);
    const triangle = run(0x0e);
    expect(triangle.slice(14, 18)).toEqual([15, 15, 14, 13]);
  });
});

describe('AudioMixer', () => {
  it('produces samples at the output rate, centred on zero', () => {
    const psg = new Sn76489();
    const ay = new Ay8910();
    const mixer = new AudioMixer(psg, ay, () => true);
    mixer.setRates(3_579_545, 48_000);
    psg.write(0x80 | 0x0f);
    psg.write(0x0f);
    psg.write(0x90);
    mixer.run(3_579_545 / 10);
    const samples = mixer.takeSamples();
    expect(samples.length).toBeGreaterThan(4790);
    expect(samples.length).toBeLessThan(4810);
    const mean = samples.slice(2400).reduce((sum, s) => sum + s, 0) / (samples.length - 2400);
    expect(Math.abs(mean)).toBeLessThan(0.02);
    expect(Math.max(...samples)).toBeGreaterThan(0.05);
    expect(mixer.takeSamples().length).toBe(0);
    expect(CPU_CYCLES_PER_TICK).toBe(16);
  });
});
