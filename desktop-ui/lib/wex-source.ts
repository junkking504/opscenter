// Native mail references identify private evidence retained by the collector.
// They are deliberately not invented Outlook URLs or executable links.
export function isNativeWexSource(value:string){return /^outlook-local:[a-f0-9]{64}$/.test(value);}
export function isWexSource(value:string){
 if(isNativeWexSource(value))return true;
 try{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&['outlook.office365.com','outlook.office.com','outlook.live.com'].includes(url.hostname);}catch{return false;}
}
