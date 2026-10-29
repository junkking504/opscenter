/** Parse local wall-clock input only; never changes a work date or timezone. */
export function parseClockEntry(value:string):{time:string;display:string;period:'AM'|'PM'}|null {
  const text=value.trim();
  const explicit=text.match(/^(\d{1,2})(?::?(\d{2}))?\s*(AM|PM)$/i);
  const colon=text.match(/^(\d{1,2}):(\d{2})$/);
  const digits=text.match(/^(\d{1,2})(\d{2})$/);
  const match=explicit||colon||digits;
  if(!match)return null;
  let hour=Number(match[1]);const minute=Number(match[2]||0);
  if(minute>59 || (explicit?(hour<1||hour>12):hour>23))return null;
  if(explicit)hour=hour%12+(match[3].toUpperCase()==='PM'?12:0);
  const period=hour>=12?'PM':'AM';
  return {time:`${String(hour).padStart(2,'0')}:${String(minute).padStart(2,'0')}`,display:`${hour%12||12}:${String(minute).padStart(2,'0')} ${period}`,period};
}
export const validClockEntry=(value:string,optional=false)=>optional&&!value.trim() || Boolean(parseClockEntry(value));
