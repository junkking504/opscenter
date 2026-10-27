import { useLayoutEffect, type RefObject } from 'react';

/** Affix the existing input, not a duplicate: queries, focus and selection survive scrolling. */
export function usePinnedSearch(ref: RefObject<HTMLDivElement | null>, {
  slotSelector='.live-search-below-day', contentSelector='.ops-content', fieldSelector='.global-search',
}: {slotSelector?:string;contentSelector?:string;fieldSelector?:string} = {}) {
  useLayoutEffect(() => {
    const shell=ref.current, slot=shell?.closest<HTMLElement>(slotSelector);
    const content=slot?.closest<HTMLElement>(contentSelector);
    if (!shell || !slot || !content) return;
    const mobile=content.querySelector<HTMLElement>('.live-mobile-navigation');
    const field=shell.querySelector<HTMLElement>(fieldSelector);
    if (!field) return;
    let frame=0;
    const set=(node:HTMLElement,key:string,value:string)=>{if(node.style.getPropertyValue(key)!==value)node.style.setProperty(key,value);};
    const measure=()=>{
      frame=0;
      const viewport=window.visualViewport;
      const viewportTop=viewport?.offsetTop || 0;
      const viewportBottom=viewportTop+(viewport?.height || window.innerHeight);
      const nav=mobile?.getClientRects().length ? mobile.getBoundingClientRect() : null;
      const navHeight=nav?.height || 0;
      if (!slot.getClientRects().length) {
        delete shell.dataset.searchPinned; delete slot.dataset.searchAffixed;
        set(document.documentElement,'--ops-sticky-height',`${navHeight}px`);
        return;
      }
      const box=slot.getBoundingClientRect(), bounds=content.getBoundingClientRect();
      const top=Math.max(viewportTop,nav ? Math.min(nav.height+viewportTop,Math.max(viewportTop,nav.bottom)) : viewportTop);
      const fieldHeight=field.getBoundingClientRect().height;
      const padding=getComputedStyle(slot);
      set(slot,'--search-slot-height',`${fieldHeight+parseFloat(padding.paddingTop)+parseFloat(padding.paddingBottom)}px`);
      const pinned=box.top<=top;
      shell.dataset.searchPinned=String(pinned);
      slot.dataset.searchAffixed=String(pinned);
      set(shell,'--search-pin-top',`${top}px`);
      const viewportLeft=viewport?.offsetLeft || 0;
      const left=Math.max(bounds.left,viewportLeft);
      const right=Math.min(bounds.right,viewportLeft+(viewport?.width || window.innerWidth));
      set(shell,'--search-pin-left',`${left}px`);
      set(shell,'--search-pin-width',`${Math.max(0,right-left)}px`);
      // Insets belong to the fixed search strip; preserve the original grid slot.
      set(document.documentElement,'--ops-sticky-height',`${navHeight+fieldHeight+17}px`);
      const fieldBox=field.getBoundingClientRect();
      set(shell,'--search-results-height',`${Math.max(0,viewportBottom-fieldBox.bottom-12)}px`);
    };
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure);};
    const resize=new ResizeObserver(schedule);
    resize.observe(slot);resize.observe(content);resize.observe(field);if(mobile)resize.observe(mobile);
    window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule);
    window.visualViewport?.addEventListener('resize',schedule);window.visualViewport?.addEventListener('scroll',schedule);
    measure();
    return()=>{
      resize.disconnect();cancelAnimationFrame(frame);window.removeEventListener('scroll',schedule);window.removeEventListener('resize',schedule);
      window.visualViewport?.removeEventListener('resize',schedule);window.visualViewport?.removeEventListener('scroll',schedule);
      delete shell.dataset.searchPinned;delete slot.dataset.searchAffixed;slot.style.removeProperty('--search-slot-height');
      document.documentElement.style.removeProperty('--ops-sticky-height');
    };
  },[ref,slotSelector,contentSelector,fieldSelector]);
}

/** Direct alert scrolls must reserve the eventual pinned strip, even before it affixes. */
export function stickyHeaderOffset() {
  return Math.max(0,parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--ops-sticky-height')) || 0);
}
