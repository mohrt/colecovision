/**
 * A stand-in BIOS for tests (the real one is copyrighted): turns on the
 * display and the frame interrupt, selects MegaCart bank 2, then loops
 * counting in RAM and sending the count to VRAM and the sound chip. Its NMI
 * handler acknowledges the VDP.
 */
export function testBios(): Uint8Array {
  const bios = new Uint8Array(0x2000);
  bios.set([
    0x31, 0x00, 0x64, // LD SP,6400h
    0x3e, 0xe0, 0xd3, 0xbf, 0x3e, 0x81, 0xd3, 0xbf, // R1 = E0h: display and interrupt on
    0xaf, 0xd3, 0xbf, 0x3e, 0x40, 0xd3, 0xbf, // VRAM write address 0000
    0x3a, 0xc2, 0xff, // LD A,(FFC2h): MegaCart bank 2
    0x2a, 0x00, 0x60, // loop: LD HL,(6000h)
    0x23, // INC HL
    0x22, 0x00, 0x60, // LD (6000h),HL
    0x7d, // LD A,L
    0xd3, 0xbe, // OUT (BEh),A
    0xd3, 0xff, // OUT (FFh),A
    0x18, 0xf2, // JR loop
  ]);
  bios.set([0xdb, 0xbf, 0xed, 0x45], 0x66); // IN A,(BFh); RETN
  return bios;
}
