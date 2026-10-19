# ColecoVision in the browser

A ColecoVision emulator written from scratch in TypeScript: a Z80 with every documented and undocumented instruction (it passes ZEXDOC and ZEXALL), the TMS9918A video chip drawn one scanline at a time, the SN76489 sound chip, both controllers with their keypads, MegaCart bank switching and Opcode's Super Game Module. Drop a `.col`, `.rom` or `.bin` file (or a `.zip` containing one) onto the page to play it.

## The BIOS

Every ColecoVision game uses routines in the console's 8K BIOS ROM. It is still under copyright, so it is never committed to this repository.

- **On the site**: the page uses `roms/system/coleco.rom` when the site provides it. Locally, put the file in `public/roms/system/coleco.rom` (that folder is ignored by git). The deployed site gets it from the `SITE_ASSETS` secret (see Deploying).
- **Your own**: without a site copy, the page asks for a BIOS, and you choose or drop your own image. It is kept in the browser's storage, so you only do this once, and it takes precedence over the site's copy; **Forget** removes it.

A BIOS other than the usual Coleco one (CRC-32 `3AA93EF3`) is accepted with a warning.

No game files are included either. Use images of cartridges you own, or homebrews whose authors allow it.

## Controls

- **Keyboard** (player 1): arrow keys for the joystick, Space or Z for the left button, X or C for the right one. The number keys are the keypad, with `-` for `*` and `=` for `#` (the numpad works too). P or Pause pauses.
- **Gamepads** work as soon as you press one of their buttons: the first is player 1, the second player 2. The D-pad or left stick is the joystick, A is the left button and B the right. X and Y are `*` and `#`, Start is 1, Back/Select is 2, and the shoulder buttons are 3 and 4.
- **On-screen keypad**: all twelve keys and both side buttons, for player 1 or player 2. It works with a mouse or by touch.

## Console

The toolbar has pause, the console's reset button, power cycle, full screen and the TV standard (NTSC or PAL). **Super Game Module** plugs the module in or out; it is on by default, as games that don't use it never notice it. Save states keep the whole console, cartridge included, in the browser. They can be exported and imported as `.colstate` files.

Cartridges up to 32K are standard. Bigger ones are taken to be MegaCarts, where the last 16K bank is fixed at 8000 and reading FFC0-FFFF selects the bank at C000. The cartridge panel can override this.

## Development

```sh
npm install
npm run dev             # http://localhost:5173
npm test
npm run fetch:zex       # optional: the ZEXDOC and ZEXALL Z80 exercisers
ZEX=1 npm test          # also runs them (a minute or two each)
COLECO_BIOS=/path/to/coleco.rom npm test   # boots a BIOS (public/roms/system/coleco.rom is used if present)
```

## Deploying

`.github/workflows/pages.yml` tests and builds the site and deploys it to GitHub Pages on every push to `main` (Pages source: "GitHub Actions").

Files that must not be in git reach the site through the `SITE_ASSETS` repository secret: a base64 gzipped tarball that the workflow unpacks into `public/` before building. To send the BIOS:

```sh
tar czf - -C public roms/system/coleco.rom | base64 | gh secret set SITE_ASSETS --repo mohrt/colecovision
```
