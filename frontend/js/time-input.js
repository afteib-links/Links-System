(function (root) {
  'use strict';
  // Shared by browser entry forms and server-side import adapters.
  function parse(value, { signed = false, maxMinutes = 59999 } = {}) {
    const text = String(value ?? '').normalize('NFKC').trim();
    if (!text) return null;
    const match = text.match(/^([+-]?)(\d{1,3})[:.](\d{2})$/);
    let hours, minutes, sign = 1;
    if (match) {
      if (match[1] && !signed) throw new Error('この欄には負号・正号を入力できません');
      sign = match[1] === '-' ? -1 : 1;
      hours = Number(match[2]);
      minutes = Number(match[3]);
    } else {
      const compact = text.match(/^([+-]?)(\d{1,4})$/);
      if (!compact) throw new Error('時分で入力してください（例: 2.30 / 230）。2.3は2.03か2.30に直してください');
      if (compact[1] && !signed) throw new Error('この欄には負号・正号を入力できません');
      sign = compact[1] === '-' ? -1 : 1;
      const digits = compact[2];
      hours = Number(digits.length <= 2 ? digits : digits.slice(0, -2));
      minutes = digits.length <= 2 ? 0 : Number(digits.slice(-2));
    }
    if (minutes > 59) throw new Error('分は00〜59で入力してください');
    const total = hours * 60 + minutes;
    if (total > maxMinutes) throw new Error(`時間は${format(maxMinutes)}までで入力してください`);
    return sign * total;
  }
  function format(minutes, { padHours = true } = {}) {
    if (minutes == null) return '';
    const absolute = Math.abs(minutes);
    return `${minutes < 0 ? '-' : ''}${String(Math.floor(absolute / 60)).padStart(padHours ? 2 : 1, '0')}:${String(absolute % 60).padStart(2, '0')}`;
  }
  function normalize(value, options = {}) {
    return format(parse(value, options), options);
  }
  const api = { parse, format, normalize };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LinksTimeInput = api;
})(typeof window !== 'undefined' ? window : globalThis);
