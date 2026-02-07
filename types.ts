
export interface OCRPage {
  pageNumber: number;
  extractedText: string;
  imagePreview?: string;
  durationMs?: number;
}

export interface DocumentState {
  fileName: string;
  pages: OCRPage[];
  fullText: string;
  status: 'idle' | 'processing' | 'completed' | 'error';
  progress: number;
  totalDurationMs?: number;
  startTime?: number;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}
