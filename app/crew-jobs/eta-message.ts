/** ETA text drafts open in Messages; the crew member reviews and sends them. */
export function etaMessage(customerName:string,minutes:number):string {
  const first=customerName.trim().split(/\s+/)[0] || 'there';
  return `Hi ${first}, this is Junk King. Our crew is about ${minutes} minutes away. See you soon!`;
}
