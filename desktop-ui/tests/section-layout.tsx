import {createRoot} from 'react-dom/client';
import {useState} from 'react';
import {SectionLayout, SectionLayoutProvider} from '../section-layout';
import '../design-tokens.css';
function Fixture() {
  const [page,setPage]=useState('one'),[busy,setBusy]=useState(false),[extra,setExtra]=useState(false),[count,setCount]=useState(0);
  return <><button onClick={()=>setPage(page==='one'?'two':'one')}>Switch page</button><button onClick={()=>setBusy(!busy)}>Toggle busy</button><button onClick={()=>setExtra(!extra)}>Toggle extra</button>
    <SectionLayoutProvider page={page} busy={busy}><SectionLayout group="example" style={{display:'grid',gap:12,margin:20}}>
      <header>Fixed heading</header>
      <section data-layout-id="alpha" aria-label="Alpha" style={{border:'1px solid',minHeight:140}}><h2>Alpha</h2><input aria-label="Unsaved note"/><button onClick={()=>setCount(count+1)}>Count {count}</button></section>
      <section data-layout-id="beta" aria-label="Beta" style={{border:'1px solid',minHeight:140}}><h2>Beta</h2><button>Inside beta</button></section>
      {extra && <section data-layout-id="extra" aria-label="Extra"><h2>Extra</h2></section>}
      <section data-layout-id="gamma" aria-label="Gamma" style={{border:'1px solid',minHeight:140}}><h2>Gamma</h2></section>
    </SectionLayout></SectionLayoutProvider></>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
