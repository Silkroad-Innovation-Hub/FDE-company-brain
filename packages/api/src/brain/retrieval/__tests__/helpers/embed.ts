import type { BrainEmbedFn } from '~/brain/openai';

export const FAKE_DIMS = 64;

function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9$][a-z0-9$-]{2,}/g) ?? [];
}

function bucket(token: string): number {
  let hash = 2166136261;
  for (let i = 0; i < token.length; i++) {
    hash ^= token.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % FAKE_DIMS;
}

/** Deterministic bag-of-tokens embedding: texts sharing words land close together. */
export function fakeEmbedOne(text: string): Float32Array {
  const vector = new Float32Array(FAKE_DIMS);
  for (const token of tokenize(text)) {
    vector[bucket(token)] += 1;
  }
  let norm = 0;
  for (let i = 0; i < FAKE_DIMS; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < FAKE_DIMS; i++) {
    vector[i] /= norm;
  }
  return vector;
}

export const fakeEmbed: BrainEmbedFn = async (texts) => texts.map(fakeEmbedOne);
