import { startTransition, useEffect, useRef, useState, type RefObject } from 'react';
import { adjacentWorkspace, downwardIntent, GESTURE, horizontalIntent, type GesturePoint } from '../lib/mobile-gestures';
import '../mobile-interactions.css';

export type MetricPreview = { id: string; label: string; value: string; detail?: string };
type Props = {
  contentRef: RefObject<HTMLElement | null>;
  activeWorkspace: string;
  workspaces: readonly { workspace: string; label: string }[];
  onNavigate: (workspace: string) => boolean | void;
  /** Warm code only after horizontal intent; never fetch operational data here. */
  onPrepareNavigation?: (workspace: string) => void;
  busy: boolean;
  /** Only read displayed snapshots. Never call source refresh, receipt verification or reload. */
  onRefresh?: () => Promise<void>;
  previews?: readonly MetricPreview[];
};
const excluded='a,input,textarea,select,button,[contenteditable]:not([contenteditable="false"]),[draggable="true"],[role="slider"],[role="tablist"],[data-gesture-ignore],summary,img,svg,canvas,video,.leaflet-container,.recharts-wrapper,.maplibregl-map,.mapboxgl-map';
function selectionActive() { return Boolean(window.getSelection()?.toString()); }
function blockedSurface(target: Element, root: HTMLElement) {
  if (target.closest(excluded)) return true;
  for (let node: Element | null=target; node && node!==root; node=node.parentElement) {
    const style=getComputedStyle(node);
    if ((/(auto|scroll)/.test(style.overflowX) && node.scrollWidth>node.clientWidth+1) || (/(auto|scroll)/.test(style.overflowY) && node.scrollHeight>node.clientHeight+1)) return true;
  }
  return false;
}
function editingOrDialog() {
  return Boolean([...document.querySelectorAll('dialog[open],[role="dialog"],[aria-modal="true"],.record-drawer,.drawer-backdrop')].some(node=>node.getClientRects().length>0 && !node.closest('[hidden],[inert]')) || document.activeElement?.matches('input,textarea,select,[contenteditable]:not([contenteditable="false"])'));
}

