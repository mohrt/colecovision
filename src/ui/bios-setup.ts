import { KNOWN_BIOS_CRC, checkBios, crc32 } from '../bios/bios-store';
import { BIOS_SIZE } from '../bus';
import { isZip, readZip } from '../cart/zip';

export interface BiosSetupOptions {
  /** Opened from a running console: offers Back (resolves null), and nothing changes until the user confirms. */
  whileRunning?: boolean;
  /** The BIOS the console has now, if any. */
  current?: Uint8Array | null;
}

interface ChosenBios {
  bios: Uint8Array;
  name: string;
  warning: string | null;
}

/** The BIOS in a file, or in a zip (such as MAME's coleco.zip, whose BIOS file has no extension). */
async function biosFrom(file: File): Promise<ChosenBios> {
  const data = new Uint8Array(await file.arrayBuffer());
  if (!isZip(data)) return { ...checkBios(data), name: file.name };
  const candidates = readZip(data).filter((entry) => entry.size === BIOS_SIZE && !entry.name.startsWith('__MACOSX/'));
  if (candidates.length === 0) throw new Error(`${file.name} has no 8K (8,192-byte) file in it, so no BIOS.`);
  const images = await Promise.all(candidates.map(async (entry) => ({ name: entry.name, data: await entry.read() })));
  const best = images.find((image) => crc32(image.data) === KNOWN_BIOS_CRC) ?? images[0];
  return { ...checkBios(best.data), name: `${best.name} from ${file.name}` };
}

function describe(bios: Uint8Array): string {
  return crc32(bios) === KNOWN_BIOS_CRC ? 'the usual Coleco BIOS' : 'not the usual Coleco BIOS';
}

/**
 * Shows the BIOS setup panel in place of the screen. On first use it resolves as
 * soon as the usual Coleco BIOS is given (any other 8K BIOS needs a confirming
 * click); opened from a running console, the user confirms or goes back (null).
 */
export function askForBios(root: HTMLElement, options: BiosSetupOptions = {}): Promise<ChosenBios | null> {
  const query = <T extends HTMLElement>(selector: string) => {
    const element = root.querySelector<T>(selector);
    if (!element) throw new Error(`BIOS setup is missing ${selector}`);
    return element;
  };
  const fileInput = query<HTMLInputElement>('input[type="file"]');
  const row = query<HTMLElement>('.bios-rom');
  const status = query<HTMLElement>('.bios-rom-status');
  const useButton = query<HTMLButtonElement>('[data-action="use-bios"]');
  const backButton = query<HTMLButtonElement>('[data-action="back"]');
  const message = query<HTMLElement>('.bios-setup-message');
  const listeners = new AbortController();
  const { whileRunning = false, current = null } = options;
  let chosen: ChosenBios | null = null;

  query<HTMLElement>('h1').textContent = whileRunning ? 'Change the ColecoVision BIOS' : 'First, load the ColecoVision BIOS';
  backButton.hidden = !whileRunning;
  message.textContent = '';

  const render = () => {
    if (chosen) {
      row.dataset.state = chosen.warning ? 'warning' : 'loaded';
      status.textContent = `Loaded: ${chosen.name}${chosen.warning ? ` (${describe(chosen.bios)})` : ''}`;
    } else if (current) {
      row.dataset.state = 'loaded';
      status.textContent = `In the console now: ${describe(current)}. Choose a file to replace it.`;
    } else {
      row.dataset.state = 'missing';
      status.textContent = 'Not loaded yet';
    }
    useButton.disabled = chosen === null;
    useButton.textContent = whileRunning ? 'Use this BIOS' : chosen?.warning ? 'Switch on anyway' : 'Switch the console on';
  };

  return new Promise((resolve) => {
    const close = (result: ChosenBios | null) => {
      listeners.abort();
      root.hidden = true;
      document.body.classList.remove('needs-bios');
      resolve(result);
    };

    const addFile = async (file: File) => {
      try {
        chosen = await biosFrom(file);
        message.textContent = chosen.warning ?? '';
        render();
        if (!whileRunning && !chosen.warning) close(chosen);
      } catch (error) {
        message.textContent = error instanceof Error ? error.message : String(error);
      }
    };

    const signal = listeners.signal;
    query<HTMLButtonElement>('[data-action="choose-bios-file"]').addEventListener('click', () => fileInput.click(), {
      signal,
    });
    fileInput.addEventListener(
      'change',
      () => {
        const file = fileInput.files?.[0];
        fileInput.value = '';
        if (file) void addFile(file);
      },
      { signal },
    );
    useButton.addEventListener('click', () => chosen && close(chosen), { signal });
    backButton.addEventListener('click', () => close(null), { signal });

    // Captured and stopped so the cartridge panel's page-wide drop handling doesn't also see the BIOS.
    const dragOptions = { signal, capture: true };
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    let depth = 0;
    window.addEventListener(
      'dragenter',
      (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        depth++;
        root.classList.add('drag-over');
      },
      dragOptions,
    );
    window.addEventListener(
      'dragover',
      (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
      },
      dragOptions,
    );
    window.addEventListener(
      'dragleave',
      (event) => {
        if (!hasFiles(event)) return;
        event.stopImmediatePropagation();
        depth = Math.max(0, depth - 1);
        if (depth === 0) root.classList.remove('drag-over');
      },
      dragOptions,
    );
    window.addEventListener(
      'drop',
      (event) => {
        if (!hasFiles(event)) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        depth = 0;
        root.classList.remove('drag-over');
        const file = event.dataTransfer?.files[0];
        if (file) void addFile(file);
      },
      dragOptions,
    );

    document.body.classList.add('needs-bios');
    root.hidden = false;
    render();
    root.scrollIntoView({ block: 'start' });
  });
}
