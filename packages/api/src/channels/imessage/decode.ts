const NSSTRING_MARKER = Buffer.from('NSString');
const LENGTH_PREFIX = 0x2b;
const LENGTH_U16 = 0x81;
const LENGTH_U32 = 0x82;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\ufffc]/g;

/**
 * Modern macOS stores most message text in the `attributedBody` typedstream
 * blob instead of the `text` column. Heuristic decode: the body string sits
 * after the NSString marker, length-prefixed at the `+` byte, with 0x81/0x82
 * escaping two- and four-byte little-endian lengths.
 */
export function decodeAttributedBody(hex: string | null | undefined): string | null {
  if (!hex) {
    return null;
  }
  const buf = Buffer.from(hex, 'hex');
  const marker = buf.indexOf(NSSTRING_MARKER);
  if (marker === -1) {
    return null;
  }
  let offset = buf.indexOf(LENGTH_PREFIX, marker);
  if (offset === -1) {
    return null;
  }
  offset += 1;
  let length = buf[offset];
  offset += 1;
  if (length === LENGTH_U16) {
    length = buf.readUInt16LE(offset);
    offset += 2;
  } else if (length === LENGTH_U32) {
    length = buf.readUInt32LE(offset);
    offset += 4;
  }
  const text = buf.subarray(offset, offset + length).toString('utf8');
  return text.replace(CONTROL_CHARS, '').trim() || null;
}

/** Message text from either storage column, or null when there is none. */
export function messageText(
  text: string | null | undefined,
  bodyHex: string | null | undefined,
): string | null {
  const plain = text?.trim();
  if (plain) {
    return plain;
  }
  return decodeAttributedBody(bodyHex);
}
