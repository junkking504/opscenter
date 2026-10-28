import {serviceAddressForGeocoding} from './appointment-partner';

/** Presentation only: keep the source address intact for verification and history.
 * Separate this known program label only when the remainder is an unambiguous
 * complete street address. Other business names and ambiguous addresses stay put.
 */
export function appointmentAddressDisplay(source:string):{address:string;programLabel:string|null} {
  const match=/^(Amazon\s+Mattress\s+Removal)\s+(.+)$/i.exec(source.trim());
  if(match && serviceAddressForGeocoding(source)===match[2].trim()) {
    return {address:match[2].trim(),programLabel:match[1]};
  }
  return {address:source,programLabel:null};
}
