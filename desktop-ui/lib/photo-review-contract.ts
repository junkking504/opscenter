export const PHOTO_STATES = ['review','failed','processing','incoming','assigned'] as const;
export type PhotoState = typeof PHOTO_STATES[number];
export type PhotoReviewRecord = {
  id: string; state: PhotoState; receivedAt: string | null; outcomeAt: string | null;
  sender: string; senderKey: string; jobDate: string | null; jk: string; category: string;
  caption: string; reason: string; reasonLabel: string; nextStep: string;
  attempts: number; previewAvailable: boolean; sourceHref: string | null;
  revision?: string; assignmentBlocked?: string | null;
};
export type PhotoAppointment = {
  appointmentId: string; jk: string; date: string; truck: string;
  customer: string; address: string; time: string; status: string;
};
export type PhotoAppointmentOptions = { date: string; sourceAt: string | null; appointments: PhotoAppointment[] };
export type PhotoAssignmentInput = {
  id: string; state: 'review' | 'failed'; revision: string; requestId: string;
  date: string; appointmentId: string; jk: string; category: 'before' | 'after' | 'donation';
  confirmed: true;
};
export type PhotoAssignmentStatus = {
  state: 'assigned' | 'incoming' | 'processing' | 'review' | 'failed' | 'completed';
  verified: boolean; requestId: string | null; appointment: PhotoAppointment | null;
  category: string | null; message: string; updatedAt: string | null;
};
export type PhotoReviewSnapshot = {
  observedAt: string; complete: boolean; unreadable: number; unavailableStates: PhotoState[];
  counts: Record<PhotoState,number>; total: number; filtered: number; page: number; pages: number;
  records: PhotoReviewRecord[]; reasons: Array<{reason:string;label:string;count:number}>;
  senders: Array<{key:string;label:string;count:number}>;
};
