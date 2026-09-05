export const PHOTO_STATES = ['review','failed','processing','incoming'] as const;
export type PhotoState = typeof PHOTO_STATES[number];
export type PhotoReviewRecord = {
  id: string; state: PhotoState; receivedAt: string | null; outcomeAt: string | null;
  sender: string; senderKey: string; jobDate: string | null; jk: string; category: string;
  caption: string; reason: string; reasonLabel: string; nextStep: string;
  attempts: number; previewAvailable: boolean; sourceHref: string | null;
};
export type PhotoReviewSnapshot = {
  observedAt: string; complete: boolean; unreadable: number; unavailableStates: PhotoState[];
  counts: Record<PhotoState,number>; total: number; filtered: number; page: number; pages: number;
  records: PhotoReviewRecord[]; reasons: Array<{reason:string;label:string;count:number}>;
  senders: Array<{key:string;label:string;count:number}>;
};
