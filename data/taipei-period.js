const formatter = new Intl.DateTimeFormat('en-US', {timeZone:'Asia/Taipei',year:'numeric',month:'2-digit'});
export function taipeiYearMonth(value = new Date()) {
  if (value === null || value === '') return {year:'',month:''};
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) return {year:'',month:''};
  const parts = formatter.formatToParts(date);
  return {year:parts.find(p => p.type === 'year').value,month:parts.find(p => p.type === 'month').value};
}
export function matchesShipPeriod(timestamp, year, month) {
  if (!year && !month) return true;
  const period = taipeiYearMonth(timestamp);
  return (!year || period.year === year) && (!month || period.month === month);
}
