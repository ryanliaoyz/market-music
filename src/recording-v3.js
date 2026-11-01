import { RENDERER, EVENT_KITS, EVENT_PARTS, V3_HASH_LENGTH, validateEventScore } from "./event-score.js";

const PREFIX = "#recording=v3.";
export function encodeV3(clip) {
  validateEventScore(clip);
  const bytes = new Uint8Array(8 + clip.frames.reduce((size, frame) => size + 8 + frame.events.length * 6, 0));
  const view = new DataView(bytes.buffer);
  bytes[0] = 1; bytes[1] = 0; // BTC-USD, rack-v3
  view.setUint32(2, clip.durationMs); view.setUint16(6, clip.frames.length);
  let at = 8;
  for (const frame of clip.frames) {
    view.setUint32(at, frame.offsetMs); bytes[at + 4] = EVENT_KITS.indexOf(frame.presetId);
    view.setInt16(at + 5, frame.change); bytes[at + 7] = frame.events.length; at += 8;
    for (const event of frame.events) {
      bytes[at] = EVENT_PARTS.indexOf(event.part); bytes[at + 1] = event.note ?? 255;
      bytes[at + 2] = Math.round(event.offset * 200); view.setUint16(at + 3, Math.round(event.duration * 200));
      bytes[at + 5] = Math.round(event.velocity * 200); at += 6;
    }
  }
  const hash = PREFIX + btoa(Array.from(bytes, byte => String.fromCharCode(byte)).join(""))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  if (hash.length > V3_HASH_LENGTH) throw new Error("Recording link exceeds 64 KiB");
  return hash;
}

export function decodeV3(hash) {
  const text = hash.slice(PREFIX.length);
  if (hash.length > V3_HASH_LENGTH || !/^[A-Za-z0-9_-]+$/.test(text) || text.length % 4 === 1) throw new Error("Invalid v3 encoding");
  const bytes = Uint8Array.from(atob(text.replaceAll("-", "+").replaceAll("_", "/")), char => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  if (bytes.length < 8 || bytes[0] !== 1 || bytes[1] !== 0 || view.getUint16(6) > 240) throw new Error("Invalid v3 header");
  let at = 8;
  const frames = [];
  for (let n = 0; n < view.getUint16(6); n++) {
    if (at + 8 > bytes.length) throw new Error("Truncated v3 beat");
    const frame = { offsetMs: view.getUint32(at), presetId: EVENT_KITS[bytes[at + 4]], change: view.getInt16(at + 5), events: [] };
    const count = bytes[at + 7]; at += 8;
    if (count > 32 || at + count * 6 > bytes.length) throw new Error("Invalid v3 event count");
    for (let i = 0; i < count; i++, at += 6) frame.events.push({ part: EVENT_PARTS[bytes[at]],
      ...(bytes[at + 1] === 255 ? {} : { note: bytes[at + 1] }), offset: bytes[at + 2] / 200,
      duration: view.getUint16(at + 3) / 200, velocity: bytes[at + 5] / 200 });
    frames.push(frame);
  }
  if (at !== bytes.length) throw new Error("Trailing v3 bytes");
  return validateEventScore({ version: 3, renderer: RENDERER, durationMs: view.getUint32(2), frames });
}
