import {isNativeWexSource} from './lib/wex-source';
export function WexSourceLink({source,label}:{source:string;label:string}){
 return isNativeWexSource(source)?<span title={`Private native mail evidence ${source.slice('outlook-local:'.length)}`}>{label} · Apple Mail evidence retained</span>:<a href={source} target="_blank" rel="noreferrer">{label}</a>;
}
