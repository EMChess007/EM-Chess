export type TimeControlCategory = 'bullet' | 'blitz' | 'rapid' | 'daily' | 'unlimited';

export interface TimeControl {
  id: string;
  label: string;
  initialSeconds: number;
  incrementSeconds: number;
  category: TimeControlCategory;
}
