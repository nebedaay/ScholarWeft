/**
 * Jest setup: the Obsidian DOM helpers.
 *
 * `createEl` / `createDiv` / `createSpan` / `createFragment` are globals Obsidian
 * injects at runtime — they are not exports of the `obsidian` module, so a test
 * that exercises code using them must provide them. Defining them once here
 * keeps individual suites from each stubbing their own (and from breaking when a
 * module starts using an Obsidian helper, which the directory review asks for in
 * place of `document.createElement`).
 *
 * Deliberately non-destructive: anything a suite has already defined wins, and
 * each helper is only added if absent.
 */

type DomInfo = {
  cls?: string | string[];
  text?: string;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  parent?: Node;
  value?: string;
  type?: string;
  prepend?: boolean;
  placeholder?: string;
  href?: string;
};

function applyInfo(el: HTMLElement, o?: DomInfo | string): void {
  if (o == null) return;
  if (typeof o === 'string') {
    el.textContent = o;
    return;
  }
  if (o.cls) {
    const classes = Array.isArray(o.cls) ? o.cls : o.cls.split(/\s+/);
    el.classList.add(...classes.filter(Boolean));
  }
  if (o.text != null) el.textContent = o.text;
  if (o.title != null) el.title = o.title;
  if (o.attr) {
    for (const [k, v] of Object.entries(o.attr)) {
      if (v != null) el.setAttribute(k, String(v));
    }
  }
  if (o.type != null) el.setAttribute('type', o.type);
  if (o.placeholder != null) el.setAttribute('placeholder', o.placeholder);
  if (o.href != null) el.setAttribute('href', o.href);
  if (o.value != null && 'value' in el) (el as HTMLInputElement).value = o.value;
}

const g = globalThis as unknown as Record<string, unknown>;

if (!g.createEl) {
  g.createEl = (tag: string, o?: DomInfo | string): HTMLElement => {
    const el = document.createElement(tag);
    applyInfo(el, o);
    return el;
  };
}
if (!g.createDiv) {
  g.createDiv = (o?: DomInfo | string): HTMLDivElement => {
    const el = document.createElement('div');
    applyInfo(el, o);
    return el as HTMLDivElement;
  };
}
if (!g.createSpan) {
  g.createSpan = (o?: DomInfo | string): HTMLSpanElement => {
    const el = document.createElement('span');
    applyInfo(el, o);
    return el as HTMLSpanElement;
  };
}
if (!g.createFragment) {
  g.createFragment = (cb?: (frag: DocumentFragment) => void): DocumentFragment => {
    const frag = document.createDocumentFragment();
    cb?.(frag);
    return frag;
  };
}

// The element-side helpers Obsidian adds to `Element.prototype`. Added only when
// a suite has not already provided them.
const proto = HTMLElement.prototype as unknown as Record<string, unknown>;

if (!proto.createEl) {
  proto.createEl = function (tag: string, o?: DomInfo | string, cb?: (el: HTMLElement) => void) {
    const el = document.createElement(tag);
    applyInfo(el, o);
    this.appendChild(el);
    cb?.(el);
    return el;
  };
}
if (!proto.createDiv) {
  proto.createDiv = function (o?: DomInfo | string, cb?: (el: HTMLElement) => void) {
    return (this as HTMLElement).createEl('div', o, cb);
  };
}
if (!proto.createSpan) {
  proto.createSpan = function (o?: DomInfo | string, cb?: (el: HTMLElement) => void) {
    return (this as HTMLElement).createEl('span', o, cb);
  };
}
if (!proto.empty) {
  proto.empty = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
  };
}
if (!proto.detach) {
  proto.detach = function () {
    this.parentNode?.removeChild(this);
  };
}
if (!proto.addClass) {
  proto.addClass = function (...classes: string[]) {
    this.classList.add(...classes);
  };
}
if (!proto.removeClass) {
  proto.removeClass = function (...classes: string[]) {
    this.classList.remove(...classes);
  };
}
if (!proto.toggleClass) {
  proto.toggleClass = function (cls: string, on: boolean) {
    this.classList.toggle(cls, on);
  };
}
if (!proto.hasClass) {
  proto.hasClass = function (cls: string) {
    return this.classList.contains(cls);
  };
}
if (!proto.setText) {
  proto.setText = function (text: string) {
    this.textContent = text;
  };
}
if (!proto.appendText) {
  proto.appendText = function (text: string) {
    this.appendChild(document.createTextNode(text));
  };
}
if (!proto.setAttr) {
  proto.setAttr = function (name: string, value: string | number | boolean | null) {
    if (value == null) this.removeAttribute(name);
    else this.setAttribute(name, String(value));
  };
}

// Obsidian augments `Document` with the window it belongs to, which is how the
// `doc.win.createEl(...)` form resolves. jsdom documents get the global window.
if (!(Document.prototype as unknown as { win?: Window }).win) {
  Object.defineProperty(Document.prototype, 'win', {
    configurable: true,
    get() {
      return this.defaultView ?? window;
    },
  });
}
