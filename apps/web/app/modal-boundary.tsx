"use client";

import { useEffect, useId, useRef, type HTMLAttributes } from "react";

/** Supplies consistent keyboard behavior to the existing dialog layouts. */
export function ModalBoundary({ onClose, children, ...props }: HTMLAttributes<HTMLDivElement> & { onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  useEffect(() => {
    const surface = root.current;
    if (!surface) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Some legacy forms already carry dialog semantics. Keep a single dialog.
    const dialog = surface.querySelector<HTMLElement>('[role="dialog"]') ?? surface;
    if (dialog !== surface) surface.removeAttribute('role');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');
    dialog.tabIndex = -1;
    const heading = dialog.querySelector<HTMLElement>('h1,h2,h3');
    if (!dialog.hasAttribute('aria-label') && !dialog.hasAttribute('aria-labelledby') && heading) {
      if (!heading.id) heading.id = titleId;
      dialog.setAttribute('aria-labelledby', heading.id);
    }
    const visible = (element: HTMLElement) => element.getClientRects().length > 0 && getComputedStyle(element).visibility !== 'hidden' && !element.closest('[inert]');
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('a[href],button,input,select,textarea,[tabindex]')).filter(element => visible(element) && element.tabIndex >= 0 && !element.matches(':disabled'));
    const topmost = () => Array.from(document.querySelectorAll<HTMLElement>('.modal-backdrop')).filter(visible).at(-1) === surface;
    const dismiss = () => Array.from(dialog.querySelectorAll<HTMLButtonElement>('button')).find(button => /^(close|cancel|keep editing)$/i.test(button.textContent?.trim() ?? '') && visible(button));
    (dismiss() && !dismiss()!.disabled ? dismiss()! : controls()[0] ?? dialog).focus();
    const keydown = (event: KeyboardEvent) => {
      if (!topmost()) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        const button = dismiss();
        if (button) { if (!button.disabled) button.click(); } else close.current();
      }
      if (event.key === 'Tab') {
        const items = controls(), first = items[0], last = items.at(-1);
        if (!first || !last) { event.preventDefault(); dialog.focus(); return; }
        if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
      }
    };
    const focusin = (event: FocusEvent) => { if (topmost() && !dialog.contains(event.target as Node)) (controls()[0] ?? dialog).focus(); };
    document.addEventListener('keydown', keydown, true);
    document.addEventListener('focusin', focusin);
    return () => {
      document.removeEventListener('keydown', keydown, true);
      document.removeEventListener('focusin', focusin);
      if (previous?.isConnected) previous.focus();
    };
  }, [titleId]);
  return <div {...props} ref={root}>{children}</div>;
}
