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
  permission: 'read-only' | 'workspace-write';
}
export interface Message {
  id: string;
  turnId: string;
  kind: 'user' | 'assistant' | 'command' | 'change' | 'notice';
  text: string;
  status?: string;
  clientId?: string;
}
export interface Question {
  id: string;
  question: string;
  secret?: boolean;
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
  status: 'pending' | 'responding' | 'answered' | 'expired';
}
export interface Summary {
  id: string;
  projectId: string;
  title: string;
  state: State;
  updatedAt: number;
  archived?: boolean;
  managementPending?: boolean;
  executionPending?: boolean;
}
export interface Thread extends Summary {
  messages: Message[];
  actions: Action[];
  turnId?: string;
  olderCursor: string | null;
  settings: Settings;
  diff: string;
  pending?: { id: string; text: string; state: string };
}
export interface Operation {
  id: string;
  threadId: string;
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
