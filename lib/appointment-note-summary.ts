/** Condense source notes for operational alerts; the original record retains the full history. */
export function summarizeAppointmentNotes(notes: string[]): string[] {
  let etaRequested = false;
  let callCenter = false;
  let callbackRequested = false;
  let callbackTiming = false;
  const details: string[] = [];
  const clean = (value: string) => value.replace(/\s+/g, ' ').trim();
  for (const original of notes) {
    let note = original
      .replace(/\(\d{1,2}\/\d{1,2}\/\d{4}\s+\d{1,2}:\d{2}(?::\d{2})?\s*(?:AM|PM)?\s*,[^)]*\)/gi, '')
      .replace(/,?\s*no discount:\s*(?:not documented\.?|not provided\.?|-)\s*$/i, '')
      .replace(/^(?:Other|Price\/Budget|Date\/Time):\s*/i, '');
    if (/\b(?:ETA|estimated (?:time of )?arrival|pickup window was past due)\b/i.test(note) && /\b(?:customer|caller|called|contacted|request|asking|asked)\b/i.test(note)) {
      etaRequested = true;
      if (/\b(?:call cent(?:er|re)|customer care|CCC)\b/i.test(note)) callCenter = true;
    }
    note = note.replace(/^TOG[–-][\s\S]*?Call Summary:\s*/i, '');
    const webItems = note.match(/what (?:will (?:we|be)|are we) (?:be )?picking up\??:\s*([\s\S]*?)(?=,\s*(?:Service Type|Service|Special Offer|Text Optin|Email OptIn)\s*:|$)/i)?.[1];
    if (webItems) note = webItems;
    if (/^\s*(?:Appointment moved from|Promo code:|Booked online\b|Additional Lead Note Label:)/i.test(note)) continue;
    for (const raw of note.split(/(?<=[.!?])\s+(?=[A-Z])|[\r\n]+/)) {
      const detail = clean(raw.replace(/^(?:Call Summary|Action Details|Next Steps):\s*/i, ''));
      if (!detail || /^(?:none|n\/a|not provided|not documented|—)[.!]?$/i.test(detail)) continue;
      if (/^(?:Cash|Credit Card|Check)\s+\$[\d,.]+\s+Remove$/i.test(detail)) continue;
      if (/\b(?:callback|return (?:their|the|a) call)\b/i.test(detail) && !/\bETA\b/i.test(detail)) {
        callbackRequested = true;
        if (/\b(?:before|after|within|in \w+ hours?|by (?:\d|noon|midnight|today|tomorrow))\b/i.test(detail)) callbackTiming = true;
        else if (/^(?:I acknowledged|Await callback)/i.test(detail)) continue;
      }
      // Keep concrete crew instructions even when a call-center entry contains them.
      const instruction = /\b(?:gate|stairs?|upstairs|downstairs|elevator|parking|driveway|bedrooms?|garage|backyard|basement|pets?|dogs?|code|special request)\b/i.test(detail)
        || /\b(?:call|text|contact)\b.*\b(?:before|ahead|upon arrival|on arrival|minutes? out)\b/i.test(detail)
        || /\b(?:do not|don't|please|must|bring|leave|keep|avoid|remove|pick up)\b/i.test(detail) && !/\b(?:notification|informed|confirmed)\b/i.test(detail);
      if (!instruction && (
        /\b(?:ETA|estimated (?:time of )?arrival)\b/i.test(detail)
        || /pickup window was past due/i.test(detail)
        || /^(?:TOG[–-]|Customer Care Case|Case Type:|Resolution:|Appointment moved from|Correcting the appointment|Appointment was originally listed)/i.test(detail)
        || /\b(?:sent (?:a |an |the )?(?:franchise )?notification|notification sent|I confirmed|I informed|informed the caller|scheduled under (?:a )?different name|caller (?:accepted|agreed)|customer (?:accepted|agreed)|no further (?:requests|questions)|aware and agreed|have them call the customer|callback between)\b/i.test(detail)
        || /^(?:The caller acknowledged the information|I checked the appointment details and attempted to contact the team|I spoke with the team to inquire about the issue and apologized|I provided an explanation but did not complete any request|Follow up needed to address the caller[’']s issue or request)\b/i.test(detail)
      )) continue;
      details.push(detail);
    }
  }
  const seen = new Set<string>();
  const unique = details.filter(detail => {
    const key = detail.toLowerCase().replace(/[.!]+$/, '');
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
  if (etaRequested) unique.push(callCenter ? 'Customer contacted the call center for an ETA.' : 'Customer requested an ETA.');
  if (callbackRequested && !callbackTiming && !unique.some(detail=>/callback|return .*call/i.test(detail))) unique.push('Customer requested a callback.');
  return unique;
}
