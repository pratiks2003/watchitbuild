/**
 * Turns lightweight markup into render-safe segments, so templates never need innerHTML.
 * Supported: **bold** and `code`. Everything else is plain text.
 * @param {string} text
 * @returns {{key: string, text: string, bold: boolean, code: boolean, plain: boolean}[]}
 */
export function toSegments(text) {
  const out = [];
  const pattern = /\*\*(.+?)\*\*|`(.+?)`/g;
  let last = 0;
  let match;
  const push = (value, bold, code) => {
    if (value) {
      out.push({
        key: `s${out.length}`,
        text: value,
        bold,
        code,
        plain: !bold && !code
      });
    }
  };
  while ((match = pattern.exec(text ?? "")) !== null) {
    push(text.slice(last, match.index), false, false);
    push(match[1] ?? match[2], Boolean(match[1]), Boolean(match[2]));
    last = pattern.lastIndex;
  }
  push((text ?? "").slice(last), false, false);
  return out;
}

/** Strips the lightweight markup, for places that only take plain text. */
export function toPlain(text) {
  return (text ?? "").replace(/\*\*(.+?)\*\*/g, "$1").replace(/`(.+?)`/g, "$1");
}
