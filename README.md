# ColecoVision in the browser

**Play it at [mohrt.github.io/colecovision](https://mohrt.github.io/colecovision/)**

A ColecoVision emulator written from scratch in TypeScript: a Z80 with every documented and undocumented instruction (it passes ZEXDOC and ZEXALL), the TMS9918A video chip drawn one scanline at a time, the SN76489 sound chip, both controllers with their keypads, MegaCart bank switching and Opcode's Super Game Module. Drop a `.col`, `.rom` or `.bin` file (or a `.zip` containing one) onto the page to play it.

## The BIOS

Every ColecoVision game uses routines in the console's 8K BIOS ROM. It is still under copyright, so it is not included. If the page asks for it, choose or drop your own image (often called `coleco.rom`). It is kept in the browser's storage, so you only do this once; **Forget** removes it. A BIOS other than the usual Coleco one (CRC-32 `3AA93EF3`) is accepted with a warning.

No commercial games are included either. Use images of cartridges you own, or homebrews whose authors allow it.

## Free games

`npm run build:games` builds three small games from their source code into `public/games/`, where they appear in a "Free games" picker: **Climber**, **Shoot** and **Siege**, by Steven Hugg from the [8bitworkshop](https://github.com/sehugg/8bitworkshop) examples (GNU GPL v3), linked with Philipp Klaus Krause's [LibCV](http://www.colecovision.eu/ColecoVision/development/libcv.shtml) 0.28 (GNU LGPL v2.1). It needs the [SDCC](https://sdcc.sourceforge.net/) compiler (`brew install sdcc`, or `apt-get install sdcc`). `scripts/games-catalog.json` pins the sources (an 8bitworkshop commit and LibCV's checksum).

The games copy their font from the BIOS starting at character 0, which only works with 8bitworkshop's own BIOS; with the Coleco BIOS, characters 0-31 would show garbage. The build blanks those characters after the copy, and that is its only change to the sources.

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
npm run build:games     # optional: the free games into public/games/ (needs SDCC)
npm run dev             # http://localhost:5173
npm test
npm run fetch:zex       # optional: the ZEXDOC and ZEXALL Z80 exercisers
ZEX=1 npm test          # also runs them (a minute or two each)
COLECO_BIOS=/path/to/coleco.rom npm test   # also boots your BIOS and plays the free games and the cartridges in roms/
```

## Deploying

`.github/workflows/pages.yml` builds the free games, tests and builds the site, and deploys it to GitHub Pages on every push to `main` (Pages source: "GitHub Actions").