/** Passive listeners only: no global touch-action override or scroll prevention. */
export function MobileInteractions(props: Props) {
  const latest=useRef(props); latest.current=props;
  const [status,setStatus]=useState('');
  const [navigationHint,setNavigationHint]=useState<{label:string;direction:-1|1}|null>(null);
  const [pending,setPending]=useState(false);
  const pendingRef=useRef(false);
  const [preview,setPreview]=useState<readonly MetricPreview[] | null>(null);
  const dialog=useRef<HTMLDialogElement>(null);
  const returnFocus=useRef<HTMLElement | null>(null);
  const cooldown=useRef(0);
  const pendingNavigation=useRef<string | null>(null);
  useEffect(()=>{
    if(pendingNavigation.current!==props.activeWorkspace)return;
    pendingNavigation.current=null;
    setNavigationHint(null);
    setStatus(`${latest.current.workspaces.find(item=>item.workspace===props.activeWorkspace)?.label || props.activeWorkspace} selected`);
    const heading=props.contentRef.current?.querySelector<HTMLElement>('h1');
    if(heading){heading.tabIndex=-1;heading.focus({preventScroll:true});}
  },[props.activeWorkspace,props.contentRef]);
  const closePreview=()=>setPreview(null);
  useEffect(()=>{
    if (!preview) return;
    const node=dialog.current;
    returnFocus.current=document.activeElement instanceof HTMLElement ? document.activeElement : null;
    node?.showModal();
    return ()=>{node?.close();if(returnFocus.current?.isConnected)returnFocus.current.focus({preventScroll:true});};
  },[preview]);
  useEffect(()=>{
    const root=props.contentRef.current;
    if (!root) return;
    let start: GesturePoint | null=null;
    let end: GesturePoint | null=null;
    let hold: ReturnType<typeof setTimeout> | undefined;
    let previewSequence=false;
    let heldTarget: Element | null=null;
    let heldPoint: GesturePoint | null=null;
    let holdReleased=false;
    let suppressedUntil=0;
    let prepared: string | null=null;
    const clear=()=>{start=null;end=null;previewSequence=false;prepared=null;if(!pendingNavigation.current)setNavigationHint(null);if(hold)clearTimeout(hold);hold=undefined;};
    const available=()=>!latest.current.busy && !pendingNavigation.current && !pendingRef.current && !editingOrDialog() && !selectionActive() && Date.now()>cooldown.current && window.innerWidth<=900;
    const begin=(event: TouchEvent)=>{
      clear();
      if (event.touches.length!==1 || !available() || !(event.target instanceof Element)) return;
      const target=event.target;
      const point=event.touches[0];
      start={x:point.clientX,y:point.clientY,at:Date.now()};end=start;
      const previewTarget=target.closest<HTMLElement>('[data-gesture-preview]');
      const item=previewTarget && latest.current.previews?.find(value=>value.id===previewTarget.dataset.gesturePreview);
      if (item && !previewTarget?.matches(':disabled')) {
        previewSequence=true;
        hold=setTimeout(()=>{
          if (!available()) return;
          heldTarget=previewTarget;heldPoint=start;holdReleased=false;suppressedUntil=Date.now()+1000;
          previewTarget?.focus({preventScroll:true});setPreview([item]);clear();
        },GESTURE.holdMs);
      } else if (blockedSurface(target,root)) clear();
    };
    const move=(event: TouchEvent)=>{
      if (!start) return;
      if (event.touches.length!==1 || !available()) {clear();return;}
      const point=event.touches[0];end={x:point.clientX,y:point.clientY,at:Date.now()};
      const dx=Math.abs(end.x-start.x),dy=Math.abs(end.y-start.y);
      if ((dx>GESTURE.drift || dy>GESTURE.drift) && hold) {clearTimeout(hold);hold=undefined;}
      // Once vertical scrolling starts, a later turn must not navigate.
      if (dy>GESTURE.drift && dy>dx) {clear();return;}
      if (!previewSequence && dx>=GESTURE.intentDistance && dx>=dy*GESTURE.ratio) {
        const direction=end.x<start.x?1:-1;
        const next=adjacentWorkspace(latest.current.activeWorkspace,latest.current.workspaces.map(item=>item.workspace),direction);
        if (next && next!==prepared) {
          prepared=next;
          latest.current.onPrepareNavigation?.(next);
          setNavigationHint({label:latest.current.workspaces.find(item=>item.workspace===next)?.label || next,direction});
        } else if (!next && prepared) {prepared=null;setNavigationHint(null);}
      } else if (prepared) {prepared=null;setNavigationHint(null);}
    };
    const finish=(event: TouchEvent)=>{
      if (heldPoint && event.target instanceof Node && heldTarget?.contains(event.target)) {holdReleased=true;suppressedUntil=Date.now()+400;}
      if (start && end && !previewSequence && available()) {
        const released=event.changedTouches[0];
        const direction=horizontalIntent(start,{x:released?.clientX ?? end.x,y:released?.clientY ?? end.y,at:Date.now()},window.innerWidth);
        const next=adjacentWorkspace(latest.current.activeWorkspace,latest.current.workspaces.map(item=>item.workspace),direction);
        if (next) {
          const label=latest.current.workspaces.find(item=>item.workspace===next)?.label || next;
          pendingNavigation.current=next;
          // Paint the release acknowledgment before rendering a warmed, heavy workspace.
          setNavigationHint({label:`Opening ${label}…`,direction:direction as -1|1});
          setStatus(`Opening ${label}`);
          startTransition(()=>{
            if(latest.current.onNavigate(next)===false){pendingNavigation.current=null;setNavigationHint(null);setStatus('');}
            else{cooldown.current=Date.now()+GESTURE.cooldownMs;}
          });
        }
      }
      clear();
    };
    const suppress=(event: MouseEvent)=>{
      const original=event.target instanceof Node && heldTarget?.contains(event.target);
      // Opening a modal can retarget the originating release-click to its backdrop.
      const releaseBackdrop=holdReleased && event.target===dialog.current && heldPoint && Math.hypot(event.clientX-heldPoint.x,event.clientY-heldPoint.y)<=GESTURE.drift;
      if (Date.now()<suppressedUntil && (original || releaseBackdrop)) {event.preventDefault();event.stopPropagation();suppressedUntil=0;heldPoint=null;}
    };
    const context=(event: MouseEvent)=>{
      if (!(event.target instanceof Element) || !available()) return;
      const target=event.target.closest<HTMLElement>('[data-gesture-preview]');
      const item=target && latest.current.previews?.find(value=>value.id===target.dataset.gesturePreview);
      if(item){event.preventDefault();target?.focus();setPreview([item]);clear();}
    };
    const clearRelease=()=>{suppressedUntil=0;heldPoint=null;heldTarget=null;holdReleased=false;};
    const cancelled=()=>{clear();clearRelease();};
    root.addEventListener('pointerdown',clearRelease,true);
    root.addEventListener('touchstart',begin,{passive:true});root.addEventListener('touchmove',move,{passive:true});
    root.addEventListener('touchend',finish,{passive:true});root.addEventListener('touchcancel',cancelled,{passive:true});
    root.addEventListener('click',suppress,true);root.addEventListener('contextmenu',context);
    window.addEventListener('scroll',clear,true);
    return ()=>{clear();root.removeEventListener('touchstart',begin);root.removeEventListener('touchmove',move);root.removeEventListener('touchend',finish);root.removeEventListener('touchcancel',cancelled);root.removeEventListener('pointerdown',clearRelease,true);root.removeEventListener('click',suppress,true);root.removeEventListener('contextmenu',context);window.removeEventListener('scroll',clear,true);};
  },[props.contentRef]);
  const refresh=async()=>{
    if(!latest.current.onRefresh || latest.current.busy || pendingRef.current || editingOrDialog())return;
    pendingRef.current=true;setPending(true);setStatus('Refreshing displayed data…');
    try{await latest.current.onRefresh();setStatus('Displayed data refreshed');}catch{setStatus('Refresh unavailable. Existing data is still shown.');}
    finally{pendingRef.current=false;setPending(false);}
  };
  return <>
    {navigationHint && <div className={`mobile-navigation-hint ${navigationHint.direction===1?'next':'previous'}`} aria-hidden="true" data-gesture-ignore>{navigationHint.direction===-1 && <span>← </span>}{navigationHint.label}{navigationHint.direction===1 && <span> →</span>}</div>}
    <div className="mobile-interactions" data-gesture-ignore>
      <details><summary>Touch shortcuts</summary><p>Swipe left or right on open page space to change workspace. The workspace menu also works.{!!props.previews?.length && ' Hold a metric for a preview.'}{props.onRefresh && ' Pull the Refresh data button down to update displayed data.'}</p></details>
      {props.onRefresh && <PullAction disabled={props.busy || pending} onAction={()=>void refresh()} label={pending?'Refreshing…':'Refresh data'} />}
      {!!props.previews?.length && <button type="button" disabled={props.busy} onClick={()=>setPreview(props.previews || [])}>Preview metrics</button>}
      <span role="status" className="sr-only">{status}</span>
    </div>
    {preview && <dialog ref={dialog} className="mobile-preview-dialog" aria-labelledby="mobile-preview-title" onCancel={event=>{event.preventDefault();closePreview();}} onClick={event=>{if(event.target===event.currentTarget)closePreview();}}>
      <header><h2 id="mobile-preview-title">Metric preview</h2><button type="button" onClick={closePreview} aria-label="Close metric preview">×</button></header>
      <SheetDismissHandle onDismiss={closePreview} />
      <dl>{preview.map(item=><div key={item.id}><dt>{item.label}</dt><dd><strong>{item.value}</strong>{item.detail && <p>{item.detail}</p>}</dd></div>)}</dl>
    </dialog>}
  </>;
}

