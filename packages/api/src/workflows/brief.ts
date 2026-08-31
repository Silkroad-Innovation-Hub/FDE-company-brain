import type {
  TodoLean,
  ApprovalLean,
  BrainLogLean,
  ChannelNoticeLean,
  WorkflowPolicyLean,
  WorkflowPolicyUpdate,
} from '@librechat/data-schemas';
import type { BudgetConfig, BudgetStatusMethods } from '~/guardrails/budget';
import type { DailyScheduleHandle, ScheduleLogger } from './schedule';
import type { BrainChatFn } from '~/brain/openai';
import type { CalendarApi } from './calendar';
import { getBudgetStatus } from '~/guardrails/budget';
import { startDailySchedule } from './schedule';

export const BRIEF_WORKFLOW: string = 'brief';
export const DEFAULT_BRIEF_MODEL: string = 'gpt-5.5';

export interface BriefMethods extends BudgetStatusMethods {
  getTodos: (user: string) => Promise<TodoLean[]>;
  getApprovals: (user: string) => Promise<ApprovalLean[]>;
  listBrainLogs: (filter: {
    user?: string;
    status?: BrainLogLean['status'];
    limit?: number;
  }) => Promise<BrainLogLean[]>;
  getWorkflowPolicy: (user: string, workflow: string) => Promise<WorkflowPolicyLean | null>;
  setWorkflowPolicy: (
    user: string,
    workflow: string,
    update: WorkflowPolicyUpdate,
  ) => Promise<WorkflowPolicyLean>;
  createChannelNotice: (user: string, kind: string, text: string) => Promise<ChannelNoticeLean>;
}

export interface BriefDeps {
  methods: BriefMethods;
  budget: BudgetConfig;
  timeZone: string;
  logger: ScheduleLogger;
  /** Prose model; when absent (or failing) the brief is rendered deterministically. */
  chat?: BrainChatFn;
  model?: string;
  calendar?: CalendarApi;
}

export interface BriefSections {
  today: string[];
  todos: string[];
  approvals: string[];
  brain: string[];
  spend: string[];
}

export interface BriefRun {
  skipped: boolean;
  text?: string;
}

const MAX_TODOS = 10;
const MAX_APPROVAL_TITLES = 3;
const MAX_NOTES = 8;
const LOG_SCAN = 100;
const DAY_MS = 86_400_000;
const CHAT_TIMEOUT_NOTE = 'brief: model call failed, sending the plain rendering';

const SECTION_TITLES: Array<[keyof BriefSections, string]> = [
  ['today', 'Today'],
  ['todos', 'Owed to you / by you'],
  ['approvals', 'Waiting on you'],
  ['brain', 'Brain'],
  ['spend', 'Spend'],
];

const BRIEF_SYSTEM = `You write the owner's morning brief for their phone. Rewrite the provided sections as plain text, at most 120 words.
Keep the section names and their order exactly as given, and only the sections given. Under each, one line per item, numbers first, no filler words.
No preamble, no greeting, no sign-off, no markdown, no advice. Never invent an item that is not in the input.`;

function dueLabel(todo: TodoLean): string {
  if (!todo.dueDate) {
    return '';
  }
  const due = new Date(todo.dueDate).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
  return ` (due ${due})`;
}

async function safely<T>(
  logger: ScheduleLogger,
  what: string,
  work: Promise<T>,
  fallback: T,
): Promise<T> {
  try {
    return await work;
  } catch (error) {
    logger.error(`brief: ${what} unavailable`, error);
    return fallback;
  }
}

async function calendarLines(deps: BriefDeps, now: Date): Promise<string[]> {
  if (!deps.calendar) {
    return [];
  }
  const events = await safely(
    deps.logger,
    'calendar',
    deps.calendar.listToday(deps.timeZone, now),
    [],
  );
  return events.map((event) => {
    const when = event.start === event.end ? event.start : `${event.start}–${event.end}`;
    const where = event.location ? ` @ ${event.location}` : '';
    const who = event.attendees > 0 ? ` (${event.attendees} others)` : '';
    return `${when} ${event.title}${where}${who}`;
  });
}

async function todoLines(deps: BriefDeps, user: string): Promise<string[]> {
  const todos = await safely(deps.logger, 'to-dos', deps.methods.getTodos(user), []);
  return todos
    .filter((todo) => !todo.done)
    .slice(0, MAX_TODOS)
    .map((todo) => `${todo.text}${dueLabel(todo)}`);
}

async function approvalLines(deps: BriefDeps, user: string): Promise<string[]> {
  const approvals = await safely(deps.logger, 'approvals', deps.methods.getApprovals(user), []);
  const pending = approvals.filter((approval) => approval.status === 'pending');
  if (pending.length === 0) {
    return [];
  }
  const titles = pending.slice(0, MAX_APPROVAL_TITLES).map((approval) => approval.title);
  const more = pending.length > titles.length ? ` +${pending.length - titles.length} more` : '';
  return [`${pending.length} pending: ${titles.join('; ')}${more}`];
}

