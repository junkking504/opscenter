'use client';
import {useRef,useState,type PointerEvent} from 'react';
import {parseSignature,type SignatureDrawing} from '../lib/amazon-closeout';

export default function SignaturePad({value,onChange,disabled=false}:{value:SignatureDrawing|null;onChange:(value:SignatureDrawing|null)=>void;disabled?:boolean}) {
  const active=useRef<number|null>(null);
  const strokes=useRef<SignatureDrawing['strokes']>(value?.strokes || []);
  const [error,setError]=useState('');
  const point=(event:PointerEvent<SVGSVGElement>):[number,number]=>{
    const rect=event.currentTarget.getBoundingClientRect();
    return [Math.round(Math.max(0,Math.min(600,(event.clientX-rect.left)/rect.width*600))),Math.round(Math.max(0,Math.min(200,(event.clientY-rect.top)/rect.height*200)))];
  };
  const publish=()=>onChange({strokes:strokes.current.map(stroke=>[...stroke])});
  return <div className="closeout-signature-pad">
    <p>Have the customer sign below with a finger, stylus, or mouse.</p>
    <svg viewBox="0 0 600 200" preserveAspectRatio="none" role="img" aria-label="Customer signature drawing area" style={{display:'block',width:'100%',height:200,background:'white',border:'1px solid #777',borderRadius:8,touchAction:'none'}}
      onPointerDown={event=>{if(disabled || active.current!==null)return;event.preventDefault();setError('');strokes.current=value?.strokes.map(stroke=>[...stroke]) || [];if(strokes.current.length>=100){setError('Clear the signature and sign again.');return;}active.current=event.pointerId;event.currentTarget.setPointerCapture(event.pointerId);strokes.current.push([point(event)]);publish();}}
      onPointerMove={event=>{if(disabled || active.current!==event.pointerId)return;const count=strokes.current.reduce((sum,stroke)=>sum+stroke.length,0);if(count>=2000){setError('The signature is too large. Clear it and sign again.');return;}strokes.current.at(-1)!.push(point(event));publish();}}
      onPointerUp={event=>{if(active.current!==event.pointerId)return;active.current=null;event.currentTarget.releasePointerCapture(event.pointerId);try{parseSignature({strokes:strokes.current});}catch(error){setError((error as Error).message);}}}
      onPointerCancel={()=>{active.current=null;}}>
      {(value?.strokes || []).map((stroke,index)=><polyline key={index} points={stroke.map(point=>point.join(',')).join(' ')} fill="none" stroke="#111" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>)}
    </svg>
    <button type="button" disabled={disabled || !value} onClick={()=>{active.current=null;strokes.current=[];onChange(null);setError('');}}>Clear signature</button>
    {error && <p role="alert">{error}</p>}
  </div>;
}