/** Pull is confined to an explicit control; page scrolling and zoom remain available. */
function PullAction({label,onAction,disabled=false}: {label:string;onAction:()=>void;disabled?:boolean}) {
  const start=useRef<GesturePoint|null>(null);
  const suppressClick=useRef(0);
  const [ready,setReady]=useState(false);
  const cancel=(suppress=false)=>{if(suppress)suppressClick.current=Date.now()+700;start.current=null;setReady(false);};
  return <button type="button" className="mobile-pull-control" disabled={disabled} aria-label={label}
    onPointerDown={event=>{if(event.pointerType!=='touch'||!event.isPrimary||disabled)return;start.current={x:event.clientX,y:event.clientY,at:Date.now()};event.currentTarget.setPointerCapture(event.pointerId);}}
    onPointerMove={event=>{if(start.current){const dx=Math.abs(event.clientX-start.current.x),dy=event.clientY-start.current.y;if((dx>GESTURE.drift && dx>Math.abs(dy)) || dy < -GESTURE.drift){cancel(true);return;}setReady(downwardIntent(start.current,{x:event.clientX,y:event.clientY,at:Date.now()}));}}}
    onPointerUp={event=>{const moved=start.current && Math.hypot(event.clientX-start.current.x,event.clientY-start.current.y)>GESTURE.drift;const triggered=start.current && downwardIntent(start.current,{x:event.clientX,y:event.clientY,at:Date.now()});cancel(Boolean(moved));if(triggered&&!disabled)onAction();}}
    onPointerCancel={()=>cancel(true)} onLostPointerCapture={()=>cancel()}
    onTouchStart={event=>{if(event.touches.length>1)cancel(true);}}
    onClick={()=>{if(Date.now()>suppressClick.current)onAction();}}>{ready?'Release to '+label.toLowerCase():label}</button>;
}
export function SheetDismissHandle({onDismiss,disabled=false}: {onDismiss:()=>void;disabled?:boolean}) {
  return <div className="mobile-sheet-dismiss" data-gesture-ignore><PullAction label="Close details" onAction={onDismiss} disabled={disabled}/><span aria-hidden="true">Swipe down here to close</span></div>;
}
