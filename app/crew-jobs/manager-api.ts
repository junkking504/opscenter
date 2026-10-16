export const managerUrl=(resource:string,query:Record<string,string>={})=>'/api/crew-jobs/manager?'+new URLSearchParams({resource,...query});
export async function managerRequest(resource:string,body?:unknown,query:Record<string,string>={}){
 const response=await fetch(managerUrl(resource,query),{cache:'no-store',...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
 const result=await response.json();if(!response.ok)throw new Error(result.error || 'The action could not be verified. Check its saved result before retrying.');return result;
}
