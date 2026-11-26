import type { NativeExecutionSettings } from './native-configuration.js';

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
  archived?: boolean;
  /** Sidebar bootstrap timestamp in milliseconds. Zero means no known conversations. */
  latestConversationAt?: number;
}
export type ProjectUpdate = Pick<Project, 'id'> & Partial<Pick<Project, 'name' | 'archived'>>;
export interface DirectoryStatus {
  available: boolean;
  code?: 'DIRECTORY_UNAVAILABLE' | 'DIRECTORY_ACCESS';
  message?: string;
}
export interface ProjectContext {
  project: Project;
  directory: DirectoryStatus;
}
export interface Settings {
  model?: string;
  effort?: string;
  /** Inherits the effective Codex speed when absent. */
  fast?: boolean;
  mode?: 'default' | 'plan';
  permission?: 'read-only' | 'workspace-write' | 'auto-review' | 'danger-full-access';
}
export interface SettingsProfile {
  revision: number;
  settings: Settings;
}
export interface CodexDefaults {
  model?: string;
  effort?: string;
  planEffort?: string;
  fast: boolean;
  fastAvailable: boolean;
}
export interface Message {
  id: string;
  turnId: string;
  kind: 'user' | 'assistant' | 'command' | 'change' | 'notice' | 'tool' | 'compaction' | 'question';
  answeredQuestions?: { questionItemId?: string; question: string; answer: string }[];
  /** Nonblocking questions attached to a native agent message. */
  asyncQuestions?: Question[];
  phase?: 'commentary' | 'partial_answer' | 'final_answer';
  text: string;
  status?: string;
  clientId?: string;
  images?: ImageAttachment[];
  unavailableImages?: number;
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
  async?: boolean;
  skipped?: boolean;
  title: string;
  detail: string;
  decisions: string[];
  questions?: Question[];
  afterMessageId?: string;
  /** Alternate IDs assigned by legacy history to the same nonblocking request. */
  legacyQuestion?: { itemIds: string[]; questionIds: Record<string, string> };
  submittedAnswers?: Record<string, string>;
  replyUnconfirmed?: boolean;
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
  queuePaused?: boolean;
  queueIssue?: 'unknown' | 'failed';
  executionUnknown?: boolean;
  managementPending?: boolean;
  executionPending?: boolean;
  sidebarActivity?:
    | 'needsInput'
    | 'needsApproval'
    | 'optionalInput'
    | 'approvalAndInput'
    | 'responding'
    | 'responseUnconfirmed'
    | 'compacting';
  expiredQuestion?: boolean;
}
export interface TurnUsage {
  totalTokens: number;
  outputTokens?: number;
}
export interface TurnInfo {
  id: string;
  status?: string;
  /** Native Unix timestamps converted from seconds to milliseconds. */
  startedAtMs?: number;
  completedAtMs?: number;
  durationMs?: number;
  usage?: TurnUsage;
}
export interface Thread extends Summary {
  /** The last explicit resume was refused by another native writer; history is still readable. */
  writerConflict?: boolean;
  turns?: TurnInfo[];
  messages: Message[];
  actions: Action[];
  turnId?: string;
  olderCursor: string | null;
  newerCursor?: string | null;
  settings: Settings;
  composerSettings?: SettingsProfile;
  diff: string;
  diffTruncated?: boolean;
  resolvedModel?: string;
  nativeSettings?: NativeExecutionSettings;
  steering?: (Operation & { text: string; questionReply?: boolean })[];
  /** Native progress only; does not end the turn or release its execution lease. */
  compaction?: { id: string; turnId: string };
  usage?: {
    turnId: string;
    contextTokens: number;
    totalTokens: number;
    contextWindow?: number;
    turnTotalTokens?: number;
    turnOutputTokens?: number;
  };
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
export interface FileAttachment {
  kind?: 'file';
  path: string;
  showHidden?: true;
  sha: string;
  fromLine: number;
  toLine: number;
}
export interface ImageAttachment {
  kind: 'image';
  id: string;
  name: string;
}
export interface UploadedFileAttachment {
  kind: 'uploaded-file';
  id: string;
  name: string;
}
export type Attachment =
  FileAttachment | ImageAttachment | UploadedFileAttachment | ProjectFileReferenceAttachment;
export interface FileContent {
  path: string;
  text: string;
  sha: string;
  lines: number;
}
export interface MaintenanceState {
  expiresAt: number;
  ready: boolean;
}
export interface CodexCapabilities {
  conversationSearch?: boolean;
  conversationIdFilter?: boolean;
  conversationSort?: boolean;
  itemHistory: boolean;
  branch: boolean;
  review: boolean;
  turnSpeed: boolean;
}
export interface System {
  maintenance?: MaintenanceState;
  defaultProjectPath?: string;
  projectDirectoryFallback?: string;
  initialWorkingDirectory?: string;
  runtime: 'codex' | 'mock';
  state: string;
  version: string;
  error?: string;
  capabilities?: CodexCapabilities;
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
  context?: ProjectContext;
  cursor: { seq: number; epoch: string };
}
export const limits = {
  body: 256 * 1024,
  file: 256 * 1024,
  uploadedFile: 64 * 1024,
  uploadedFiles: 512,
  item: 128 * 1024,
  events: 512,
  eventBytes: 1024 * 1024,
  page: 12,
  active: 4,
  idleThreads: 20,
} as const;

export type ConversationSort = 'updated_at' | 'created_at';

export interface NativeConversationSummary extends Summary {
  cwd: string;
  createdAt: number;
}

export interface NativeConversationPage {
  data: NativeConversationSummary[];
  nextCursor: string | null;
}

export interface ConversationPage {
  data: Summary[];
  nextCursor: string | null;
  scanned: number;
  /** Latest observed conversation update for the project, in milliseconds. */
  latestConversationAt?: number;
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
  supportsFast?: boolean;
  supportsImages?: boolean;
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
    (a.mode ?? 'default') === (b.mode ?? 'default') &&
    a.fast === b.fast
  );
}
import type { ProjectFileReferenceAttachment } from './project-files.js';
