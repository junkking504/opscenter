import {AddressLink} from './day-summary';
import CustomerPhoneLink from './customer-phone-link';
import ContactActions from './contact-actions';
import styles from './appointment-contacts.module.css';

/** Keep contact actions outside appointment buttons so native link taps stay independent. */
export default function AppointmentContacts({address,phone,customerName='',actions=false}:{address:string;phone:string;customerName?:string;actions?:boolean}) {
 return <div className={styles.contacts}>
  <AddressLink address={address || ''}/>
  <CustomerPhoneLink phone={phone || ''}/>
  {actions&&<ContactActions phone={phone || ''} customerName={customerName} address={address || ''}/>}
 </div>;
}
