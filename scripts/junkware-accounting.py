#!/usr/bin/env python3
"""Native JunkWare accounting adapter. No QBO API writes or automatic replay."""
import contextlib
import datetime as dt
import fcntl
import hashlib
from html.parser import HTMLParser
import http.cookiejar
import json
import os
from pathlib import Path
import re
import sys
import urllib.parse
import urllib.request

URL = 'https://junkware.junk-king.com/franchise/accounting/update-quickbooks.aspx'
PREFIX = 'ctl00$Content$'
DATA = Path(os.environ.get('OPSBOT_DATA_DIR', str(Path.home()/'.openclaw/workspace/opsbot/data')))
STORE = Path(os.environ.get('OPSCENTER_ACCOUNTING_DIR', str(DATA/'accounting-actions')))
ACTIONS = {'update': 'UpdateQuickBooksBtn', 'verify': 'UpdateQuickBooksBtn', 'exclude': 'ExcludeFromQBBtn'}

def now(): return dt.datetime.now(dt.timezone.utc).isoformat()
def clean(s): return ' '.join(s.split())
def digest(value): return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
def identity(row):
    value={k:row[k] for k in ('appointmentId','jkNumber','date','amount','method','customer','billingEmail','email','crew')}
    value['amount']=float(value['amount'])
    return value
def row_key(row): return digest(identity(row))

def save(file, value):
    file.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    tmp=file.with_suffix('.tmp')
    with open(tmp, 'w', opener=lambda p,f:os.open(p,f,0o600)) as stream:
        json.dump(value, stream); stream.flush(); os.fsync(stream.fileno())
    os.replace(tmp,file)
    fd=os.open(file.parent,os.O_RDONLY)
    try: os.fsync(fd)
    finally: os.close(fd)

class Form(HTMLParser):
    def __init__(self, html):
        super().__init__(); self.fields={}; self.options={}; self.controls={}; self.rows=[]; self.labels={}; self.select=None; self.option=None; self.row=None; self.cell=None; self.span=None
        self.empty = bool(re.search(r'<div>\s*No records found\.\s*</div>', html))
        self.feed(html)
        for r in self.rows:
            c=r.pop('cells')
            if len(c)!=9 or not re.fullmatch(r'JK\d+',c[2]): raise ValueError('JunkWare accounting columns changed.')
            if not re.fullmatch(r'\$[\d,]+\.\d{2}',c[3]): raise ValueError('JunkWare amount is unavailable.')
            r.update(date=dt.datetime.strptime(c[1],'%m/%d/%Y').date().isoformat(),jkNumber=c[2],amount=round(float(c[3].replace('$','').replace(',','')),2),method=c[4],customer=c[5],billingEmail=c[6],email=c[7],crew=re.sub(r'\s+edit$','',c[8]))
            r['key']=row_key(r)
    def handle_starttag(self,tag,attrs):
        a=dict(attrs); name=a.get('name',''); id=a.get('id','')
        if tag=='tr' and id.endswith('_ItemRow'): self.row={'cells':[], 'appointmentId':'', 'checkbox':''}
        if self.row is not None:
            if tag=='td': self.cell=''
            if tag=='a' and 'appointment.aspx?id=' in a.get('href',''): self.row['appointmentId']=re.search(r'id=(\d+)',a['href'])[1]
            if tag=='input' and a.get('type')=='checkbox': self.row['checkbox']=name
        if tag=='input' and name:
            self.controls[name]=a
            if a.get('type','text') not in ('checkbox','submit','image','button'): self.fields[name]=a.get('value','')
        if tag=='select': self.select=name; self.options[name]=[]
        if tag=='option' and self.select:
            self.option={'value':a.get('value',''),'label':''}
            if 'selected' in a or self.select not in self.fields: self.fields[self.select]=self.option['value']
        if tag=='span' and id: self.span=id; self.labels[id]=''
    def handle_data(self,data):
        if self.cell is not None: self.cell+=data
        if self.option is not None: self.option['label']+=data
        if self.span: self.labels[self.span]+=data
    def handle_endtag(self,tag):
        if tag=='td' and self.row is not None and self.cell is not None: self.row['cells'].append(clean(self.cell)); self.cell=None
        if tag=='tr' and self.row is not None: self.rows.append(self.row); self.row=None
        if tag=='option' and self.option is not None:
            self.option['label']=clean(self.option['label']); self.options[self.select].append(self.option); self.option=None
        if tag=='select': self.select=None
        if tag=='span': self.span=None
    def label(self,suffix):
        values=[clean(v) for k,v in self.labels.items() if k.endswith(suffix)]
        if len(values)!=1: raise ValueError('JunkWare pagination or message control changed.')
        return values[0]

def validate_filters(f):
    start=dt.date.fromisoformat(f['from']); end=dt.date.fromisoformat(f['to'])
    if end<start or (end-start).days>92: raise ValueError('Choose a date range of up to 93 days.')
    if f.get('status') not in ('U','S','E'): raise ValueError('Choose Unsynced, Synced or Excluded.')
    return {k:str(f.get(k,'')) for k in ('from','to','group','method','status')}

