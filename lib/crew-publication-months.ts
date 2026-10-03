/** Select existing saved months before the publisher contacts its remote. */
export function crewPublicationMonths(monthKeys: string[], args: string[]): string[] {
  const monthArgs=args.filter(arg=>arg==='--month'||arg.startsWith('--month='));
  if (monthArgs.length) {
    if(monthArgs.length!==1||args.includes('--all')) throw Error('Choose exactly one --month=YYYY-MM, without --all.');
    const month=monthArgs[0].slice('--month='.length);
    if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!monthKeys.includes(month)) throw Error('Selected publication month is invalid or has no saved metrics.');
    return [month];
  }
  return args.includes('--all') ? monthKeys : monthKeys.slice(-1);
}
