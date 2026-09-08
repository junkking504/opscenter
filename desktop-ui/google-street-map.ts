import L from 'leaflet';

// Google road geometry is rendered only over a Google basemap. The key and
// session stay on the server; browser URLs contain ordinary tile coordinates.
export function installGoogleStreetMap(view:L.Map){
  const tiles=L.tileLayer('/api/desktop/map?kind=tile&z={z}&x={x}&y={y}',{maxZoom:20,keepBuffer:0,updateWhenIdle:true,noWrap:true});
  const status=new L.Control({position:'bottomleft'}),notice=document.createElement('div');
  notice.className='street-map-status';notice.setAttribute('role','status');notice.textContent='Loading street map…';
  Object.assign(notice.style,{background:'#fff',padding:'4px 8px',fontSize:'11px',color:'#334155',borderRadius:'4px'});
  status.onAdd=()=>notice;status.addTo(view);
  // Compact schedule maps use Google's permitted text attribution. The full
  // viewport copyright is escaped and displayed alongside it, never replaced.
  view.attributionControl.addAttribution('Google Maps');
  let copyright='',timer:ReturnType<typeof setTimeout>|undefined,abort:AbortController|null=null,disposed=false;
  const update=async()=>{
    abort?.abort();abort=new AbortController();
    const bounds=view.getBounds(),wrap=(n:number)=>((n+180)%360+360)%360-180;
    const wide=bounds.getEast()-bounds.getWest()>=360;
    const params=new URLSearchParams({kind:'viewport',zoom:String(view.getZoom()),north:String(Math.min(90,bounds.getNorth())),south:String(Math.max(-90,bounds.getSouth())),east:String(wide?180:wrap(bounds.getEast())),west:String(wide?-180:wrap(bounds.getWest()))});
    const request=abort;
    try{
      const response=await fetch(`/api/desktop/map?${params}`,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(20_000)])});
      const payload=await response.json();
      if(!response.ok || typeof payload.copyright!=='string')throw new Error('Map unavailable');
      if(disposed || request.signal.aborted)return;
      const escaped=document.createElement('span');escaped.textContent=payload.copyright;
      if(copyright)view.attributionControl.removeAttribution(copyright);
      copyright=escaped.innerHTML;view.attributionControl.addAttribution(copyright);
      if(!view.hasLayer(tiles))tiles.addTo(view);
      notice.hidden=true;
    }catch{
      if(disposed || request.signal.aborted)return;
      notice.hidden=false;notice.textContent='Street map unavailable · retrying…';
      // Do not leave tiles on a new viewport without its required attribution.
      if(view.hasLayer(tiles))view.removeLayer(tiles);
    }
  };
  const schedule=()=>{clearTimeout(timer);timer=setTimeout(()=>void update(),200);};
  const tileError=()=>{notice.hidden=false;notice.textContent='Some street tiles unavailable · retrying…';};
  tiles.on('tileerror',tileError);
  view.on('moveend',schedule);schedule();
  const retry=setInterval(()=>{if(!notice.hidden){tiles.redraw();void update();}},30_000);
  return()=>{disposed=true;abort?.abort();clearTimeout(timer);clearInterval(retry);view.off('moveend',schedule);tiles.off('tileerror',tileError);};
}
