// Builds the free games listed in games-catalog.json from their source code
// into public/games/, and writes the index.json the page reads. They are
// written in C for LibCV, so this needs the SDCC compiler (`brew install sdcc`,
// `apt-get install sdcc`); without it no games are built. The games are kept
// out of git.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outDir = join(scriptDir, '..', 'public', 'games');
const catalog = JSON.parse(await readFile(join(scriptDir, 'games-catalog.json'), 'utf8'));
const { libcv, source } = catalog;

const CART_START = 0x8000;
const CART_SIZE = 0x8000;
const CFLAGS = ['-mz80', '-c', '--std-sdcc99', '-DCV_CV'];
const LDFLAGS = ['-mz80', '--no-std-crt0', '--code-loc', '0x8100', '--data-loc', '0x7000'];

/** The games copy their font from the BIOS starting at character 0, but only
 * 8bitworkshop's own BIOS has blank bytes below the space character; the
 * Coleco BIOS has code there. Blank characters 0-31 after the copy. */
const FONT_COPY = /^(\s*cvu_memtovmemcpy\(PATTERN, \(void \*\)\(font_bitmap_0 - '0'\*8\), [^;]+;)$/m;
const BLANK_CONTROL_CHARACTERS = '$1\n  cvu_vmemset(PATTERN, 0, 0x20*8);';

async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: HTTP ${response.status} ${response.statusText}`);
  return Buffer.from(await response.arrayBuffer());
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
const sourceFile = (name) => `https://raw.githubusercontent.com/${source.repo}/${source.commit}/${source.dir}/${name}`;

/** A cartridge image (8000-FFFF) from the linker's Intel HEX output. */
function hexToCartridge(hex) {
  const image = new Uint8Array(CART_SIZE).fill(0xff);
  let end = 0;
  for (const line of hex.split(/\r?\n/)) {
    if (!line.startsWith(':')) continue;
    const bytes = Buffer.from(line.slice(1), 'hex');
    const [count, high, low, type] = bytes;
    if (type !== 0) continue;
    const offset = ((high << 8) | low) - CART_START;
    if (offset < 0 || offset + count > CART_SIZE) throw new Error('the program does not fit the cartridge space');
    image.set(bytes.subarray(4, 4 + count), offset);
    end = Math.max(end, offset + count);
  }
  return image.subarray(0, end);
}

function hasSdcc() {
  try {
    run('sdcc', ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function buildLibcv(work) {
  // The server marks the .tar.gz as gzip-encoded, so fetch may already have unzipped it.
  let archive = await download(libcv.url);
  if (archive[0] === 0x1f && archive[1] === 0x8b) archive = gunzipSync(archive);
  if (sha256(archive) !== libcv.tarSha256) throw new Error('the LibCV download has changed (checksum mismatch)');
  await writeFile(join(work, 'libcv.tar'), archive);
  run('tar', ['xf', 'libcv.tar'], work);
  const dir = join(work, 'colecovision lib');
  for (const sub of ['bin', 'include', 'libcv/bin', 'libcvu/bin']) await mkdir(join(dir, sub), { recursive: true });
  run('make', [], dir);
  return dir;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const games = [];
  if (!hasSdcc()) {
    console.warn('SDCC is not installed, so no free games were built (brew install sdcc, or apt-get install sdcc).');
  } else {
    const work = await mkdtemp(join(tmpdir(), 'colecovision-games-'));
    try {
      const lib = await buildLibcv(work);
      const license = `${(await download(`https://raw.githubusercontent.com/${source.repo}/${source.commit}/${source.licenseFile}`)).toString()}
---------------------------------------------------------------------------
The game is linked with ${libcv.credit}, under the ${libcv.license}
(source: ${libcv.sourceUrl}):

${await readFile(join(lib, 'LGPL-2.1'), 'utf8')}`;
      const names = new Set([...source.headers, ...catalog.games.flatMap((game) => game.sources)]);
      for (const name of names) {
        const text = (await download(sourceFile(name))).toString();
        await writeFile(join(work, name), text.replace(FONT_COPY, BLANK_CONTROL_CHARACTERS));
      }
      for (const game of catalog.games) {
        try {
          const objects = [];
          for (const name of game.sources) {
            const object = `${game.file}-${name.replace(/\.c$/, '.rel')}`;
            run('sdcc', [...CFLAGS, `-I${join(lib, 'include')}`, name, '-o', object], work);
            objects.push(object);
          }
          const hex = `${game.file}.ihx`;
          const libs = ['libcvu.lib', 'libcv.lib', 'crt0.rel'].map((file) => join(lib, 'bin', file));
          run('sdcc', [...LDFLAGS, ...libs, ...objects, '-o', hex], work);
          await writeFile(join(outDir, game.file), hexToCartridge(await readFile(join(work, hex), 'utf8')));
          const licenseName = `${game.file}.license.txt`;
          await writeFile(join(outDir, licenseName), license);
          games.push({
            title: game.title,
            file: game.file,
            credit: `${game.credit}; ${libcv.credit} (${libcv.license})`,
            license: game.license,
            licenseUrl: `games/${licenseName}`,
            sourceUrl: `https://github.com/${source.repo}/blob/${source.commit}/${source.dir}/${game.sources[0]}`,
            hint: game.hint,
          });
          console.log(`Built public/games/${game.file}`);
        } catch (error) {
          console.warn(`Skipping ${game.title}: ${error.stderr?.toString().trim() || error.message}`);
        }
      }
    } finally {
      await rm(work, { recursive: true, force: true });
    }
  }
  games.sort((a, b) => a.title.localeCompare(b.title));
  await writeFile(join(outDir, 'index.json'), `${JSON.stringify({ games }, null, 2)}\n`);
  console.log(`Listed ${games.length} of ${catalog.games.length} games in public/games/index.json`);
}

await main();
