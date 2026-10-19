import { Ay8910 } from './sound/ay8910';

export const SGM_PORTS = {
  ayAddress: 0x50,
  ayWrite: 0x51,
  ayRead: 0x52,
  /** Bit 0 set: RAM at 2000-7FFF (replacing the console's 1K). */
  upperRam: 0x53,
  /** Bit 1 clear: RAM at 0000-1FFF instead of the BIOS. */
  lowerRam: 0x7f,
} as const;

/**
 * The Opcode Super Game Module: 32K of RAM that can be paged over the BIOS
 * and the console's own RAM, and an AY-3-8910 sound chip.
 */
export class SuperGameModule {
  /** Whether the module is plugged in. */
  enabled = true;
  /** Indexed by CPU address: 0000-1FFF is the lower 8K, 2000-7FFF the upper 24K. */
  readonly ram = new Uint8Array(0x8000);
  readonly ay = new Ay8910();
  private upperPaged = false;
  private lowerPaged = false;

  get upperRam(): boolean {
    return this.enabled && this.upperPaged;
  }

  get lowerRam(): boolean {
    return this.enabled && this.lowerPaged;
  }

  reset(): void {
    this.upperPaged = this.lowerPaged = false;
    this.ram.fill(0);
    this.ay.reset();
  }

  /** Handles a write to one of its ports; returns false for other ports. */
  output(port: number, value: number): boolean {
    if (!this.enabled) return false;
    switch (port) {
      case SGM_PORTS.ayAddress:
        this.ay.select(value);
        return true;
      case SGM_PORTS.ayWrite:
        this.ay.write(value);
        return true;
      case SGM_PORTS.upperRam:
        this.upperPaged = (value & 0x01) !== 0;
        return true;
      case SGM_PORTS.lowerRam:
        this.lowerPaged = (value & 0x02) === 0;
        return true;
      default:
        return false;
    }
  }

  /** Reads one of its ports, or null for other ports. */
  input(port: number): number | null {
    return this.enabled && port === SGM_PORTS.ayRead ? this.ay.read() : null;
  }
}
