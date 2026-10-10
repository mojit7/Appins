/** قالب‌بندی اعداد و تاریخ به فارسی (fa-IR، تقویم هجری شمسی). */

const numFa = new Intl.NumberFormat('fa-IR');
const numFaCompact = new Intl.NumberFormat('fa-IR', { notation: 'compact', maximumFractionDigits: 1 });
const dateFaLong = new Intl.DateTimeFormat('fa-IR', { dateStyle: 'long' });
const dateFaShort = new Intl.DateTimeFormat('fa-IR', { month: 'short', day: 'numeric' });
const weekdayFa = new Intl.DateTimeFormat('fa-IR', { weekday: 'short' });
const timeFa = new Intl.DateTimeFormat('fa-IR', { hour: '2-digit', minute: '2-digit' });

export const faNum = (n: number): string => numFa.format(n);

/** خلاصه اعداد بزرگ: ۱۲.۴ هزار */
export const faCompact = (n: number): string => numFaCompact.format(n);

export const faToman = (n: number): string => `${faNum(n)} تومان`;

export const faDate = (d: Date): string => dateFaLong.format(d);
export const faDayMonth = (d: Date): string => dateFaShort.format(d);
export const faWeekday = (d: Date): string => weekdayFa.format(d);
export const faTime = (d: Date): string => timeFa.format(d);

/** نسبت را با اعداد فارسی و علامت درصد نشان می‌دهد. */
export const faPercent = (ratio: number): string => `${faNum(Math.round(ratio * 100))}٪`;
