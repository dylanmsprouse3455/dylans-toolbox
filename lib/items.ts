export const AREAS = ['Work','Home','Money','Personal','People','Projects','Ideas','Inbox'] as const;
export type Area = typeof AREAS[number];
export type ItemType = 'task' | 'reminder' | 'note' | 'reference';
export type Item = {
  id: string; user_id: string; type: ItemType; title: string; content: string;
  area: Area; status: 'active' | 'completed'; importance: number; urgency: number;
  due_at: string | null; parent_id: string | null; source_text: string;
  due_date?: string | null;
  capture_id: string | null; created_at: string; updated_at: string;
};
export function actionable(item: Pick<Item,'type'>) { return item.type === 'task' || item.type === 'reminder'; }
export function dueTime(item:Pick<Item,'due_at'|'due_date'>){return item.due_at?Date.parse(item.due_at):item.due_date?new Date(item.due_date+'T23:59:59').getTime():Infinity;}
export function priority(item: Item, now = Date.now()) {
  const hours = (dueTime(item) - now) / 3600000;
  return item.importance * 12 + item.urgency * 8 + (hours < 0 ? 80 : hours <= 24 ? 60 : hours <= 72 ? 35 : hours <= 168 ? 10 : 0);
}
export function attention(items: Item[], now = Date.now()) {
  return items.filter(i => actionable(i) && i.status === 'active' && !i.parent_id &&
    (i.importance >= 4 || i.urgency >= 4 || dueTime(i) <= now + 72 * 3600000))
    .sort((a,b) => priority(b, now) - priority(a, now) || (a.due_at ?? '9999').localeCompare(b.due_at ?? '9999') || a.created_at.localeCompare(b.created_at)).slice(0,5);
}
export function quadrant(item: Pick<Item,'importance'|'urgency'>) {
  return item.importance >= 4 ? (item.urgency >= 4 ? 'Do first' : 'Make time') : (item.urgency >= 4 ? 'Handle soon' : 'For later');
}
export function dueLabel(date: string | null,dateOnly?:string|null) {
  if (!date&&!dateOnly) return null;
  const d = new Date(date||dateOnly+'T12:00:00'), now = new Date();
  const day = d.toLocaleDateString(), today = now.toLocaleDateString();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toLocaleDateString();
  const time = date?', '+d.toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'';
  if (day === today) return 'Today' + time;
  if (day === tomorrow) return 'Tomorrow' + time;
  return d.toLocaleDateString([], {month:'short',day:'numeric',...(d.getFullYear() !== now.getFullYear() ? {year:'numeric' as const} : {})})+time;
}
