/** One synchronous bootstrap for Next pages and the desktop Vite document. */
export const OPS_THEME_BOOTSTRAP = String.raw`(function(){
  if(window.OpsTheme)return;
  var root=document.documentElement,key='opscenter.theme.v1';
  var excluded=/^(waypoint|crew|convoy|kingpin|jobs)\./i.test(location.hostname)||/^\/(crew-jobs|crew-login|set-password|my-pay|truck-inspection)(?:\/|$)/.test(location.pathname);
  if(excluded)return;
  var media=window.matchMedia('(prefers-color-scheme: dark)'),choice='system';
  function valid(value){return value==='light'||value==='dark'||value==='system';}
  try{var saved=localStorage.getItem(key);if(valid(saved))choice=saved;}catch(_){}
  function apply(){
    var resolved=choice==='system'?(media.matches?'dark':'light'):choice;
    root.setAttribute('data-ops-theme',resolved);
    root.style.colorScheme=resolved;
    document.querySelectorAll('meta[name="theme-color"]').forEach(function(meta){meta.content=resolved==='dark'?'#101923':'#f1f3f1';});
    document.querySelectorAll('meta[name="color-scheme"]').forEach(function(meta){meta.content=resolved;});
    root.setAttribute('data-ops-theme-choice',choice);
    window.dispatchEvent(new Event('ops-theme-change'));
  }
  window.OpsTheme={get:function(){return choice;},set:function(value){
    if(!valid(value))return false;
    choice=value;var saved=true;
    try{localStorage.setItem(key,value);}catch(_){saved=false;}
    apply();return saved;
  }};
  if(media.addEventListener)media.addEventListener('change',function(){if(choice==='system')apply();});
  else if(media.addListener)media.addListener(function(){if(choice==='system')apply();});
  document.addEventListener('DOMContentLoaded',apply,{once:true});
  window.addEventListener('storage',function(event){
    if(event.key===key||event.key===null){choice=valid(event.newValue)?event.newValue:'system';apply();}
  });
  apply();
})();`;