class Source:
    def __init__(self):
        state=json.loads((DATA/'protected/junkware_storage_state.json').read_text())
        jar=http.cookiejar.CookieJar()
        for c in state['cookies']:
            if c['domain'].lstrip('.')!='junkware.junk-king.com' or c['name']=='ASP.NET_SessionId': continue
            jar.set_cookie(http.cookiejar.Cookie(0,c['name'],c['value'],None,False,c['domain'],True,c['domain'].startswith('.'),c['path'],True,c['secure'],None,True,None,None,{},False))
        self.opener=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))
    def request(self, fields=None):
        req=urllib.request.Request(URL, data=urllib.parse.urlencode(fields).encode() if fields is not None else None, headers={'User-Agent':'OpsCenter Accounting','Referer':URL})
        with self.opener.open(req,timeout=50) as response:
            if response.url.split('?')[0]!=URL: raise ValueError('JunkWare sign-in needs refreshing. No accounting result confirmed.')
            form=Form(response.read().decode('utf-8'))
        if PREFIX+'StatusDD' not in form.options: raise ValueError('JunkWare accounting is unavailable.')
        return form
    def filtered(self,f):
        form=self.request(); fields=dict(form.fields)
        for key,control in [('group','ServiceProviderGroupDD'),('method','PaymentMethodDD'),('status','StatusDD')]:
            if f[key] not in [v['value'] for v in form.options[PREFIX+control]]: raise ValueError('A JunkWare filter is no longer available.')
            fields[PREFIX+control]=f[key]
        for key,control in [('from','FromDateTB'),('to','ToDateTB')]: fields[PREFIX+control]=dt.date.fromisoformat(f[key]).strftime('%m/%d/%Y')
        fields['__EVENTTARGET']=''; fields['__EVENTARGUMENT']=''; fields[PREFIX+'SubmitBtn']='Submit'
        result=self.request(fields)
        for control in ('ServiceProviderGroupDD','PaymentMethodDD','StatusDD','FromDateTB','ToDateTB'):
            if result.fields.get(PREFIX+control)!=fields[PREFIX+control]: raise ValueError('JunkWare did not retain the requested filters.')
        return result
    def pages(self,f):
        form=self.filtered(f); seen=set()
        for _ in range(100):
            if form.empty and not form.rows:
                yield form
                return
            current=int(form.label('CurrentPageLbl')); total=int(form.label('TotalPagesLbl'))
            if current in seen or total>100: raise ValueError('JunkWare accounting coverage is incomplete. Narrow the date range.')
            seen.add(current); yield form
            if current==total or total==0: return
            nexts=[k for k in form.controls if k.endswith('$NextPageBtn')]
            if len(nexts)!=1: raise ValueError('JunkWare next page is unavailable.')
            fields=dict(form.fields); fields.update({'__EVENTTARGET':'','__EVENTARGUMENT':'',nexts[0]+'.x':'1',nexts[0]+'.y':'1'})
            form=self.request(fields)
        raise ValueError('JunkWare accounting coverage is incomplete.')
    def find(self,row,status):
        f={'from':row['date'],'to':row['date'],'group':'A','method':'','status':status}; hits=[]
        for form in self.pages(f):
            for candidate in form.rows:
                if candidate['appointmentId']==row['appointmentId'] and candidate['jkNumber']==row['jkNumber']: hits.append((form,candidate))
        if len(hits)!=1: raise ValueError('The selected source record is missing or ambiguous. Refresh the register.')
        form,candidate=hits[0]
        if row_key(candidate)!=row['key']: raise ValueError('The source amount, method or job details changed. Review the refreshed record.')
        return form,candidate
    def submit(self,form,row,action):
        button=PREFIX+ACTIONS[action]
        if button not in form.controls or not row['checkbox']: raise ValueError('The JunkWare accounting action is unavailable.')
        fields=dict(form.fields); fields.update({'__EVENTTARGET':'','__EVENTARGUMENT':'', row['checkbox']:'on',PREFIX+'SelectedRecordCountHF':'1',button:form.controls[button]['value']})
        return self.request(fields)

def receipts():
    return [json.loads(file.read_text()) for file in sorted((STORE/'receipts').glob('*.json'))] if (STORE/'receipts').exists() else []

def annotations():
    result={}
    for receipt in sorted(receipts(), key=lambda r:r['createdAt']):
        for item in receipt['items']:
            if receipt['action']=='verify' and item.get('verifiedAt'):
                result[item['row']['key']]={'verifiedAt':item['verifiedAt'],'actor':receipt['actor'],'synced':item['state']=='verified','row':identity(item['row'])}
    return result

