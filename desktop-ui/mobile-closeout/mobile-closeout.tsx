import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Check, ChevronRight, ClipboardCheck, MapPin, Truck } from 'lucide-react';
import AppointmentCloseout from '../appointment-closeout';
import type { ScheduleAppointment } from '../lib/schedule-contract';
import './mobile-closeout.css';

// This review surface deliberately has no employee authentication or live-data loader.
// Its caller supplies sample jobs; production integration needs server-enforced scope.
export default function MobileCloseoutPreview({ jobs, date }: { jobs: ScheduleAppointment[]; date: string }) {
  const [selected, setSelected] = useState<ScheduleAppointment | null>(null);
  const [screen, setScreen] = useState<'job' | 'photos' | 'closeout'>('job');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [photos, setPhotos] = useState<Record<string, Array<{ url: string; name: string; category: string }>>>({});
  const urls = useRef<string[]>([]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => urls.current.forEach(url => URL.revokeObjectURL(url)), []);
  useEffect(() => { heading.current?.focus(); window.scrollTo(0, 0); }, [selected, screen]);
  const currentPhotos = selected ? photos[selected.appointmentId] || [] : [];
  const completed = jobs.filter(job => job.status === 'Completed').length;
  return <div className="crew-mobile ops-live">
    <div className="mobile-preview-banner">DESIGN PREVIEW · SAMPLE JOBS · NO LIVE SAVES</div>
    <header className="mobile-header"><div className="mobile-brand"><ClipboardCheck size={23}/><strong>OpsCenter<span>CREW</span></strong></div><span className="mobile-truck"><Truck size={17}/> Truck 6</span></header>
    {!selected ? <main className="mobile-home">
      <p className="mobile-eyebrow">THURSDAY, SEPTEMBER 17</p>
      <h1 ref={heading} tabIndex={-1}>Today’s jobs</h1>
      <div className="mobile-day-progress"><div><strong>{completed} of {jobs.length} jobs complete</strong><span>Sample schedule</span></div><progress value={completed} max={jobs.length}/></div>
      <div className="mobile-job-list">{jobs.map((job,index)=><button key={job.appointmentId} className={`mobile-job-card ${job.status==='Completed'?'is-complete':''}`} onClick={()=>{setSelected(job);setScreen('job');setNotice('');}}>
        <div className="mobile-job-top"><span className="mobile-stop">{job.status==='Completed'?<Check size={17}/>:String(index+1).padStart(2,'0')}</span><span>{job.appointmentTime}</span><span className="mobile-status">{job.status==='Completed'?'Completed':index===1?'Ready to close':'Upcoming'}</span></div>
        <h3>{job.customerName}</h3><p><MapPin size={15}/>{job.address}</p><div className="mobile-job-bottom"><span>{job.junkItems.join(' · ')}</span><ChevronRight size={20}/></div>
      </button>)}</div>
      <p className="mobile-footnote">Preview shows a proposed truck-focused workspace. Employee access and truck assignment will be enforced on the server before launch.</p>
    </main> : <>
      <div className="mobile-record-head"><button aria-label="Back to today's jobs" disabled={busy} onClick={()=>{setSelected(null);setNotice('');}}><ArrowLeft size={20}/></button><div><span>{selected.jkNumber} · {selected.appointmentTime}</span><h1 ref={heading} tabIndex={-1}>{selected.customerName}</h1></div></div>
      <nav className="mobile-record-tabs" aria-label="Job sections">{(['job','photos','closeout'] as const).map(value=><button key={value} disabled={busy} aria-current={screen===value?'page':undefined} onClick={()=>setScreen(value)}>{value==='job'?'Job details':value==='photos'?`Photos${currentPhotos.length ? ` (${currentPhotos.length})` : ''}`:'Close out'}</button>)}</nav>
      <main className="mobile-record-content">
        <section hidden={screen!=='job'}>
          <div className="mobile-address"><MapPin/><div><p className="mobile-eyebrow">SERVICE ADDRESS · SAMPLE</p><h2>{selected.address}</h2><p>Confirm the job and location before starting.</p></div></div>
          <div className="mobile-info-card"><h2>Items to remove</h2><p>{selected.junkItems.join(', ')}</p></div>
          <div className="mobile-info-card"><h2>Job notes</h2>{selected.appointmentNotes.map(note=><p key={note}>{note}</p>)}</div>
          <div className="mobile-info-card"><h2>Assigned crew</h2><p>{selected.driver} · Driver</p><p>{selected.navigator} · Navigator</p></div>
          <button className="mobile-primary" onClick={()=>setScreen('photos')}>Add job photos <Camera size={19}/></button><button className="mobile-text-button" onClick={()=>setScreen('closeout')}>Continue to closeout <ArrowRight size={17}/></button>
        </section>
        <section hidden={screen!=='photos'}><h2>Job photos</h2>
          {['Before','After'].map(category=><div className="mobile-photo-section" key={category}><h3>{category}</h3><label className="mobile-photo-picker"><Camera size={25}/><strong>Add {category.toLowerCase()} photos</strong><span>Take a photo or choose from your phone</span><input type="file" accept="image/*" multiple aria-label={`Add ${category.toLowerCase()} photos`} onChange={event=>{const files=Array.from(event.target.files || []).filter(file=>file.type.startsWith('image/'));const added=files.map(file=>{const url=URL.createObjectURL(file);urls.current.push(url);return{url,name:file.name,category};});setPhotos(previous=>({...previous,[selected.appointmentId]:[...(previous[selected.appointmentId] || []),...added]}));event.target.value='';}}/></label>
            <div className="mobile-photo-grid">{currentPhotos.filter(photo=>photo.category===category).map(photo=><figure key={photo.url}><img src={photo.url} alt={`${category}: ${photo.name}`}/><figcaption>Local preview only</figcaption><button aria-label={`Remove ${photo.name}`} onClick={()=>{setPhotos(previous=>({...previous,[selected.appointmentId]:previous[selected.appointmentId].filter(item=>item.url!==photo.url)}));URL.revokeObjectURL(photo.url);}}>Remove</button></figure>)}</div>
          </div>)}
          <p className="mobile-footnote">Photos stay in this preview tab and disappear when it closes. They are not uploaded to OpsCenter or JunkWare.</p><button className="mobile-primary" onClick={()=>setScreen('closeout')}>Continue to closeout <ArrowRight size={19}/></button>
        </section>
        <section hidden={screen!=='closeout'} className="job-record-drawer mobile-closeout-host">
          <div className="mobile-closeout-intro"><h2>Job closeout</h2><p>Check the details, then review before saving.</p></div>
          {<AppointmentCloseout key={selected.appointmentId} job={selected} date={date} presentation="mobile" onBackToAppointment={()=>setScreen('job')} saved={()=>setNotice('Preview result only. No live appointment was changed.')} onBusyChange={setBusy}/>}
          {notice && <p role="status" className="mobile-notice">{notice}</p>}
          <footer className="record-drawer-actions"><div className="closeout-footer-slot"/></footer>
        </section>
      </main>
    </>}
    <footer className="mobile-app-footer"><ClipboardCheck size={16}/><span>JUNK KING LOUISIANA</span><span>Mobile workspace</span></footer>
  </div>;
}
