import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import SpecOps from '../specops';
function Preview(){const [workspace,setWorkspace]=useState('SpecOps');return <main style={{maxWidth:1300,margin:'0 auto',padding:16,fontFamily:'Arial'}}><h1>{workspace}</h1>{workspace==='SpecOps'?<SpecOps navigate={setWorkspace}/>:<button onClick={()=>setWorkspace('SpecOps')}>Return to SpecOps</button>}</main>}
createRoot(document.getElementById('root')!).render(<Preview/>);
