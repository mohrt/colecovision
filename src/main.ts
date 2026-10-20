import { AudioOutput } from './audio/audio-output';
import { BiosStore, KNOWN_BIOS_CRC, checkBios, crc32 } from './bios/bios-store';
import { BIOS_SIZE } from './bus';
import { askForBios } from './ui/bios-setup';
import type { CartridgeKind } from './cart/cartridge';
import { createCartridge, detectKind, hasHeader, headerWarning } from './cart/detect';
import { STATE_EXTENSION, filesFrom, readMedia, titleFromFileName } from './cart/load';
import { Emulator } from './emulator';
import { fetchGame, loadGameManifest, type BundledGame } from './games';
import { GamepadManager, padName, readGamepad } from './io/gamepad-input';
import { KeyboardInput } from './io/keyboard-input';
import { SCREEN_ASPECT, Screen } from './render/screen';
import { SaveStates, decodeSession, encodeSession, type SaveStateRecord, type Session } from './storage/save-states';
import { memoryStores, openBrowserStores, type KeyValueStore } from './storage/store';
import { CartPanel } from './ui/cart-panel';
import { downloadFile } from './ui/download';
import { OnScreenKeypad } from './ui/keypad';
import { Settings } from './ui/settings';
import { attachToolbar } from './ui/toolbar';

/** Form fields whose values are remembered between visits. */
const REMEMBERED_SETTINGS = ['tv', 'sgm', 'show-keypad', 'keypad-player', 'sound', 'volume'];

/** Longest gap the loop catches up on, so a backgrounded tab doesn't run a burst of frames. */
const MAX_FRAME_MS = 100;
const PLAYERS = 2;

interface CurrentCartridge {
  image: Uint8Array;
  fileName: string;
  title: string;
  detectedKind: CartridgeKind;
  kind: CartridgeKind;
}

