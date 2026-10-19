import { keyBit, type ControllerInput, type KeypadKey } from '../io/controllers';

const LAYOUT: KeypadKey[] = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#'];
const SOURCE = 'screen-keypad';

/**
 * A clickable (and touchable) controller keypad with the two side buttons,
 * for the keys a game asks for. It presses keys on one player's controller,
 * chosen with `setController`.
 */
export class OnScreenKeypad {
  private readonly held = new Set<KeypadKey | 'left' | 'right'>();
  private controller: ControllerInput;

  constructor(
    root: HTMLElement,
    controller: ControllerInput,
    private readonly focusScreen: () => void,
  ) {
    this.controller = controller;
    const keys = root.querySelector<HTMLElement>('.keypad-keys');
    if (!keys) throw new Error('Keypad is missing .keypad-keys');
    keys.replaceChildren(...LAYOUT.map((key) => this.button(key, key)));
    const sides = root.querySelector<HTMLElement>('.keypad-sides');
    sides?.replaceChildren(this.button('left', 'Left button'), this.button('right', 'Right button'));
  }

  /** Moves the keypad to another player's controller. */
  setController(controller: ControllerInput): void {
    this.controller.clear(SOURCE);
    this.controller = controller;
    this.update();
  }

  private button(control: KeypadKey | 'left' | 'right', label: string): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.dataset.key = control;
    const set = (down: boolean) => {
      if (this.held.has(control) === down) return;
      if (down) this.held.add(control);
      else this.held.delete(control);
      button.classList.toggle('active', down);
      this.update();
    };
    button.addEventListener('pointerdown', (event) => {
      button.setPointerCapture(event.pointerId);
      event.preventDefault();
      set(true);
    });
    const release = () => {
      set(false);
      this.focusScreen();
    };
    button.addEventListener('pointerup', release);
    button.addEventListener('pointercancel', release);
    button.addEventListener('lostpointercapture', () => set(false));
    return button;
  }

  private update(): void {
    let keys = 0;
    for (const control of this.held) if (control !== 'left' && control !== 'right') keys |= keyBit(control);
    this.controller.set(SOURCE, { keys, leftFire: this.held.has('left'), rightFire: this.held.has('right') });
  }
}