async function brainLines(deps: BriefDeps, user: string, now: Date): Promise<string[]> {
  const since = now.getTime() - DAY_MS;
  const [applied, awaiting] = await Promise.all([
    safely(
      deps.logger,
      'brain log',
      deps.methods.listBrainLogs({ user, status: 'applied', limit: LOG_SCAN }),
      [],
    ),
    safely(
      deps.logger,
      'brain approvals',
      deps.methods.listBrainLogs({ user, status: 'awaiting_approval', limit: LOG_SCAN }),
      [],
    ),
  ]);
  const notes = [
    ...new Set(
      applied
        .filter(
          (entry) =>
            entry.noteId && entry.processedAt && new Date(entry.processedAt).getTime() >= since,
        )
        .map((entry) => entry.noteId as string),
    ),
  ].slice(0, MAX_NOTES);
  const lines =
    notes.length > 0
      ? [`${notes.length} note${notes.length === 1 ? '' : 's'} updated: ${notes.join(', ')}`]
      : [];
  if (awaiting.length > 0) {
    lines.push(
      `${awaiting.length} memory write${awaiting.length === 1 ? '' : 's'} awaiting your approval`,
    );
  }
  return lines;
}

async function spendLines(deps: BriefDeps, user: string, now: Date): Promise<string[]> {
  if (deps.budget.expectedUsd <= 0) {
    return [];
  }
  const status = await safely(
    deps.logger,
    'budget',
    getBudgetStatus({ methods: deps.methods, config: deps.budget }, user, now),
    null,
  );
  if (!status) {
    return [];
  }
  const paused = status.paused ? ' — channels paused' : '';
  return [
    `$${status.spendUsd.toFixed(2)} of $${status.expectedUsd} this month (${status.multiple.toFixed(1)}×)${paused}`,
  ];
}

/** Everything the brief can say, gathered in parallel; every source degrades to empty on failure. */
export async function gatherBrief(
  deps: BriefDeps,
  user: string,
  now: Date = new Date(),
): Promise<BriefSections> {
  const [today, todos, approvals, brain, spend] = await Promise.all([
    calendarLines(deps, now),
    todoLines(deps, user),
    approvalLines(deps, user),
    brainLines(deps, user, now),
    spendLines(deps, user, now),
  ]);
  return { today, todos, approvals, brain, spend };
}

/** Deterministic plain-text rendering — the fallback and the model's input. */
export function renderBrief(sections: BriefSections): string {
  const blocks = SECTION_TITLES.filter(([key]) => sections[key].length > 0).map(
    ([key, title]) => `${title}\n${sections[key].map((line) => `- ${line}`).join('\n')}`,
  );
  if (blocks.length === 0) {
    return 'Nothing on the calendar, no open to-dos, nothing waiting on you.';
  }
  return blocks.join('\n\n');
}

export async function composeBrief(
  deps: BriefDeps,
  user: string,
  now: Date = new Date(),
): Promise<string> {
  const sections = await gatherBrief(deps, user, now);
  const rendered = renderBrief(sections);
  if (!deps.chat) {
    return rendered;
  }
  try {
    const polished = await deps.chat(
      [
        { role: 'system', content: BRIEF_SYSTEM },
        { role: 'user', content: `Date: ${now.toDateString()}\n\n${rendered}` },
      ],
      deps.model ?? DEFAULT_BRIEF_MODEL,
    );
    return polished.trim().length > 0 ? polished.trim() : rendered;
  } catch (error) {
    deps.logger.error(CHAT_TIMEOUT_NOTE, error);
    return rendered;
  }
}

/**
 * Composes the brief and hands it to the connectors as an owner notice.
 * Skipped when the owner has disabled the workflow.
 */
export async function runBrief(
  deps: BriefDeps,
  user: string,
  now: Date = new Date(),
): Promise<BriefRun> {
  const policy = await deps.methods.getWorkflowPolicy(user, BRIEF_WORKFLOW);
  if (policy?.enabled === false) {
    deps.logger.info('brief: disabled by policy, skipping');
    return { skipped: true };
  }
  const text = await composeBrief(deps, user, now);
  await deps.methods.createChannelNotice(user, BRIEF_WORKFLOW, text);
  await deps.methods.setWorkflowPolicy(user, BRIEF_WORKFLOW, {
    lastRunAt: now,
    lastRunSummary: text.slice(0, 500),
  });
  deps.logger.info(`brief: sent (${text.length} chars)`);
  return { skipped: false, text };
}

export interface BriefScheduleOptions extends BriefDeps {
  user: string;
  hour: number;
  minute?: number;
}

/** Daily brief at the owner's local hour; the notice is delivered by whichever connector is up. */
export function startBriefSchedule(options: BriefScheduleOptions): DailyScheduleHandle {
  return startDailySchedule({
    hour: options.hour,
    minute: options.minute,
    timeZone: options.timeZone,
    logger: options.logger,
    run: async () => {
      await runBrief(options, options.user);
    },
  });
}
