export function desktopWorkItemHref(item: { operatingDate: string; category: string; entity: { type: string; id: string; label?: string } }) {
  const workspace = item.entity.type==='job'?'Schedule':item.entity.type==='employee'?'Krewe':item.entity.type==='truck'?'Fleet':item.category==='Finance'?'Finance':'Command';
  const params = new URLSearchParams({data:'live',date:item.operatingDate,workspace});
  if(item.entity.type==='job') {
    if(/^\d+$/.test(item.entity.id)||/^\d{4}-\d{2}-\d{2}:appointment:\d+$/.test(item.entity.id)) params.set('appointment',item.entity.id);
    else params.set('job',item.entity.label||item.entity.id); // Ambiguous JK references remain a filtered choice.
  }
  if(item.entity.type==='employee') params.set('member',item.entity.label||item.entity.id);
  if(item.entity.type==='truck') params.set('truck',item.entity.id);
  if(workspace==='Command') params.set('commandView','today');
  return `/desktop?${params}`;
}
