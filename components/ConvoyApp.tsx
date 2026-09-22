import TruckInspectionApp from './TruckInspectionApp';
import styles from './waypoint-app.module.css';

export default function ConvoyApp() {
  return <div className={styles.app}>
    <header className={`${styles.header} ${styles.convoyHeader}`}>
      <div className={styles.brand}>
        <img src="/truck-inspection/convoy-gear-crown-v2-192.png" width="52" height="52" alt="" />
        <div><strong>Convoy</strong><span>JUNK KING · INSPECTIONS</span></div>
      </div>
    </header>
    <div><TruckInspectionApp /></div>
  </div>;
}
