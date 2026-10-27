import { useEffect } from 'react';
import './alert-navigation.css';
import { stickyHeaderOffset } from './use-pinned-search';

/** One bounded reveal per navigation, after the real destination is mounted.
 * User movement or newer navigation cancels pending work; refreshes never scroll again. */
export function useAlertReveal() {
  useEffect(() => {
    const identity=()=>{const p=new URLSearchParams(window.location.search);return JSON.stringify(['workspace','date','focus','truck','appointment','q','member','alert'].map(k=>p.get(k)));};
    const initial=identity();
    const params=new URLSearchParams(window.location.search), focus=params.get('focus');
    if (!focus) return;
    let done=false, frame=0;
    const stop=()=>{done=true; observer.disconnect(); window.clearTimeout(timeout); cancelAnimationFrame(frame);};
    const reveal=()=>{
      if(done || initial!==identity()) return;
      let target:HTMLElement|null=null;
      if(focus==='truck') target=document.querySelector('[data-alert-ready="truck"]');
      else if(focus==='alert') target=Array.from(document.querySelectorAll<HTMLElement>('[data-alert-id]')).find(el=>el.dataset.alertId===params.get('alert')) || null;
      else if(focus==='record') target=document.querySelector<HTMLElement>('.record-drawer, .schedule-link-notice, .live-krewe .drawer-action-feedback, .live-fleet .drawer-action-feedback')
        || (!params.has('appointment')&&!params.has('q')&&!params.has('truck')&&!params.has('member') ? document.querySelector<HTMLElement>('.live-krewe .crew-today-roster, .live-krewe table, #schedule-all-appointments') : null);
      if(!target || !target.getClientRects().length) return;
      if(target instanceof HTMLDetailsElement) target.open=true;
      const element=target;
      done=true; observer.disconnect(); window.clearTimeout(timeout);
      frame=requestAnimationFrame(()=>{
        if(initial!==identity())return;
        const mobile=document.querySelector<HTMLElement>('.live-mobile-navigation');
        const header=mobile?.getClientRects().length ? mobile : document.querySelector<HTMLElement>('.topbar');
        const offset=Math.max(12,stickyHeaderOffset()+12,header ? Math.min(header.getBoundingClientRect().bottom,140)+12 : 12);
        if(!element.classList.contains('record-drawer')) window.scrollBy({top:element.getBoundingClientRect().top-offset,behavior:'instant'});
        element.classList.add('alert-target-highlight');
        window.setTimeout(()=>element.classList.remove('alert-target-highlight'),2200);
      });
    };
    const observer=new MutationObserver(reveal);
    const timeout=window.setTimeout(stop,30000);
    observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['data-alert-ready','class']});
    const key=(event:KeyboardEvent)=>{if(['PageDown','PageUp','Home','End','ArrowDown','ArrowUp',' '].includes(event.key))stop();};
    window.addEventListener('keydown',key);
    window.addEventListener('wheel',stop,{passive:true,once:true}); window.addEventListener('touchmove',stop,{passive:true,once:true});
    window.addEventListener('popstate',stop,{once:true}); window.addEventListener('pagehide',stop,{once:true});
    reveal();
    return ()=>{stop(); window.removeEventListener('keydown',key); window.removeEventListener('wheel',stop);window.removeEventListener('touchmove',stop);window.removeEventListener('popstate',stop);window.removeEventListener('pagehide',stop);};
  },[]);
}
