import type { readJobRows } from './desktop-schedule-source';
import type { EssentialFact } from './operational-alert-presentation';

type Job = ReturnType<typeof readJobRows>[number];
const money = (amount: number) => amount.toLocaleString('en-US', {style:'currency',currency:'USD'});

export function crewAppointmentFacts(job: Job): EssentialFact[] {
  const present = (value: string) => value.trim() && value.trim() !== '—' ? value.trim() : '';
  const phone = present(job.phone), email = present(job.customerEmail), address = present(job.address);
  return [
    {label:'Customer',value:present(job.customerName) || 'Not provided'},
    {label:'Phone',value:phone || 'Not provided',...(phone ? {href:`tel:${phone.replace(/[^\d+]/g,'')}`} : {})},
    {label:'Email',value:email || (job.customerEmailCollected ? 'Not provided' : 'Unavailable'),...(email ? {href:`mailto:${email}`} : {})},
    {label:'Service address',value:address || 'Not provided',...(address ? {href:`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`} : {})},
    {label:'Pickup items',value:(job.pickupItems?.length ? job.pickupItems : job.junkItems).join('; ') || 'Not listed'},
    {label:'Appointment notes',value:job.appointmentNotes.join('\n') || 'No notes available'},
  ];
}

export function crewPaymentFacts(job: Job): EssentialFact[] {
  const facts = (job.closeout?.payments || []).map(payment => {
    const method = payment.method.trim() || 'Payment';
    const detail = payment.detail.trim();
    let label = method;
    if (/check/i.test(method)) {
      const reference = detail.replace(/^(?:check\s*)?(?:number|no\.?)?\s*#?\s*/i, '').trim();
      label = reference ? `Check #${reference}` : 'Check · number unavailable';
    } else if (/card|credit|debit|visa|master|amex|american express|discover/i.test(method)) {
      const lastFour = detail.match(/(\d{4})(?!.*\d)/)?.[1];
      label = `${method} · ${lastFour ? `ending ${lastFour}` : 'last four unavailable'}`;
    }
    return {label, value:Number.isFinite(payment.amount) ? money(payment.amount) : 'Amount unavailable'};
  });
  const tips = job.closeout?.tip ?? job.tipAmount;
  if (Number.isFinite(tips) && tips > 0) facts.push({label:'Tips',value:money(tips)});
  return facts;
}

export function crewCloseoutFacts(job: Job): EssentialFact[] {
  const closeout = job.closeout;
  if (!closeout) return [];
  const facts: EssentialFact[] = [];
  for (const [label, size, quantity, price] of [
    ['Load', closeout.loadSize, closeout.loadQuantity, closeout.loadPrice],
    ['Bedload', closeout.bedloadSize, closeout.bedloadQuantity, closeout.bedloadPrice],
  ] as const) {
    if (size || price > 0) facts.push({label, value:`${quantity > 1 ? `${quantity} × ` : ''}${size || 'Size unavailable'} · ${money(price)}`});
  }
  for (const charge of closeout.otherCharges) {
    facts.push({label:`${charge.quantity > 1 ? `${charge.quantity} × ` : ''}${charge.name}`,value:money(charge.total)});
  }
  if (closeout.discount > 0) facts.push({label:'Discount',value:`−${money(closeout.discount)}`});
  if (!facts.length) facts.push({label:'Load and charges',value:'Not recorded'});
  return facts;
}
