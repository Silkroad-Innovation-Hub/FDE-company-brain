import type { BrainLogLean } from '@librechat/data-schemas';
import { noteChunks, logChunk, hashText } from './chunk';

const note = (content: string) => ({
  id: 'Acme',
  title: 'Acme',
  type: 'company',
  tags: [],
  content,
});

describe('noteChunks', () => {
  it('embeds a short note whole, prefixed with its title, with a stable hash', () => {
    const chunks = noteChunks(note('Acme is a client.\n\n## Deal\n$50k pilot.'));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]).toMatchObject({ chunk: 0, title: 'Acme' });
    expect(chunks[0].text.startsWith('# Acme\n')).toBe(true);
    expect(chunks[0].hash).toBe(hashText(chunks[0].text));
    expect(noteChunks(note('Acme is a client.\n\n## Deal\n$50k pilot.'))[0].hash).toBe(
      chunks[0].hash,
    );
  });

  it('splits long notes on ## sections and hard-splits oversized sections', () => {
    const section = (name: string, size: number) => `## ${name}\n${'fact. '.repeat(size)}`;
    const content = `Intro line.\n${section('History', 300)}\n${section('Deals', 1500)}\n${section('People', 300)}`;
    const chunks = noteChunks(note(content));
    expect(chunks.length).toBeGreaterThanOrEqual(5);
    expect(chunks.map((chunk) => chunk.chunk)).toEqual(chunks.map((_chunk, i) => i));
    expect(chunks.every((chunk) => chunk.text.startsWith('# Acme\n'))).toBe(true);
    expect(chunks.every((chunk) => chunk.text.length <= 6_100)).toBe(true);
    expect(chunks[1].text).toContain('## History');
  });

  it('returns nothing for an empty body', () => {
    expect(noteChunks(note('   '))).toEqual([]);
  });
});

describe('logChunk', () => {
  it('prefixes provenance and caps the text', () => {
    const entry = {
      _id: 'abc',
      surface: 'email',
      sender: 'dana@henderson.com',
      subject: 'Invoice 1042',
      text: 'x'.repeat(5000),
    } as unknown as BrainLogLean;
    const chunk = logChunk(entry);
    expect(chunk.title).toBe('email from dana@henderson.com — Invoice 1042');
    expect(chunk.text.startsWith(`${chunk.title}\n`)).toBe(true);
    expect(chunk.text.length).toBeLessThanOrEqual(chunk.title.length + 1 + 2000);
    const owner = logChunk({
      _id: 'd',
      surface: 'imessage',
      text: 'hi',
    } as unknown as BrainLogLean);
    expect(owner.title).toBe('imessage from the owner');
  });
});
