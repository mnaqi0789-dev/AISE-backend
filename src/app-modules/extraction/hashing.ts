import { createHash } from "crypto";

export function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

export function computeContentHash(cleanText: string): string {
  return createHash("sha256").update(normalizeText(cleanText)).digest("hex");
}

function shingle(text: string, size = 4): string[] {
  const words = normalizeText(text).split(" ").filter(Boolean);
  const shingles: string[] = [];

  for (let i = 0; i <= words.length - size; i++) {
    shingles.push(words.slice(i, i + size).join(" "));
  }

  return shingles.length > 0 ? shingles : [normalizeText(text)];
}

function hash64(input: string): bigint {
  const digest = createHash("md5").update(input).digest();
  return digest.readBigUInt64BE(0);
}

export function computeSimhash(text: string): string {
  const shingles = shingle(text);
  const bitCounts = new Array(64).fill(0);

  for (const s of shingles) {
    const h = hash64(s);
    for (let bit = 0; bit < 64; bit++) {
      const bitValue = (h >> BigInt(bit)) & 1n;
      bitCounts[bit] += bitValue === 1n ? 1 : -1;
    }
  }

  let fingerprint = 0n;
  for (let bit = 0; bit < 64; bit++) {
    if (bitCounts[bit] > 0) {
      fingerprint |= 1n << BigInt(bit);
    }
  }

  return fingerprint.toString(16).padStart(16, "0");
}

export function hammingDistance(hexA: string, hexB: string): number {
  const a = BigInt("0x" + hexA);
  const b = BigInt("0x" + hexB);
  let xor = a ^ b;
  let count = 0;

  while (xor > 0n) {
    count += Number(xor & 1n);
    xor >>= 1n;
  }

  return count;
}
