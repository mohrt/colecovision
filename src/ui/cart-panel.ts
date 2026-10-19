import { CARTRIDGE_KIND_LABELS, type CartridgeKind } from '../cart/cartridge';

export interface CartPanelCallbacks {
  /** A file was dropped or chosen (a cartridge image, a zip, a save state, or the BIOS). */
  onFile(file: File): Promise<void>;
  /** A file chosen with the BIOS button. */
  onBiosFile(file: File): Promise<void>;
  onForgetBios(): Promise<void>;
  onEject(): void;
  /** 'auto' for the detected kind. */
  onKind(kind: CartridgeKind | 'auto'): void;
  focusScreen(): void;
}

function requireChild<T extends Element>(root: Element, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (!element) throw new Error(`Cartridge panel is missing ${selector}`);
  return element;
}

/** The cartridge slot and the BIOS: drop or choose files, and override the cartridge kind. */
export class CartPanel {
  private readonly fileInput: HTMLInputElement;
  private readonly biosInput: HTMLInputElement;
  private readonly message: HTMLElement;
  private readonly kind: HTMLSelectElement;
  private readonly zipFiles: HTMLElement;
  private readonly zipButtons: HTMLElement;
  private zipChoices: File[] = [];

  constructor(
    private readonly root: HTMLElement,
    private readonly callbacks: CartPanelCallbacks,
  ) {
    this.fileInput = requireChild(root, 'input[name="cart-file"]');
    this.biosInput = requireChild(root, 'input[name="bios-file"]');
    this.message = requireChild(root, '.cart-message');
    this.kind = requireChild(root, 'select[name="kind"]');
    this.zipFiles = requireChild(root, '.zip-files');
    this.zipButtons = requireChild(root, '.zip-buttons');

    root.querySelectorAll<HTMLButtonElement>('[data-action="choose"]').forEach((button) =>
      button.addEventListener('click', () => this.fileInput.click()),
    );
    root.querySelectorAll<HTMLButtonElement>('[data-action="choose-bios"]').forEach((button) =>
      button.addEventListener('click', () => this.biosInput.click()),
    );
    this.fileInput.addEventListener('change', () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = '';
      if (file) this.run(() => this.callbacks.onFile(file));
    });
    this.biosInput.addEventListener('change', () => {
      const file = this.biosInput.files?.[0];
      this.biosInput.value = '';
      if (file) this.run(() => this.callbacks.onBiosFile(file));
    });
    requireChild<HTMLButtonElement>(root, '[data-action="forget-bios"]').addEventListener('click', () => {
      if (confirm('Forget the BIOS? You will need to give it again to play.')) this.run(() => this.callbacks.onForgetBios());
    });
    requireChild<HTMLButtonElement>(root, '[data-action="eject"]').addEventListener('click', () => {
      this.callbacks.onEject();
      this.callbacks.focusScreen();
    });
    this.kind.addEventListener('change', () => {
      this.callbacks.onKind(this.kind.value === 'auto' ? 'auto' : (this.kind.value as CartridgeKind));
      this.callbacks.focusScreen();
    });
    this.attachDragAndDrop();
  }

  /** Files can be dropped anywhere on the page. */
  private attachDragAndDrop(): void {
    let depth = 0;
    const hasFiles = (event: DragEvent) => event.dataTransfer?.types.includes('Files') ?? false;
    document.addEventListener('dragenter', (event) => {
      if (!hasFiles(event)) return;
      depth++;
      this.root.classList.add('drag-over');
    });
    document.addEventListener('dragleave', () => {
      depth = Math.max(0, depth - 1);
      if (depth === 0) this.root.classList.remove('drag-over');
    });
    document.addEventListener('dragover', (event) => {
      if (hasFiles(event)) event.preventDefault();
    });
    document.addEventListener('drop', (event) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth = 0;
      this.root.classList.remove('drag-over');
      const file = event.dataTransfer?.files[0];
      if (file) this.run(() => this.callbacks.onFile(file));
    });
  }

  private run(action: () => Promise<void>): void {
    this.showMessage('');
    action()
      .catch((error: unknown) => this.showMessage(error instanceof Error ? error.message : String(error)))
      .finally(() => this.callbacks.focusScreen());
  }

  showMessage(text: string, isWarning = false): void {
    this.message.textContent = text;
    this.message.classList.toggle('warning', isWarning);
  }

  /** Shows whether the BIOS is in, a note about it, and whether it is the user's own (which they can forget). */
  showBios(loaded: boolean, note = '', ownBios = loaded): void {
    this.root.dataset.bios = loaded ? 'loaded' : 'missing';
    requireChild(this.root, '.bios-note').textContent = note;
    requireChild<HTMLButtonElement>(this.root, '[data-action="forget-bios"]').hidden = !ownBios;
  }

  showCartridge(title: string, fileLabel: string): void {
    this.root.dataset.state = 'loaded';
    requireChild(this.root, '.cart-name').textContent = title;
    requireChild(this.root, '.cart-file').textContent = fileLabel === title ? '' : `(${fileLabel})`;
  }

  showEmpty(): void {
    this.root.dataset.state = 'empty';
    this.setZipFiles([], null);
  }

  /** Fills the cartridge kind menu: Auto (with what was detected), then each kind. */
  setKind(detected: CartridgeKind, chosen: CartridgeKind | 'auto'): void {
    const auto = document.createElement('option');
    auto.value = 'auto';
    auto.textContent = `Auto (${CARTRIDGE_KIND_LABELS[detected]})`;
    this.kind.replaceChildren(
      auto,
      ...(Object.keys(CARTRIDGE_KIND_LABELS) as CartridgeKind[]).map((kind) => {
        const option = document.createElement('option');
        option.value = kind;
        option.textContent = CARTRIDGE_KIND_LABELS[kind];
        return option;
      }),
    );
    this.kind.value = chosen;
  }

  /** Buttons for the other cartridge images in a zip. */
  setZipFiles(files: File[], current: string | null): void {
    this.zipChoices = files;
    this.zipFiles.hidden = files.length < 2;
    this.zipButtons.replaceChildren(
      ...files.map((file) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = file.name;
        button.classList.toggle('current', file.name === current);
        button.addEventListener('click', () => this.run(() => this.callbacks.onFile(file)));
        return button;
      }),
    );
  }

  get zipContents(): File[] {
    return this.zipChoices;
  }
}
