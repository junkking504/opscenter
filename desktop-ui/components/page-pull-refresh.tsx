import {useEffect,useRef,useState,type RefObject} from 'react';
import {createPortal} from 'react-dom';
import {GESTURE} from '../lib/mobile-gestures';
import '../page-pull-refresh.css';

/** Page-top pull only; nested scrollers and interactive surfaces keep ownership. */
export function PagePullRefresh({root,available,pending,status,onRefresh}:{root:RefObject<HTMLElement|null>;available:()=>boolean;pending:boolean;status:string;onRefresh:()=>void}) {
  const latest=useRef({available,onRefresh});latest.current={available,onRefresh};
  const [distance,setDistance]=useState(0);
  useEffect(()=>{
    const node=root.current;if(!node)return;
    let start:{x:number;y:number}|null=null,travel=0,locked=false,suppressUntil=0;
    const cancel=()=>{start=null;travel=0;locked=false;setDistance(0);};
    const top=()=>Math.max(window.scrollY,document.documentElement.scrollTop,document.body.scrollTop)<=1;
    const blocked=(target:Element)=>{
      if(target.closest('input,textarea,select,label,[contenteditable]:not([contenteditable="false"]),[draggable="true"],[data-gesture-ignore],[role="slider"],[role="scrollbar"],[role="separator"],[aria-roledescription="carousel"],canvas,video,audio,iframe,.leaflet-container,.recharts-wrapper,.maplibregl-map,.mapboxgl-map'))return true;
      for(let el:Element|null=target;el;el=el.parentElement){
        const style=getComputedStyle(el);
        if(el!==document.body&&el!==document.documentElement&&((/(auto|scroll)/.test(style.overflowY)&&el.scrollHeight>el.clientHeight+1)||(/(auto|scroll)/.test(style.overflowX)&&el.scrollWidth>el.clientWidth+1)))return true;
      }return false;
    };
    const begin=(event:TouchEvent)=>{
      cancel();suppressUntil=0;
      if(event.touches.length!==1||!latest.current.available()||!top()||!(event.target instanceof Element)||blocked(event.target))return;
      const point=event.touches[0];if(point.clientX<GESTURE.edge||point.clientX>innerWidth-GESTURE.edge)return;
      start={x:point.clientX,y:point.clientY};
    };
    const move=(event:TouchEvent)=>{
      if(!start)return;
      if(event.touches.length!==1||!latest.current.available()||!top()){cancel();return;}
      const point=event.touches[0],dx=Math.abs(point.clientX-start.x),dy=point.clientY-start.y;
      if(dy < -GESTURE.drift||(dx>GESTURE.drift&&dx*GESTURE.ratio>dy)){cancel();return;}
      if(locked){travel=Math.max(0,dy);setDistance(Math.min(travel,GESTURE.distance));}
      if(dy>GESTURE.drift&&dy>=dx*GESTURE.ratio){
        // Never contend with a native gesture that has already taken ownership.
        if(!event.cancelable){cancel();return;}event.preventDefault();locked=true;
        travel=dy;setDistance(Math.min(dy,GESTURE.distance));
      }
    };
    const finish=(event:TouchEvent)=>{
      const released=event.changedTouches[0];
      const dy=start&&released?released.clientY-start.y:travel,dx=start&&released?Math.abs(released.clientX-start.x):0;
      const trigger=Boolean(start&&locked&&dy>=GESTURE.distance&&dy>=dx*GESTURE.ratio&&!event.touches.length&&latest.current.available()&&top());
      if(locked)suppressUntil=Date.now()+700;
      cancel();if(trigger)latest.current.onRefresh();
    };
    const suppress=(event:MouseEvent)=>{if(Date.now()<suppressUntil&&event.detail!==0){event.preventDefault();event.stopImmediatePropagation();suppressUntil=0;}};
    const fresh=()=>{suppressUntil=0;};
    const scroll=()=>{if(!top())cancel();};
    node.setAttribute('data-page-pull-ready','true');
    node.addEventListener('touchstart',begin,{passive:true});node.addEventListener('touchmove',move,{passive:false});
    node.addEventListener('touchend',finish,{passive:true});node.addEventListener('touchcancel',cancel,{passive:true});
    document.addEventListener('click',suppress,true);document.addEventListener('pointerdown',fresh,true);window.addEventListener('scroll',scroll,true);
    return()=>{node.removeAttribute('data-page-pull-ready');node.removeEventListener('touchstart',begin);node.removeEventListener('touchmove',move);node.removeEventListener('touchend',finish);node.removeEventListener('touchcancel',cancel);document.removeEventListener('click',suppress,true);document.removeEventListener('pointerdown',fresh,true);window.removeEventListener('scroll',scroll,true);};
  },[root]);
  const failed=status.startsWith('Refresh unavailable');
  if(!distance&&!pending&&!failed)return null;
  return createPortal(<div className="mobile-navigation-hint page-pull-refresh" role="status" data-gesture-ignore aria-live="polite"><span className={pending?'page-refresh-spinner spinning':'page-refresh-spinner'} aria-hidden="true">{pending?'':failed?'!':'↓'}</span><span>{pending?'Refreshing…':failed?'Refresh failed · showing saved data':distance>=GESTURE.distance?'Release to refresh':'Pull to refresh'}</span></div>,document.body);
}