def listing(source,filters):
    f=validate_filters(filters); rows=[]; options=None; keys=set(); marks=annotations()
    for form in source.pages(f):
        if options is None: options={key:form.options[PREFIX+name] for key,name in [('groups','ServiceProviderGroupDD'),('methods','PaymentMethodDD'),('statuses','StatusDD')]}
        for row in form.rows:
            if row['key'] in keys: raise ValueError('Duplicate source rows require review in JunkWare.')
            keys.add(row['key']); rows.append({**{k:v for k,v in row.items() if k!='checkbox'},'syncStatus':f['status'],'verification':marks.get(row['key'])})
    pending=[{'id':r['id'],'action':r['action'],'items':r['items']} for r in receipts() if any(i['state'] in ('pending','submitted','uncertain') for i in r['items'])]
    return {'rows':rows,'options':options,'observedAt':now(),'total':round(sum(r['amount'] for r in rows),2),'verifications':marks,'pending':pending}

def execute(source,body,actor,verify_only=False):
    request_id=body.get('requestId','')
    if not re.fullmatch(r'[a-f0-9-]{36}',request_id): raise ValueError('A valid request identity is required.')
    STORE.mkdir(mode=0o700,parents=True,exist_ok=True)
    with open(STORE/'action.lock','a') as lock:
        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError: raise ValueError('An accounting action is running. Check its saved result.')
        file=STORE/'receipts'/f'{request_id}.json'
        if file.exists():
            receipt=json.loads(file.read_text())
            if not verify_only and receipt['fingerprint']!=digest({'action':body.get('action'),'rows':body.get('rows'),'actor':actor}): raise ValueError('This request identity already belongs to another action.')
            # Repeated POSTs only return the durable receipt. Explicit recovery is read-only.
            if not verify_only: return receipt
        else:
            if verify_only: return {'id':request_id,'action':'update','items':[],'complete':False,'message':'No accounting action was recorded. Nothing was submitted for this request; refresh the register and review again.'}
            action=body.get('action'); rows=body.get('rows',[])
            if action not in ACTIONS or not isinstance(rows,list) or not 1<=len(rows)<=50: raise ValueError('Choose 1–50 records and an accounting action.')
            if len({r['key'] for r in rows})!=len(rows): raise ValueError('Duplicate selected records.')
            for row in rows:
                if row['key']!=row_key(row) or row.get('syncStatus') not in ('U','S','E'): raise ValueError('Refresh the source record before selecting it.')
                if action=='verify' and not re.match(r'^(Cash|Check)\b',row['method'],re.I): raise ValueError('Payment verification is for cash and checks only.')
                if action=='exclude' and row['syncStatus']!='U': raise ValueError('Only unsynced records can be excluded here.')
                if action=='update' and row['syncStatus']!='U': raise ValueError('Only unsynced records can be updated here.')
                if action=='verify' and row['syncStatus']=='E': raise ValueError('This record is excluded in JunkWare. Review it there before updating QuickBooks.')
            ids={r['appointmentId'] for r in rows}
            for old in receipts():
                if any(i['row']['appointmentId'] in ids and i['state'] in ('pending','submitted','uncertain') for i in old['items']): raise ValueError('A selected job has an unresolved accounting action. Check saved result first.')
            receipt={'id':request_id,'action':action,'actor':actor,'createdAt':now(),'fingerprint':digest({'action':action,'rows':rows,'actor':actor}),'items':[{'row':r,'state':'pending'} for r in rows]}
            save(file,receipt)
        for item in receipt['items']:
            if item['state'] in ('verified','failed','not_attempted'): continue
            row=item['row']; action=receipt['action']; target='E' if action=='exclude' else 'S'
            try:
                if not verify_only and not item.get('submittedAt'):
                    form,current=source.find(row,row['syncStatus'])
                    if action=='verify': item['verifiedAt']=now(); save(file,receipt)
                    if row['syncStatus']!=target:
                        # Durable intent precedes the only source submission. Process loss cannot replay it.
                        item.update(state='submitted',submittedAt=now()); save(file,receipt)
                        try:
                            response=source.submit(form,current,action)
                            item['sourceMessage']=response.label('MessageLbl')[:500]; save(file,receipt)
                        except Exception: pass
                source.find(row,target)
                item.update(state='verified',syncedAt=now(),message='Excluded in JunkWare.' if target=='E' else 'JunkWare confirms this record is synced to QuickBooks.')
            except Exception as error:
                item.update(state='uncertain' if item.get('submittedAt') else 'failed',message=str(error))
                # Stop batch after the first failure; never hide partial completion.
                if not verify_only:
                    for remaining in receipt['items']:
                        if remaining is not item and remaining['state']=='pending': remaining.update(state='not_attempted',message='Not submitted because an earlier record needs review.')
                save(file,receipt)
                if not verify_only: break
            save(file,receipt)
        receipt['complete']=all(i['state']=='verified' for i in receipt['items']); save(file,receipt)
        return receipt

def main():
    body=json.load(sys.stdin); mode=body.get('mode'); source=Source()
    if mode=='list': return listing(source,body['filters'])
    if mode in ('action','recover'): return execute(source,body,body['actor'],mode=='recover')
    raise ValueError('Unknown accounting operation.')

if __name__=='__main__':
    try: print(json.dumps({'ok':True,'data':main()}))
    except Exception as error: print(json.dumps({'ok':False,'error':str(error)[:500]})); sys.exit(1)
