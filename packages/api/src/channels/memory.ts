import type { AnswerTurn } from './answer';

const MAX_THREAD_TURNS = 8;

/** Per-process thread memory so follow-up questions in one thread see earlier turns. */
export class ThreadMemory {
  private readonly turns = new Map<string, AnswerTurn[]>();

  remember(threadId: string, turn: AnswerTurn): void {
    const history = this.turns.get(threadId) ?? [];
    history.push(turn);
    this.turns.set(threadId, history.slice(-MAX_THREAD_TURNS));
  }

  history(threadId: string): AnswerTurn[] {
    return [...(this.turns.get(threadId) ?? [])];
  }
}
