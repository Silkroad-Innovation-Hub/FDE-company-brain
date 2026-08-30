import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';

export const CHAT_DB_PATH: string = path.join(os.homedir(), 'Library', 'Messages', 'chat.db');

/** Runs one read-only query against chat.db and returns the JSON rows. */
export type SqlRunner = <Row>(query: string) => Row[];

export interface MessageRow {
  rowid: number;
  guid: string;
  is_from_me: number;
  text: string | null;
  body_hex: string | null;
  handle: string | null;
  chat_name: string | null;
  chat_guid: string | null;
}

export interface HistoryRow {
  is_from_me: number;
  text: string | null;
  body_hex: string | null;
}

const SQLITE_BIN = '/usr/bin/sqlite3';
const MAX_BUFFER = 64 * 1024 * 1024;
const PAGE_SIZE = 200;

export function createSqlRunner(dbPath: string = CHAT_DB_PATH): SqlRunner {
  return <Row>(query: string): Row[] => {
    const out = execFileSync(SQLITE_BIN, ['-json', '-readonly', dbPath, query], {
      maxBuffer: MAX_BUFFER,
    }).toString();
    return out.trim() ? (JSON.parse(out) as Row[]) : [];
  };
}

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export function maxRowId(sql: SqlRunner): number {
  const [row] = sql<{ m: number | null }>('SELECT MAX(ROWID) AS m FROM message;');
  return row?.m ?? 0;
}

/** Messages after a ROWID, oldest first; tapbacks and edits are excluded. */
export function fetchNewMessages(
  sql: SqlRunner,
  afterRowId: number,
  limit: number = PAGE_SIZE,
): MessageRow[] {
  return sql<MessageRow>(`
    SELECT m.ROWID AS rowid, m.guid, m.is_from_me, m.text, hex(m.attributedBody) AS body_hex,
           h.id AS handle, COALESCE(NULLIF(c.display_name, ''), c.chat_identifier) AS chat_name,
           c.guid AS chat_guid
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    LEFT JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    LEFT JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE m.ROWID > ${Number(afterRowId)}
      AND m.associated_message_type = 0
    ORDER BY m.ROWID ASC
    LIMIT ${Number(limit)};`);
}

/** The previous messages of a chat before a ROWID, newest first. */
export function fetchThreadHistory(
  sql: SqlRunner,
  chatGuid: string,
  beforeRowId: number,
  limit: number,
): HistoryRow[] {
  return sql<HistoryRow>(`
    SELECT m.is_from_me, m.text, hex(m.attributedBody) AS body_hex
    FROM message m
    JOIN chat_message_join cmj ON cmj.message_id = m.ROWID
    JOIN chat c ON c.ROWID = cmj.chat_id
    WHERE c.guid = ${quote(chatGuid)} AND m.ROWID < ${Number(beforeRowId)}
      AND m.associated_message_type = 0
    ORDER BY m.ROWID DESC
    LIMIT ${Number(limit)};`);
}

/** Handles this Mac's Messages account sends from (lower-cased, `E:`/`P:` prefix stripped). */
export function fetchOwnHandles(sql: SqlRunner): string[] {
  return sql<{ account: string | null }>(
    'SELECT DISTINCT account FROM message WHERE is_from_me = 1 AND account IS NOT NULL;',
  )
    .map((row) =>
      String(row.account ?? '')
        .replace(/^[EP]:/, '')
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
}
