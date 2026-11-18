export type State =
  | 'idle'
  | 'running'
  | 'waitingApproval'
  | 'waitingInput'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'unknown';
export interface Project {
  id: string;
  name: string;
  path: string;
}
export interface Settings {
  model?: string;
  effort?: string;
  mode?: 'default' | 'plan';
  permission: 'read-only' | 'workspace-write';
}
export interface Message {
  id: string;
  turnId: string;
  kind: 'user' | 'assistant' | 'command' | 'change' | 'notice' | 'tool';
  phase?: 'commentary' | 'partial_answer' | 'final_answer';
  text: string;
  status?: string;
  clientId?: string;
  files?: FileChange[];
  truncated?: boolean;
}
export interface FileChange {
  path: string;
  kind: 'add' | 'delete' | 'update';
  movePath?: string;
  diff: string;
  truncated?: boolean;
}
export interface Question {
  id: string;
  question: string;
  secret?: boolean;
  header?: string;
  allowOther?: boolean;
  options?: { label: string; description?: string }[];
}
export interface Action {
  id: string;
  threadId: string;
  turnId: string;
  kind: 'command' | 'file' | 'questions' | 'permissions';
  title: string;
  detail: string;
  decisions: string[];
  questions?: Question[];
  /** Missing on older clients/requests: treat questions as required. */
  blocking?: boolean;
  files?: FileChange[];
  truncated?: boolean;
  status: 'pending' | 'responding' | 'answered' | 'expired';
}
export interface Summary {
  id: string;
  projectId: string;
  title: string;
  state: State;
  updatedAt: number;
  archived?: boolean;
  forkedFromId?: string;
  queueCount?: number;
  managementPending?: boolean;
  executionPending?: boolean;
}
export interface TurnInfo {
  id: string;
  status?: string;
  /** Native Unix timestamps converted from seconds to milliseconds. */
  startedAtMs?: number;
  completedAtMs?: number;
  durationMs?: number;
}
export interface Thread extends Summary {
  turns?: TurnInfo[];
  messages: Message[];
  actions: Action[];
  turnId?: string;
  olderCursor: string | null;
  newerCursor?: string | null;
  settings: Settings;
  diff: string;
  diffTruncated?: boolean;
  resolvedModel?: string;
  steering?: (Operation & { text: string })[];
  usage?: { turnId: string; contextTokens: number; totalTokens: number; contextWindow?: number };
  plan?: { explanation?: string; steps: { step: string; status: string }[] };
  queue?: QueueState;
  pending?: { id: string; text: string; state: string; kind?: 'send' | 'review'; turnId?: string };
}
export interface Operation {
  id: string;
  threadId: string;
  resultId?: string;
  state: 'dispatching' | 'acknowledged' | 'unknown' | 'failed' | 'completed';
  kind: string;
  turnId?: string;
  error?: string;
}
export interface Attachment {
  path: string;
  sha: string;
  fromLine: number;
  toLine: number;
}
export interface FileContent {
  path: string;
  text: string;
  sha: string;
  lines: number;
}
export interface System {
  runtime: 'codex' | 'mock';
  state: string;
  version: string;
  error?: string;
  codeQuestions?: boolean;
}
export interface Envelope {
  seq: number;
  epoch: string;
  kind: string;
  threadId?: string;
  data: unknown;
}
export interface Snapshot {
  thread: Thread;
  cursor: { seq: number; epoch: string };
}
export const limits = {
  body: 256 * 1024,
  file: 256 * 1024,
  item: 128 * 1024,
  events: 512,
  eventBytes: 1024 * 1024,
  page: 12,
  active: 4,
  idleThreads: 20,
} as const;

export interface ConversationPage {
  data: Summary[];
  nextCursor: string | null;
  scanned: number;
}

export interface QueuePayload {
  text: string;
  settings: Settings;
  attachments: Attachment[];
}
export interface QueueItem extends QueuePayload {
  textTruncated?: boolean;
  id: string;
  threadId: string;
  state: 'queued' | 'dispatching' | 'sent' | 'unknown' | 'failed' | 'completed' | 'cancelled';
  error?: string;
  createdAt: number;
}
export interface QueueState {
  items: QueueItem[];
  paused: boolean;
  reason?: string;
}

export interface Model {
  id: string;
  model: string;
  displayName: string;
  isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
}
export type ReviewTarget =
  | { type: 'uncommittedChanges' }
  | { type: 'baseBranch'; branch: string }
  | { type: 'commit'; sha: string }
  | { type: 'custom'; instructions: string };

/** Persisted settings from older builds may omit mode or use a different key order. */
export function sameSettings(a: Settings, b: Settings): boolean {
  return (
    a.permission === b.permission &&
    (a.model ?? '') === (b.model ?? '') &&
    (a.effort ?? '') === (b.effort ?? '') &&
    (a.mode ?? 'default') === (b.mode ?? 'default')
  );
}
