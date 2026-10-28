import {AddressLink} from './day-summary';
import CustomerPhoneLink from './customer-phone-link';
import styles from './appointment-contacts.module.css';

/** Keep contact actions outside appointment buttons so native link taps stay independent. */
export default function AppointmentContacts({address,phone}:{address:string;phone:string}) {
 return <div className={styles.contacts}>
  <AddressLink address={address || ''}/>
  <CustomerPhoneLink phone={phone || ''}/>
 </div>;
}
