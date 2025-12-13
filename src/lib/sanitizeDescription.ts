export function sanitizeDescription(html: string): string {
  if (!html) return '';

  const escapeHtml = (value: string) =>
    value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  const isDomParserAvailable = typeof DOMParser !== 'undefined';

  if (!isDomParserAvailable) {
    return escapeHtml(html);
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const container = doc.body.firstElementChild as HTMLElement | null;

  if (!container) {
    return '';
  }

  const colorRegex = /^color\s*:\s*#([0-9a-fA-F]{6})\s*;?$/;

  const sanitizeNode = (node: Node, targetParent: HTMLElement) => {
    if (node.nodeType === Node.TEXT_NODE) {
      targetParent.appendChild(doc.createTextNode(node.textContent || ''));
      return;
    }

    if (node.nodeType !== Node.ELEMENT_NODE) {
      return;
    }

    const element = node as HTMLElement;
    const tag = element.tagName.toLowerCase();

    if (tag === 'script' || tag === 'style') {
      return;
    }

    if (tag === 'strong' || tag === 'span') {
      const cleanEl = doc.createElement(tag);

      if (tag === 'span') {
        const style = element.getAttribute('style');
        if (style && colorRegex.test(style.trim())) {
          const match = style.trim().match(colorRegex);
          if (match) {
            cleanEl.setAttribute('style', `color: #${match[1].toLowerCase()}`);
          }
        }
      }

      Array.from(element.childNodes).forEach((child) => sanitizeNode(child, cleanEl));
      targetParent.appendChild(cleanEl);
      return;
    }

    Array.from(element.childNodes).forEach((child) => sanitizeNode(child, targetParent));
  };

  const safeContainer = doc.createElement('div');
  Array.from(container.childNodes).forEach((child) => sanitizeNode(child, safeContainer));

  return safeContainer.innerHTML;
}
