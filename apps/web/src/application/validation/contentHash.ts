// Tiny deterministic content hash (FNV-1a, 32-bit, hex) for change detection
// on profile descriptions — decides whether a saved item needs
// re-normalization. NOT cryptographic; collisions only cost one redundant
// (or one skipped) cheap AI call.

export function contentHash(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}
