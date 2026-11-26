import qrcode from 'qrcode-generator';
import { h } from './dom';

/** A scalable SVG QR code. The library output contains only shapes built from our own URL. */
export function qrElement(text: string): HTMLElement {
  const qr = qrcode(0, 'M');
  qr.addData(text);
  qr.make();
  const box = h('div', { class: 'qr', role: 'img', 'aria-label': 'QR code to join the game' });
  box.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  return box;
}
