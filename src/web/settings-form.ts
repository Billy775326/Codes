export interface SettingsFormState {
  changed: boolean;
  busy: boolean;
  canSave: boolean;
  saved?: boolean;
  restartRequired?: boolean;
}

export const emptyFormDraft: SettingsFormState = { changed: false, busy: false, canSave: false };
