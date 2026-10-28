import {useId,useState} from 'react';
import {parseClockEntry} from './lib/clock-entry';
import './clock-entry.css';

/** Draft-only editing. The caller retains its explicit save and verification workflow. */
export default function ClockEntry({label,value,onChange,required=false,disabled=false,autoFocus=false}:{label:string;value:string;onChange:(value:string)=>void;required?:boolean;disabled?:boolean;autoFocus?:boolean}) {
  const id=useId();const [touched,setTouched]=useState(false);const parsed=parseClockEntry(value);
  const invalid=touched && (Boolean(value.trim())||required) && !parsed;
  return <div className="clock-entry"><label htmlFor={id}>{label}</label><div className="clock-entry-controls">
    <input id={id} type="text" inputMode="numeric" autoComplete="off" spellCheck={false} autoFocus={autoFocus} required={required} disabled={disabled} value={value} placeholder="0930" aria-invalid={invalid} aria-describedby={invalid?`${id}-error`:undefined} onChange={event=>onChange(event.target.value)} onBlur={()=>{setTouched(true);if(parsed)onChange(parsed.display);}}/>
    <select aria-label={`${label} AM/PM`} value={parsed?.period||'AM'} disabled={disabled||!parsed} onChange={event=>{if(parsed)onChange(parsed.display.replace(/AM|PM$/,event.target.value));}}><option>AM</option><option>PM</option></select>
  </div>{invalid&&<small id={`${id}-error`} role="alert">Use 0930 or 1730, or a time with AM/PM.</small>}</div>;
}
