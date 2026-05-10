export interface EditorRange {
  from: number;
  to: number;
}

export interface EditorSelection {
  range: EditorRange;
  text: string;
  rect?: {
    left: number;
    top: number;
    width: number;
    height: number;
  };
}

export interface CursorAroundOptions {
  beforeChars?: number;
  afterChars?: number;
}

export interface CursorAroundText {
  beforeText: string;
  afterText: string;
}

export interface EditorBridge {
  getDocumentContent(): string;
  getSelection(): EditorSelection | null;
  getSelectedText(): string;
  getTextInRange(range: EditorRange): string;
  getCursorTextAround(options?: CursorAroundOptions): CursorAroundText;
  restoreSelection(range: EditorRange): void;
  insertAtCursor(text: string): void;
  replaceRange(range: EditorRange, text: string): void;
  replaceSelection(text: string): void;
  appendToDocument(text: string): void;
  focusEditor(): void;
}