function requireElement<T extends HTMLElement>(selector: string): T {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Page is missing ${selector}`);
  return element;
}

const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'colecovision';

/** An 8K image without a cartridge header that is the Coleco BIOS, or is named like one. */
function looksLikeBios(image: Uint8Array, name: string): boolean {
  if (image.length !== BIOS_SIZE || hasHeader(image)) return false;
  return crc32(image) === KNOWN_BIOS_CRC || /bios|coleco/i.test(name);
}

async function main(): Promise<void> {
  const canvas = requireElement<HTMLCanvasElement>('#screen');
  const status = requireElement<HTMLParagraphElement>('#status');
  const screenFrame = requireElement<HTMLElement>('.screen-frame');
  const biosSetup = requireElement<HTMLElement>('#bios-setup');

  try {
    document.documentElement.style.setProperty('--screen-aspect', SCREEN_ASPECT.toFixed(4));
    const settings = new Settings();
    settings.bind(document, REMEMBERED_SETTINGS);

    const screen = new Screen(canvas);
    const emulator = new Emulator(screen);
    const machine = emulator.machine;
    const audio = await AudioOutput.create().catch((error: unknown) => {
      console.warn('Audio is unavailable:', error);
      return null;
    });
    if (audio) emulator.setAudioRate(audio.sampleRate);

    const stores = await openBrowserStores().catch((error: unknown) => {
      console.warn('Browser storage is unavailable; the BIOS and save states will last until the page is closed.', error);
      requireElement<HTMLElement>('.bios-storage-note').textContent =
        "This browser isn't letting the page store files, so the BIOS will be forgotten when you close it.";
      return memoryStores();
    });
    const biosStore = new BiosStore(stores.bios as KeyValueStore<Uint8Array>);
    const saveStates = new SaveStates(stores.saveStates as KeyValueStore<SaveStateRecord>);

    let current: CurrentCartridge | null = null;
    let paused = false;
    /** While the BIOS setup is shown in place of the screen. */
    let choosingBios = false;
    const focusScreen = () => canvas.focus();

    const updateStatus = () => {
      const what = !machine.bios ? 'No BIOS' : current ? current.title : 'No cartridge';
      status.textContent = `${what} · ${machine.tv.toUpperCase()} · Arrows, Space/X and the number keys play`;
    };

    // --- BIOS ------------------------------------------------------------------------
    // The user's own BIOS, kept in the browser; the site never serves one.
    const showBiosState = () => {
      const bios = machine.bios;
      const note = bios && crc32(bios) !== KNOWN_BIOS_CRC ? '(not the usual Coleco BIOS)' : '';
      cartPanel.showBios(bios !== null, note);
      updateCanSave();
      updateStatus();
    };
    const useBios = async (bytes: Uint8Array) => {
      const { bios, warning } = checkBios(bytes);
      machine.setBios(bios);
      await biosStore.save(bios);
      showBiosState();
      if (warning) cartPanel.showMessage(warning, true);
      audio?.flush();
    };
    /** Shows the BIOS setup in place of the (paused) screen until the user gives a BIOS or goes back. */
    const openBiosSetup = async (whileRunning: boolean) => {
      if (choosingBios) return;
      choosingBios = true;
      audio?.flush();
      if (!whileRunning) status.textContent = 'Load the BIOS above to switch the console on.';
      const chosen = await askForBios(biosSetup, { whileRunning, current: machine.bios });
      choosingBios = false;
      emulator.resetTiming();
      if (chosen) await useBios(chosen.bios);
      updateStatus();
      focusScreen();
    };

    // --- Cartridges ------------------------------------------------------------------
    const insert = (kind: CartridgeKind) => {
      if (!current) return;
      machine.insertCartridge(createCartridge(current.image, kind));
      current.kind = kind;
      emulator.resetTiming();
      audio?.flush();
    };

    const insertImage = (image: Uint8Array, fileName: string, title = titleFromFileName(fileName.split(' from ')[0])) => {
      const detectedKind = detectKind(image);
      current = { image, fileName, title, detectedKind, kind: detectedKind };
      insert(detectedKind);
      cartPanel.showCartridge(current.title, fileName);
      cartPanel.setKind(detectedKind, 'auto');
      const warning = headerWarning(image, detectedKind);
      if (warning) cartPanel.showMessage(warning, true);
      updateCanSave();
      updateStatus();
    };

    const eject = () => {
      machine.insertCartridge(null);
      current = null;
      cartPanel.showEmpty();
      updateCanSave();
      updateStatus();
    };

    // --- Save states -----------------------------------------------------------------
    const currentSession = (): Session => {
      if (!current) throw new Error('Insert a cartridge first.');
      return {
        machine: machine.saveState(),
        rom: current.image,
        romName: current.fileName,
        title: current.title,
        kind: current.kind,
      };
    };
    const restoreSession = async (session: Session) => {
      if (!machine.bios) throw new Error('Load the BIOS first.');
      const detectedKind = detectKind(session.rom);
      current = { image: session.rom, fileName: session.romName, title: session.title, detectedKind, kind: session.kind };
      machine.insertCartridge(createCartridge(session.rom, session.kind));
      machine.loadState(session.machine);
      emulator.restored();
      toolbar.showTv(machine.tv);
      toolbar.showSgm(machine.sgm.enabled);
      cartPanel.showCartridge(session.title, session.romName);
      cartPanel.setKind(detectedKind, session.kind === detectedKind ? 'auto' : session.kind);
      updateCanSave();
      audio?.flush();
      updateStatus();
    };
    const updateCanSave = () => toolbar.setCanSave(current !== null && machine.bios !== null);

    // --- Panels ----------------------------------------------------------------------
    const cartPanel = new CartPanel(requireElement('#cart-panel'), {
      onFile: async (file) => {
        const files = await filesFrom(file);
        const fromZip = files[0] !== file;
        const chosen = files[0];
        if (fromZip) cartPanel.setZipFiles(files, chosen.name);
        else if (cartPanel.zipContents.includes(file)) cartPanel.setZipFiles(cartPanel.zipContents, file.name);
        else cartPanel.setZipFiles([], null);
        const media = await readMedia(chosen);
        if (media.kind === 'state') {
          await restoreSession(await decodeSession(media.bytes));
          toolbar.showMessage('Save state loaded');
          return;
        }
        if (looksLikeBios(media.image, chosen.name)) {
          await useBios(media.image);
          return;
        }
        if (!machine.bios) throw new Error('The console needs its BIOS before it can play a cartridge.');
        const game = bundledGames.find((entry) => entry.file === chosen.name);
        insertImage(media.image, fromZip ? `${chosen.name} from ${file.name}` : chosen.name, game?.title);
      },
      onGame: (index) => fetchGame(import.meta.env.BASE_URL, bundledGames[index]),
      onBiosFile: async (file) => {
        const files = await filesFrom(file);
        await useBios(new Uint8Array(await files[0].arrayBuffer()));
      },
      onForgetBios: async () => {
        await biosStore.forget();
        machine.setBios(null);
        showBiosState();
        void openBiosSetup(false);
      },
      onEject: eject,
      onKind: (choice) => {
        if (!current) return;
        try {
          insert(choice === 'auto' ? current.detectedKind : choice);
          cartPanel.showMessage('');
        } catch (error) {
          cartPanel.showMessage(error instanceof Error ? error.message : String(error));
        }
      },
      focusScreen,
    });

    let bundledGames: BundledGame[] = [];
    void loadGameManifest(import.meta.env.BASE_URL).then((games) => {
      bundledGames = games;
      const href = (link?: string) => (link?.startsWith('games/') ? `${import.meta.env.BASE_URL}${link}` : link);
      cartPanel.setGames(games.map((game) => ({ ...game, licenseHref: href(game.licenseUrl), sourceHref: href(game.sourceUrl) })));
    });

    const refreshStates = async () => toolbar.setStates(await saveStates.list());
    const toolbar = attachToolbar(requireElement('#toolbar'), {
      onPause: (pause) => {
        paused = pause;
        screenFrame.classList.toggle('paused', pause);
        emulator.resetTiming();
        audio?.flush();
      },
      onReset: () => machine.pressReset(),
      onPowerCycle: () => {
        machine.reset();
        audio?.flush();
      },
      onFullscreen: () => {
        if (document.fullscreenElement) {
          void document.exitFullscreen();
          return;
        }
        void screenFrame.requestFullscreen().then(focusScreen);
      },
      onTv: (tv) => {
        emulator.setTv(tv);
        updateStatus();
      },
      onSgm: (enabled) => {
        if (machine.sgm.enabled === enabled) return;
        machine.sgm.enabled = enabled;
        machine.reset();
        audio?.flush();
      },
      onSaveState: async () => {
        const session = currentSession();
        await saveStates.add(session.title, session);
        await refreshStates();
        toolbar.showMessage('State saved');
      },
      onLoadState: async (id) => {
        const session = await saveStates.load(id);
        if (!session) throw new Error('That save state no longer exists.');
        await restoreSession(session);
        toolbar.showMessage('State loaded');
      },
      onDeleteState: async (id) => {
        await saveStates.delete(id);
        await refreshStates();
      },
      onExportState: async () => {
        const session = currentSession();
        downloadFile(await encodeSession(session), `${slug(session.title)}${STATE_EXTENSION}`);
      },
      onImportState: async (file) => {
        await restoreSession(await decodeSession(new Uint8Array(await file.arrayBuffer())));
        toolbar.showMessage('Save state loaded');
      },
      focusScreen,
    });
    await refreshStates();

    // --- Inputs ----------------------------------------------------------------------
    const [player1, player2] = machine.controllers.inputs;
    new KeyboardInput(player1, { onPause: () => toolbar.setPaused(!toolbar.paused) }).attach(window);
    const gamepads = new GamepadManager();
    gamepads.attach(window);
    const gamepadStatus = requireElement<HTMLElement>('.gamepad-status');

    const keypadRoot = requireElement<HTMLElement>('#keypad');
    const keypad = new OnScreenKeypad(keypadRoot, player1, focusScreen);
    const showKeypad = requireElement<HTMLInputElement>('input[name="show-keypad"]');
    const keypadPlayer = requireElement<HTMLSelectElement>('select[name="keypad-player"]');
    const applyKeypad = () => {
      keypadRoot.hidden = !showKeypad.checked;
      keypad.setController(keypadPlayer.value === '1' ? player2 : player1);
    };
    showKeypad.addEventListener('change', applyKeypad);
    keypadPlayer.addEventListener('change', applyKeypad);
    applyKeypad();

    const sound = requireElement<HTMLInputElement>('input[name="sound"]');
    const volume = requireElement<HTMLInputElement>('input[name="volume"]');
    const soundHint = requireElement<HTMLElement>('.sound-hint');
    const applySound = () => {
      audio?.setEnabled(sound.checked);
      audio?.setVolume(Number(volume.value));
    };
    sound.addEventListener('change', applySound);
    volume.addEventListener('input', applySound);
    applySound();
    if (!audio) {
      sound.disabled = volume.disabled = true;
      soundHint.textContent = 'Sound is not supported in this browser';
      soundHint.hidden = false;
    } else if (!audio.running) {
      soundHint.hidden = false;
      audio.resumeOnGesture(window, () => (soundHint.hidden = true));
    }

    // --- Main loop -----------------------------------------------------------------
    let lastPadNames = '';
    const pollGamepads = () => {
      const pads = gamepads.connected();
      for (let player = 0; player < PLAYERS; player++) {
        const pad = pads[player];
        const input = machine.controllers.inputs[player];
        if (pad) input.set('gamepad', readGamepad(pad));
        else input.clear('gamepad');
      }
      const names = pads
        .slice(0, PLAYERS)
        .map((pad, player) => `Player ${player + 1}: ${padName(pad)}`)
        .join(' · ');
      if (names !== lastPadNames) {
        lastPadNames = names;
        gamepadStatus.textContent = names;
      }
    };

    let last = performance.now();
    const frame = (now: number) => {
      const elapsed = Math.min(now - last, MAX_FRAME_MS);
      last = now;
      pollGamepads();
      if (!paused && !choosingBios) {
        emulator.run(elapsed);
        audio?.play(emulator.takeAudioSamples());
      }
      screen.present();
      requestAnimationFrame(frame);
    };

    requireElement<HTMLButtonElement>('#toolbar [data-action="change-bios"]').addEventListener('click', () => {
      void openBiosSetup(true);
    });

    const storedBios = await biosStore.load().catch(() => undefined);
    if (storedBios) {
      try {
        machine.setBios(checkBios(storedBios).bios);
      } catch {
        await biosStore.forget();
      }
    }
    showBiosState();
    cartPanel.showEmpty();
    focusScreen();
    requestAnimationFrame(frame);
    if (!machine.bios) await openBiosSetup(false);
  } catch (error) {
    status.textContent = error instanceof Error ? error.message : String(error);
    throw error;
  }
}

void main();
