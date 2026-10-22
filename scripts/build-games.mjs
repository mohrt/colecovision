// Builds the free games listed in games-catalog.json into public/games/, and
// writes the index.json the page reads. Most are built from source: the C
// games for LibCV need the SDCC compiler (`brew install sdcc`,
// `apt-get install sdcc`), and the CVBasic games need a C compiler and make to
// build CVBasic and its assembler. The rest are released as cartridge images,
// downloaded and checked against their checksums. Games whose tools are
// missing are left out. The games are kept out of git.
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
const { libcv, source, cvbasic, downloads } = catalog;

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

/** A .tar.gz as a plain tar. Some servers mark .tar.gz files as gzip-encoded, so fetch may already have unzipped it. */
async function downloadTar(url) {
  const archive = await download(url);
  return archive[0] === 0x1f && archive[1] === 0x8b ? gunzipSync(archive) : archive;
}

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const run = (command, args, cwd) => execFileSync(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
const sourceFile = (name) => `https://raw.githubusercontent.com/${source.repo}/${source.commit}/${source.dir}/${name}`;
const skip = (title, error) => console.warn(`Skipping ${title}: ${error.stderr?.toString().trim() || error.message}`);

/** Writes the license next to a game, and returns the link for index.json. */
async function writeLicense(file, text) {
  const name = `${file}.license.txt`;
  await writeFile(join(outDir, name), text);
  return `games/${name}`;
}

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

function isInstalled(command) {
  try {
    run(command, ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function buildLibcv(work) {
  const archive = await downloadTar(libcv.url);
  if (sha256(archive) !== libcv.tarSha256) throw new Error('the LibCV download has changed (checksum mismatch)');
  await writeFile(join(work, 'libcv.tar'), archive);
  run('tar', ['xf', 'libcv.tar'], work);
  const dir = join(work, 'colecovision lib');
  for (const sub of ['bin', 'include', 'libcv/bin', 'libcvu/bin']) await mkdir(join(dir, sub), { recursive: true });
  run('make', [], dir);
  return dir;
}

/** The C games from 8bitworkshop, linked with LibCV. */
async function buildLibcvGames(work) {
  if (!isInstalled('sdcc')) {
    console.warn('SDCC is not installed, so the LibCV games were not built (brew install sdcc, or apt-get install sdcc).');
    return [];
  }
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
  const games = [];
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
      games.push({
        title: game.title,
        file: game.file,
        credit: `${game.credit}; ${libcv.credit} (${libcv.license})`,
        license: game.license,
        licenseUrl: await writeLicense(game.file, license),
        sourceUrl: `https://github.com/${source.repo}/blob/${source.commit}/${source.dir}/${game.sources[0]}`,
        hint: game.hint,
      });
      console.log(`Built public/games/${game.file}`);
    } catch (error) {
      skip(game.title, error);
    }
  }
  return games;
}

/** Unpacks a GitHub repository at a commit into `work`, and returns its folder. */
async function unpackGithub(work, { repo, commit }) {
  const name = repo.split('/')[1];
  await writeFile(join(work, `${name}.tar`), await downloadTar(`https://codeload.github.com/${repo}/tar.gz/${commit}`));
  run('tar', ['xf', `${name}.tar`], work);
  return join(work, `${name}-${commit}`);
}

/** The BASIC games from CVBasic's examples, compiled with CVBasic and assembled with Gasm80. */
async function buildCvbasicGames(work) {
  if (!isInstalled('cc') || !isInstalled('make')) {
    console.warn('A C compiler and make are needed to build CVBasic, so the CVBasic games were not built.');
    return [];
  }
  const compiler = await unpackGithub(work, cvbasic.compiler);
  const assembler = await unpackGithub(work, cvbasic.assembler);
  run('make', [], compiler);
  run('make', [], assembler);
  const license = await readFile(join(compiler, cvbasic.licenseFile), 'utf8');
  const games = [];
  for (const game of cvbasic.games) {
    try {
      const program = join(work, `${game.file}.asm`);
      run(join(compiler, 'cvbasic'), [game.source, program], compiler);
      run(join(assembler, 'gasm80'), [program, '-o', join(outDir, game.file)], work);
      games.push({
        title: game.title,
        file: game.file,
        credit: game.credit,
        license: game.license,
        licenseUrl: await writeLicense(game.file, license),
        sourceUrl: `https://github.com/${cvbasic.compiler.repo}/blob/${cvbasic.compiler.commit}/${game.source}`,
        hint: game.hint,
      });
      console.log(`Built public/games/${game.file}`);
    } catch (error) {
      skip(game.title, error);
    }
  }
  return games;
}

/** Games released as cartridge images, either on their own or in a .tar.gz with their source code. */
async function fetchDownloadedGames(work) {
  const games = [];
  for (const game of downloads) {
    try {
      const bytes = game.archiveMember ? await downloadTar(game.url) : await download(game.url);
      if (sha256(bytes) !== game.sha256) throw new Error(`${game.url} has changed (checksum mismatch)`);
      let image = bytes;
      let licenseUrl = game.licenseUrl;
      if (game.archiveMember) {
        const dir = await mkdtemp(join(work, 'download-'));
        await writeFile(join(dir, 'game.tar'), bytes);
        run('tar', ['xf', 'game.tar', game.archiveMember, game.licenseMember], dir);
        image = await readFile(join(dir, game.archiveMember));
        licenseUrl = await writeLicense(
          game.file,
          `${game.title} by ${game.credit}, under the ${game.license}.
Its source code is in ${game.url}

${await readFile(join(dir, game.licenseMember), 'utf8')}`,
        );
      }
      await writeFile(join(outDir, game.file), image);
      games.push({ title: game.title, file: game.file, credit: game.credit, license: game.license, licenseUrl, hint: game.hint });
      console.log(`Downloaded public/games/${game.file}`);
    } catch (error) {
      skip(game.title, error);
    }
  }
  return games;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  const work = await mkdtemp(join(tmpdir(), 'colecovision-games-'));
  const games = [];
  try {
    games.push(...(await buildLibcvGames(work)), ...(await buildCvbasicGames(work)), ...(await fetchDownloadedGames(work)));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
  games.sort((a, b) => a.title.localeCompare(b.title));
  await writeFile(join(outDir, 'index.json'), `${JSON.stringify({ games }, null, 2)}\n`);
  const total = catalog.games.length + cvbasic.games.length + downloads.length;
  console.log(`Listed ${games.length} of ${total} games in public/games/index.json`);
}

await main();
