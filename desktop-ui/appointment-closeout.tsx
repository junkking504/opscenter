"use client";

import { checkoutFieldsKey, sameCheckoutFields } from '../app/crew-jobs/photo-checkout';
import { closeoutPhotoCount, CLOSEOUT_PHOTOS_REQUIRED, type CloseoutPhotoEvidence } from '../lib/closeout-photo-policy';
import { closeoutGpsTimes, closeoutChargesSummary, type CloseoutTimeKey } from '../lib/closeout-draft-summary';
import { automaticSizePrice } from '../lib/closeout-load-price';
import { onsiteTimeFacts } from '../lib/appointment-onsite-time';
import { paymentReferenceLabel, validateCloseoutPayment } from "../lib/closeout-payment";

import { readCloseoutLocal, writeCloseoutLocal } from './lib/closeout-drafts';
import { createPortal } from 'react-dom';
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ScheduleAppointment } from './lib/schedule-contract';
import { sendScheduleChange, checkScheduleChange, ChangeReceipt, type Receipt } from './schedule-receipt';
import './appointment-closeout.css';

type Option = { value: string; label: string };
type OtherCharge = { label: string; quantity: string; price: string; total: string };
type PendingOtherCharge = OtherCharge & { clientId: string; typeValue: string };
export type LiveCloseout = {
  photoEvidence?: CloseoutPhotoEvidence;
  truck?: string;
  truckOptions?: Option[];
  appointmentType?: { value: string; label: string; options: Option[] };
  status: { value: string; label: string };
  driver: Option;
  drivers: Option[];
  navigators: Option[];
  navigatorOptions: Option[];
  loadQuantity: string;
  loadSize: { value: string; label: string; options: Option[] };
  loadPrices: number[];
  dryRunFee?: string;
  loadPrice: string;
  bedloadQuantity: string;
  bedloadSize: { value: string; label: string; options: Option[] };
  bedloadPrices: number[];
  bedloadPrice: string;
  otherChargeOptions: Option[];
  otherCharges: OtherCharge[];
  discount: string;
  tip: string;
  howHeard?: { value: string; label: string; options: Option[] };
  jobCategory: { value: string; label: string; options: Option[] };
  actualStartHour: { value: string; label: string; options: Option[] };
  actualStartMinute: { value: string; label: string; options: Option[] };
  actualEndHour: { value: string; label: string; options: Option[] };
  actualEndMinute: { value: string; label: string; options: Option[] };
  paymentMethods: Option[];
  payments: Array<{ description: string; amount: string }>;
  balance: string;
  total: string;
};

function inputMoney(value: string): string {
  return String(value || "").replace(/[^0-9.-]/g, "");
}

export type CloseoutJob = Pick<ScheduleAppointment,'appointmentId'|'appointmentUrl'|'status'|'appointmentType'|'onsiteTime'|'truck'|'jkNumber'|'customerName'|'recordId'|'version'>;
export type CloseoutTransport = {
  load: () => Promise<{closeout:LiveCloseout;sourceVersion:string;canWrite:boolean;dryRun?:boolean;crewDefaults?:{version:number;driver:Option;navigators:Option[]};pendingReceipt?:Receipt|null;message?:string}>;
  prepare?:()=>Promise<void>;
  send: (values:Record<string,unknown>,requestId:string)=>Promise<Receipt>;
  check: (requestId:string)=>Promise<Receipt>;
};
export default function AppointmentCloseout({ job, date: serviceDate, saved, onBusyChange, presentation = 'drawer', onBackToAppointment, photoRevision, transport, draftKey, photoSteps, dryRun=false }: { job: CloseoutJob; date: string; saved: () => void; onBusyChange: (busy: boolean) => void; presentation?: 'drawer' | 'mobile'; onBackToAppointment?: () => void; photoRevision?: number; transport?:CloseoutTransport; draftKey?:string;dryRun?:boolean; photoSteps?:{render:(category:'before'|'after')=>ReactNode;hasPhotos:boolean;busy:boolean} }) {
  const crewMode=Boolean(transport);
  const photoWorkflow=Boolean(photoSteps);
  const { appointmentId, appointmentUrl, status: initialStatus } = job;
  const panel = useRef<HTMLDetailsElement>(null);
  const reviewPanel = useRef<HTMLDivElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [mobileStep, setMobileStep] = useState(0);
  const mobile = presentation === 'mobile';
  useEffect(() => { if (mobile && panel.current) panel.current.open = true; }, [mobile]);
  useEffect(() => { if (mobile) panel.current?.scrollIntoView({ block: 'start' }); }, [mobile, mobileStep]);
  const [actionHost, setActionHost] = useState<Element | null>(null);
  const [differenceReviewed, setDifferenceReviewed] = useState(false);
  useEffect(() => { setActionHost(panel.current?.closest('.job-record-drawer')?.querySelector('.closeout-footer-slot') || null); }, []);
  const paymentGroupId = useId();
  const statusGroupId = useId();
  const [targetStatus, setTargetStatus] = useState('1');
  const [truck, setTruck] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');
  const [sourceVersion, setSourceVersion] = useState('');
  const [canWrite, setCanWrite] = useState(false);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [reviewing, setReviewing] = useState(false);
  useEffect(() => { if (reviewing) { reviewPanel.current?.scrollIntoView({block:'start',behavior:'instant'}); reviewPanel.current?.focus({preventScroll:true}); } }, [reviewing]);
  const [category, setCategory] = useState(job.appointmentType.toLowerCase().includes('estimate') ? 'Estimate' : 'Job');
  const [estimateReason, setEstimateReason] = useState('');
  const [estimateExplanation, setEstimateExplanation] = useState('');
  const [noDiscountReason, setNoDiscountReason] = useState('');
  const requestPending = useRef(false);
  const gpsDefaults = useRef<Partial<Record<CloseoutTimeKey,string>>>({});
  const resolvedAppointmentId = appointmentId || String(appointmentUrl || "").match(/[?&]id=(\d{1,12})(?:&|$)/i)?.[1] || "";
  const [live, setLive] = useState<LiveCloseout | null>(null);
  const sourceBaseline = useRef<LiveCloseout | null>(null);
  const previousPhotoRevision = useRef(photoRevision);
  const draftReady=useRef(false);
  const dailyCrew=useRef<{version:number;driver:Option;navigators:Option[]}|null>(null);
  const [draftNotice,setDraftNotice]=useState('');
  useEffect(() => {
    if (previousPhotoRevision.current === photoRevision) return;
    previousPhotoRevision.current = photoRevision;
    if (!sourceBaseline.current) return;
    let canceled = false;
    setCanWrite(false);
    setReviewing(false);
    void (async () => {
      try {
        const payload = await readSource();
        if (!payload.closeout) throw new Error('Could not verify uploaded photos. Reload from JunkWare before closing this job.');
        const withoutPhotos = (value: LiveCloseout) => JSON.stringify({...value,photoEvidence:null});
        if (!sourceBaseline.current || withoutPhotos(sourceBaseline.current) !== withoutPhotos(payload.closeout)) throw new Error('The source appointment changed. Reload from JunkWare and review it before saving.');
        if (canceled) return;
        sourceBaseline.current=payload.closeout;
        setLive(current=>current ? {...current,photoEvidence:payload.closeout.photoEvidence} : current);
        setSourceVersion(payload.sourceVersion || '');
        setCanWrite(payload.canWrite===true);
        setError('');
      } catch (error) { if (!canceled) setError(error instanceof Error ? error.message : 'Photo verification unavailable.'); }
    })();
    return () => {canceled=true;};
  }, [photoRevision, resolvedAppointmentId]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [addPayment, setAddPayment] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentReference, setPaymentReference] = useState("");
  const [otherChargeType, setOtherChargeType] = useState("");
  const [otherChargeQuantity, setOtherChargeQuantity] = useState("1");
  const [otherChargePrice, setOtherChargePrice] = useState("");
  const [pendingOtherCharges, setPendingOtherCharges] = useState<PendingOtherCharge[]>([]);
  const otherChargePriceIsAutomatic = otherChargeType.split("|")[2] === "1";

  useEffect(()=>{
    if(!draftKey || !draftReady.current || !live || loading)return;
    try {
      if(receipt && receipt.status!=='failed'){localStorage.removeItem(`${draftKey}:draft`);return;}
      const fields:Record<string,unknown>={};
      for(const key of ['loadQuantity','loadPrice','bedloadQuantity','bedloadPrice','discount','tip'] as const)fields[key]=live[key];
      for(const key of ['loadSize','bedloadSize','jobCategory','howHeard','actualStartHour','actualStartMinute','actualEndHour','actualEndMinute'] as const)fields[key]=live[key]?.value;
      writeCloseoutLocal(`${draftKey}:draft`,{sourceVersion,crewVersion:dailyCrew.current?.version || 0,fields,driverId:live.driver.value,navigatorIds:live.navigators.map(row=>row.value),category,estimateReason,estimateExplanation,noDiscountReason,addPayment,paymentMethod,paymentAmount,paymentReference,pendingOtherCharges,mobileStep,photoWorkflow,sourceFields:photoWorkflow && sourceBaseline.current?checkoutFieldsKey(sourceBaseline.current):undefined});
    }catch {setDraftNotice('This browser cannot retain the draft. Keep this page open until the saved result is verified.');}
  },[draftKey,live,loading,receipt,sourceVersion,category,estimateReason,estimateExplanation,noDiscountReason,addPayment,paymentMethod,paymentAmount,paymentReference,pendingOtherCharges,mobileStep,photoWorkflow]);

  useEffect(() => { onBusyChange(loading || saving); return () => onBusyChange(false); }, [loading, saving, onBusyChange]);
  if (/cancel(?:ed|led)/i.test(initialStatus)) return null;

  async function readSource() {
    if(transport)return transport.load();
    const response=await fetch(`/api/desktop/schedule/closeout?appointmentId=${encodeURIComponent(resolvedAppointmentId)}`,{cache:'no-store'});
    const payload=await response.json().catch(()=>{throw new Error(`Closeout could not be loaded (HTTP ${response.status}). Retry loading the saved appointment.`);});
    if(!response.ok || !payload?.closeout)throw new Error(payload?.error || 'The JunkWare closeout could not be loaded.');
    return payload;
  }
  const send = (action:string,values:Record<string,unknown>,requestId:string) => transport
    ? transport.send(values,requestId) : sendScheduleChange(job,serviceDate,action,values,requestId);

  async function load(reconciled = false) {
    if (!reconciled && receipt && ['pending', 'uncertain'].includes(receipt.status)) return;
    if (!resolvedAppointmentId) {
      setError("This job does not have a Junkware appointment link yet.");
      return;
    }
    draftReady.current=false;
    setLoading(true);
    setError("");
    setMessage("");
    try {
      const payload = await readSource();
      const source = payload.closeout as LiveCloseout;
      sourceBaseline.current = source;
      const suggestions = closeoutGpsTimes(job.onsiteTime, job.truck, source.truck || '', serviceDate, source);
      gpsDefaults.current = {};
      const withTimes = {...source};
      dailyCrew.current=payload.crewDefaults || null;
      if(crewMode && payload.canWrite && !payload.pendingReceipt && dailyCrew.current){withTimes.driver=dailyCrew.current.driver;withTimes.navigators=[...dailyCrew.current.navigators];}
      for (const pair of [['actualStartHour','actualStartMinute'],['actualEndHour','actualEndMinute']] as const) {
        if (pair.every(key => !source[key].value && suggestions[key] !== undefined)) {
          for (const key of pair) { withTimes[key] = {...source[key],value:suggestions[key]!};gpsDefaults.current[key]=suggestions[key]; }
        }
      }
      setLive(withTimes);
      setTargetStatus(crewMode?'8':payload.closeout.status.value);
      setTruck(payload.closeout.truck || '');
      setCancellationReason('');
      setAddPayment(false);
      setPaymentMethod("");
      setPaymentAmount("");
      setPaymentReference("");
      setCategory(payload.closeout.appointmentType?.label === 'Estimate' ? 'Estimate' : 'Job');
      setSourceVersion(payload.sourceVersion || '');
      setCanWrite(payload.canWrite === true);
      setEstimateReason('');
      setEstimateExplanation('');
      setNoDiscountReason('');
      setReceipt(payload.pendingReceipt || null);
      setReviewing(false);
      setPendingOtherCharges([]);
      setMessage(payload.message || '');
      if(draftKey && !payload.pendingReceipt && payload.canWrite){
        const draft=readCloseoutLocal<Record<string,unknown>>(`${draftKey}:draft`);
        if(draft && (draft.sourceVersion===payload.sourceVersion || (photoWorkflow && draft.sourceFields===checkoutFieldsKey(source))) && Number(draft.crewVersion || 0)===(dailyCrew.current?.version || 0)){
          try {
            const fields=draft.fields as Record<string,string>;
            const restored={...withTimes};
            for(const key of ['loadQuantity','loadPrice','bedloadQuantity','bedloadPrice','discount','tip'] as const)if(typeof fields[key]==='string')restored[key]=fields[key];
            for(const key of ['loadSize','bedloadSize','jobCategory','howHeard','actualStartHour','actualStartMinute','actualEndHour','actualEndMinute'] as const){
              if(restored[key] && typeof fields[key]==='string' && restored[key]!.options.some(option=>option.value===fields[key]))restored[key]={...restored[key]!,value:fields[key]};
            }
            restored.driver=source.drivers.find(row=>row.value===draft.driverId) || source.driver;
            if(Array.isArray(draft.navigatorIds))restored.navigators=draft.navigatorIds.map(id=>source.navigatorOptions.find(row=>row.value===id)).filter((row):row is Option=>Boolean(row));
            setLive(restored);
            if(['Job','Estimate'].includes(String(draft.category)))setCategory(String(draft.category));
            setEstimateReason(String(draft.estimateReason || ''));setEstimateExplanation(String(draft.estimateExplanation || ''));setNoDiscountReason(String(draft.noDiscountReason || ''));
            setAddPayment(draft.addPayment===true);setPaymentMethod(String(draft.paymentMethod || ''));setPaymentAmount(String(draft.paymentAmount || ''));setPaymentReference(String(draft.paymentReference || ''));
            if(Array.isArray(draft.pendingOtherCharges) && draft.pendingOtherCharges.every(row=>row && ['clientId','typeValue','quantity','price','label','total'].every(key=>typeof row[key]==='string')))setPendingOtherCharges(draft.pendingOtherCharges);
            if(Number.isInteger(draft.mobileStep) && Number(draft.mobileStep)>=0 && Number(draft.mobileStep)<=(photoSteps?3:2) && Boolean(draft.photoWorkflow)===Boolean(photoSteps))setMobileStep(Number(draft.mobileStep));
            setDraftNotice('Draft restored against the current JunkWare record. Review before saving.');
          }catch {setDraftNotice('The stored draft could not be restored. The current source is shown.');}
        }else if(draft){localStorage.removeItem(`${draftKey}:draft`);setDraftNotice('JunkWare or today’s crew changed since this draft. Current values are shown; review before entering a payment.');}
      }
      draftReady.current=true;
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The Junkware closeout could not be loaded.");
    } finally {
      setLoading(false);
    }
  }

  function update<K extends keyof LiveCloseout>(key: K, value: LiveCloseout[K]) {
    setReviewing(false);
    setLive((current) => current ? { ...current, [key]: value } : current);
  }

  function updateSelect(key: "loadSize" | "bedloadSize" | "jobCategory" | "actualStartHour" | "actualStartMinute" | "actualEndHour" | "actualEndMinute", value: string) {
    setReviewing(false);
    if (key.startsWith('actualStart')) { delete gpsDefaults.current.actualStartHour; delete gpsDefaults.current.actualStartMinute; }
    if (key.startsWith('actualEnd')) { delete gpsDefaults.current.actualEndHour; delete gpsDefaults.current.actualEndMinute; }
    setLive((current) => current ? { ...current, [key]: { ...current[key], value } } : current);
  }

  function updateLoadSize(value: string) {
    setReviewing(false);
    setLive((current) => current ? { ...current, loadSize: { ...current.loadSize, value }, loadPrice: automaticSizePrice(value, current.loadQuantity, current.loadSize.options, current.loadPrices, 'load', current.dryRunFee) } : current);
  }

  function updateLoadQuantity(value: string) {
    setReviewing(false);
    setLive((current) => current ? { ...current, loadQuantity: value, loadPrice: automaticSizePrice(current.loadSize.value, value, current.loadSize.options, current.loadPrices, 'load', current.dryRunFee) } : current);
  }

  function updateBedloadSize(value: string) {
    setReviewing(false);
    setLive((current) => current ? { ...current, bedloadSize: { ...current.bedloadSize, value }, bedloadPrice: automaticSizePrice(value, current.bedloadQuantity, current.bedloadSize.options, current.bedloadPrices, 'bedload') } : current);
  }

  function updateBedloadQuantity(value: string) {
    setReviewing(false);
    setLive((current) => current ? { ...current, bedloadQuantity: value, bedloadPrice: automaticSizePrice(current.bedloadSize.value, value, current.bedloadSize.options, current.bedloadPrices, 'bedload') } : current);
  }

  function setNavigator(index: number, value: string) {
    if (!live) return;
    const navigators = live.navigators.map((row, rowIndex) => rowIndex === index
      ? { value, label: live.navigatorOptions.find((option) => option.value === value)?.label || "" }
      : row);
    update("navigators", navigators);
  }

  function addNavigator() {
    if (!live) return;
    update("navigators", [...live.navigators, { value: "", label: "" }]);
  }

  function removeNavigator(index: number) {
    if (!live) return;
    update("navigators", live.navigators.filter((_, rowIndex) => rowIndex !== index));
  }

  function selectOtherCharge(value: string) {
    setOtherChargeType(value);
    setOtherChargePrice(value.split("|")[2] === "1" ? "" : value.split("|")[1] || "");
  }

  function addOtherCharge() {
    if (!live) return;
    const option = live.otherChargeOptions.find((candidate) => candidate.value === otherChargeType);
    const isPercentage = option?.value.split("|")[2] === "1";
    if (!option || !otherChargeQuantity.trim() || (!isPercentage && !inputMoney(otherChargePrice))) {
      setError("Choose an Other Charge and enter its quantity and price.");
      return;
    }
    setReviewing(false);
    setPendingOtherCharges((current) => [...current, {
      clientId: `${Date.now()}-${current.length}`,
      typeValue: option.value,
      label: option.label,
      quantity: otherChargeQuantity.trim(),
      price: inputMoney(otherChargePrice),
      total: "",
    }]);
    setOtherChargeType("");
    setOtherChargeQuantity("1");
    setOtherChargePrice("");
    setError("");
  }

  function removePendingOtherCharge(clientId: string) {
    setReviewing(false);
    setPendingOtherCharges((current) => current.filter((charge) => charge.clientId !== clientId));
  }

  async function save() {
    if (!live || !canWrite || requestPending.current || (receipt && receipt.status !== 'failed')) return;
    if (targetStatus === '9') {
      if (!cancellationReason.trim()) { setError('Enter a cancellation reason before reviewing.'); return; }
      if (!reviewing) { setError(''); setReviewing(true); return; }
      requestPending.current = true; setSaving(true); setError('');
      const requestId = crypto.randomUUID();
      try {
        const result = await send('cancel', { reason: cancellationReason.trim() }, requestId);
        setReceipt(result);
        if (result.status === 'verified') { setMessage('Cancellation saved and verified in JunkWare.'); saved(); }
      } catch { setReceipt({ requestId, action: 'cancel', status: 'uncertain', message: 'Check Saved Result before another change.' }); }
      finally { requestPending.current = false; setSaving(false); }
      return;
    }
    const completing = targetStatus === '8';
    if (completing && !closeoutPhotoCount(live.photoEvidence, resolvedAppointmentId) && !(transport?.prepare && photoSteps?.hasPhotos)) {
      setError(transport?.prepare?'Add job photos before submitting checkout. They upload after final confirmation.':CLOSEOUT_PHOTOS_REQUIRED); return;
    }
    if ((completing || live.truck) && !truck) {
      setError('Choose the truck above Krewe Assigned to This Job.');
      return;
    }
    const navigatorIds = live.navigators.map((row) => row.value).filter(Boolean);
    if (completing && !live.driver.value) {
      setError("Choose a driver before saving the closeout.");
      return;
    }
    if (new Set([live.driver.value, ...navigatorIds]).size !== 1 + navigatorIds.length) {
      setError("Each assigned person can only appear once on the job.");
      return;
    }
    if (completing && ![live.actualStartHour.value, live.actualStartMinute.value, live.actualEndHour.value, live.actualEndMinute.value].every(Boolean)) {
      setError('Enter actual start and finish times before reviewing the closeout.'); return;
    }
    if (completing && live.howHeard && !live.howHeard.value) { setError('Choose how the customer heard about us.'); return; }
    if (completing && !inputMoney(live.loadPrice) && !inputMoney(live.bedloadPrice)) { setError('Enter a load or bedload price.'); return; }
    if (addPayment) {
      const paymentError = validateCloseoutPayment({ methodId: paymentMethod, amount: inputMoney(paymentAmount), reference: paymentReference.trim() }, live.paymentMethods);
      if (paymentError) { setError(paymentError); return; }
    }
    if (!completing && (addPayment || pendingOtherCharges.length)) { setError('Select Completed to save the payment or additional charges in this draft.'); return; }
    const completingEstimate = completing && category === 'Estimate' && live.status.value !== '8';
    const noDiscountRequired = completingEstimate && !(Number(inputMoney(live.discount)) > 0);
    if (completingEstimate && (!estimateReason || !estimateExplanation.trim())) {
      setError('Choose why this remained an estimate and add the outcome notes before closing it.');
      return;
    }
    if (noDiscountRequired && !noDiscountReason.trim()) {
      setError('Add why no discount was offered before closing this estimate.');
      return;
    }
    if (otherChargeType) { setError("Add the pending Other Charge or clear its selection before reviewing."); return; }
    if (!reviewing) { setError(""); setDifferenceReviewed(false); setReviewing(true); return; }
    if (paymentDifference > 0.01 && !differenceReviewed) { setError('Review the payment difference before confirming.'); return; }
    requestPending.current = true;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      let preparedSourceVersion=sourceVersion;
      if(transport?.prepare){
        await transport.prepare();
        const fresh=await readSource();
        if(!fresh.canWrite || fresh.pendingReceipt || !sourceBaseline.current || !sameCheckoutFields(sourceBaseline.current,fresh.closeout) || (dailyCrew.current?.version || 0)!==(fresh.crewDefaults?.version || 0))throw new Error('The appointment or crew changed during submission. Reload from JunkWare and review before saving. Your payment has not been submitted.');
        if(!fresh.dryRun && !closeoutPhotoCount(fresh.closeout.photoEvidence,resolvedAppointmentId))throw new Error('JunkWare has not verified the photos yet. Submit checkout again to check their saved result. Your payment has not been submitted.');
        sourceBaseline.current=fresh.closeout;preparedSourceVersion=fresh.sourceVersion;
        setLive(current=>current?{...current,photoEvidence:fresh.closeout.photoEvidence}:current);setSourceVersion(fresh.sourceVersion);
      }
      const requestId = crypto.randomUUID();
      const result = await send('closeout', {
        ...{
          appointmentId: resolvedAppointmentId,
          targetStatus,
          ...(truck ? { truck } : {}),
          serviceDate,
          driverId: live.driver.value,
          navigatorIds,
          loadQuantity: live.loadQuantity,
          loadSize: live.loadSize.value,
          loadPrice: inputMoney(live.loadPrice),
          bedloadQuantity: live.bedloadQuantity,
          bedloadSize: live.bedloadSize.value,
          bedloadPrice: inputMoney(live.bedloadPrice),
          otherChargesToAdd: pendingOtherCharges.map((charge) => ({
            typeValue: charge.typeValue,
            quantity: charge.quantity,
            price: inputMoney(charge.price),
          })),
          discount: inputMoney(live.discount),
          tip: inputMoney(live.tip),
          jobCategoryId: category === 'Estimate' ? '' : live.jobCategory.value,
          ...(live.howHeard ? { howHeardId: live.howHeard.value } : {}),
          actualStartHour: live.actualStartHour.value,
          actualStartMinute: live.actualStartMinute.value,
          actualEndHour: live.actualEndHour.value,
          actualEndMinute: live.actualEndMinute.value,
          addPayment: addPayment ? { methodId: paymentMethod, amount: inputMoney(paymentAmount), reference: paymentReference.trim() } : null,
        }, expectedSourceVersion: preparedSourceVersion, appointmentType: category, ...(completingEstimate ? { estimateOutcome: {
          reason: estimateReason,
          explanation: estimateExplanation.trim(),
          ...(noDiscountRequired ? { noDiscountReason: noDiscountReason.trim() } : {}),
        } } : {}),
      }, requestId).catch(() => ({ requestId, status: 'uncertain', message: 'The closeout result could not be confirmed. Check Saved Result before another change.' } as Receipt));
      setReceipt(result);
      if(result.dryRun){setMessage(result.message || 'Dry run complete. Nothing was saved to JunkWare.');saved();return;}
      if (result.status === 'failed') { setReviewing(false); setDifferenceReviewed(false); }
      if (result.status !== 'verified' || !result.sourceResult?.closeout) return;
      const payload = result.sourceResult as { closeout: LiveCloseout; truckLoadStatus?: { updated?: boolean; status?: { truck?: string; currentLoadLabel?: string }; reason?: string } };
      setLive(payload.closeout);
      setTargetStatus(payload.closeout.status.value);
      setTruck(payload.closeout.truck || '');
      setAddPayment(false);
      setPaymentMethod("");
      setPaymentAmount("");
      setPendingOtherCharges([]);
      const loadStatus = payload.truckLoadStatus;
      setMessage(loadStatus?.updated && loadStatus?.status
        ? `Saved and verified in JunkWare. ${loadStatus.status.truck} is now ${loadStatus.status.currentLoadLabel}.`
        : `Saved and verified in JunkWare.${loadStatus?.reason ? ` Truck load status: ${loadStatus.reason}` : ""}`);
      saved();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Junkware did not save the closeout.");
    } finally {
      requestPending.current = false;
      setSaving(false);
    }
  }

  async function check() {
    if (!receipt || requestPending.current) return;
    requestPending.current = true; setSaving(true);
    try {
      const result = await (transport?transport.check(receipt.requestId):checkScheduleChange(receipt.requestId));
      setReceipt(result);
      if (result.status === 'verified' || result.status === 'failed' || result.status === 'reconciled') {
        if (result.status === 'reconciled' || result.action && result.action !== 'closeout') {
          setReceipt(null); setLive(null); setSourceVersion(''); setCanWrite(false);
          await load(true);
        } else if (result.sourceResult?.closeout) {
          const source = result.sourceResult.closeout as LiveCloseout;
          setLive(source); setTargetStatus(source.status.value); setTruck(source.truck || '');
        }
        setAddPayment(false); setPaymentMethod(''); setPaymentAmount(''); setPaymentReference(''); setPendingOtherCharges([]);
        saved();
      }
    }
    catch { setError('Saved result unavailable. Do not repeat this closeout.'); }
    finally { requestPending.current = false; setSaving(false); }
  }

  const totals = live ? closeoutChargesSummary(live, pendingOtherCharges) : null;
  const gpsTimes = live ? closeoutGpsTimes(job.onsiteTime, job.truck, truck, serviceDate, live) : {};
  const hasGpsTimes = Object.keys(gpsTimes).length > 0;
  const money = (amount:number) => Number.isFinite(amount) ? new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(amount) : 'Check amounts';

  const pendingReceipt = Boolean(receipt && ['pending','uncertain'].includes(receipt.status));
  const verified = receipt?.status === 'verified' || receipt?.dryRun===true;
  const draftBalance = totals && live ? totals.total-live.payments.filter(payment=>!/^billed/i.test(payment.description)).reduce((sum,payment)=>sum+Number(inputMoney(payment.amount)),0) : 0;
  const paymentDifference = addPayment && targetStatus !== '9' ? Number(inputMoney(paymentAmount))-draftBalance : 0;
  const timeLabel = (hour:string,minute:string) => hour && minute ? `${Number(hour)%12 || 12}:${minute.padStart(2,'0')} ${Number(hour)>=12?'PM':'AM'}` : 'Not entered';
  const stepLabels=photoSteps ? ['Before photos','Charges','After photos','Payment','Review'] : ['Details','Charges','Payment','Review'];
  const currentPhotoCategory=photoSteps && (mobileStep===0 || mobileStep===2) ? mobileStep===0?'before':'after' : null;
  const photoBlocked=Boolean(photoSteps?.busy);
  const nextMobileStep = mobile && mobileStep < stepLabels.length-2 && !reviewing && !pendingReceipt && !verified && targetStatus !== '9';
  const actions = expanded && live ? <div className="closeout-primary-actions">
    <div className="closeout-action-context"><strong>{pendingReceipt ? 'Check the previous save' : receipt?.dryRun ? 'Dry run complete' : verified ? 'Saved and verified' : reviewing ? 'Ready to confirm' : 'Review before saving'}</strong>{totals && targetStatus!=='9' && <span>{money(totals.total)}{totals.estimated ? ' estimated' : ''}</span>}</div>
    {error && <p role="alert">{error}</p>}
    <button type="button" className="ops-button closeout-primary-button" onClick={()=>void (nextMobileStep ? setMobileStep(mobileStep + 1) : pendingReceipt ? check() : verified ? load() : save())} disabled={saving || loading || (!pendingReceipt && !verified && (!canWrite || photoBlocked))}>{nextMobileStep ? `Continue to ${stepLabels[mobileStep+1].toLowerCase()}` : saving ? "Uploading and verifying checkout…" : pendingReceipt ? 'Check Saved Result' : verified ? receipt?.dryRun ? 'Start another dry run' : 'Reload saved closeout' : targetStatus === '9' ? reviewing ? 'Confirm Cancellation in JunkWare' : 'Review Cancellation' : targetStatus === '1' ? reviewing ? 'Confirm Changes in JunkWare' : 'Review Changes' : reviewing ? crewMode ? "Submit checkout" : `Confirm ${category} Closeout in JunkWare` : "Review Closeout"}</button>
    <div className="closeout-secondary-actions">{mobile && mobileStep > 0 && !reviewing && (!receipt || receipt.status==='failed') && <button type="button" disabled={saving || loading || photoSteps?.busy} onClick={()=>setMobileStep(mobileStep-1)}>Previous step</button>}{reviewing && <button type="button" onClick={()=>{setReviewing(false);setDifferenceReviewed(false);}} disabled={saving}>Edit details</button>}<button type="button" onClick={()=>{if(mobile && onBackToAppointment) onBackToAppointment(); else if(panel.current)panel.current.open=false;}} disabled={saving || loading || photoSteps?.busy}>Back to appointment</button></div>
  </div> : null;

  return (
    <details ref={panel} data-photo-workflow={photoSteps ? true : undefined} data-mobile-step={mobile ? reviewing ? "review" : mobileStep : undefined} className={`appointment-closeout-panel${mobile ? " mobile-closeout-panel" : ""}`} data-appointment-id={resolvedAppointmentId} aria-busy={loading || saving} onToggle={event => { setExpanded(event.currentTarget.open); if (event.currentTarget.open && !live && !loading && !saving) void load(); }}>
      <summary><span className="closeout-summary-title">Appointment Closeout</span><span className="closeout-summary-action" aria-hidden="true"><span className="closeout-open-label">Open</span><span className="closeout-hide-label">Hide</span><span className="closeout-summary-chevron">⌄</span></span></summary>
      <div className="appointment-closeout-body">
        {draftNotice && <p role="status">{draftNotice}</p>}
        {live && !photoSteps && <p className="closeout-photo-requirement" role="status">{closeoutPhotoCount(live.photoEvidence, resolvedAppointmentId) ? `${closeoutPhotoCount(live.photoEvidence, resolvedAppointmentId)} uploaded job photo(s) verified.` : CLOSEOUT_PHOTOS_REQUIRED}</p>}
        {mobile && live && <nav className="mobile-closeout-steps" aria-label="Closeout steps">{stepLabels.map((label,index)=><button key={label} type="button" aria-current={(reviewing ? index===stepLabels.length-1 : mobileStep===index) ? 'step' : undefined} disabled={saving || loading || photoSteps?.busy || Boolean(receipt && receipt.status !== 'failed') || index===stepLabels.length-1 || Boolean(photoSteps && (photoSteps.busy || index>mobileStep+1 || (index>mobileStep && photoBlocked)))} onClick={()=>{setMobileStep(index);setReviewing(false);}}><span>{index+1}</span>{label}</button>)}</nav>}
        {live && photoSteps && <div hidden={!currentPhotoCategory || reviewing || Boolean(receipt && receipt.status!=='failed')} className="closeout-photo-step">{photoSteps.render(mobileStep>=2?'after':'before')}</div>}
        {receipt && <>{receipt.action && receipt.action !== 'closeout' && ['pending', 'uncertain'].includes(receipt.status) && <p role="alert">Closeout is locked until the earlier {receipt.action === 'move' ? 'assignment change' : 'appointment change'} is checked in JunkWare. This is not a closeout result.</p>}<ChangeReceipt receipt={receipt} onCheck={() => { void check(); }} /></>}
        {!live ? (
          loading ? <p role="status">Loading current JunkWare closeout…</p> : error ? (
            <button type="button" className="ops-button" onClick={() => void load()} disabled={!resolvedAppointmentId}>Retry loading closeout</button>
          ) : message ? <button type="button" className="ops-button" onClick={() => void load()} disabled={saving || photoSteps?.busy || !resolvedAppointmentId}>Reload from JunkWare</button> : null
        ) : (
          <>
            <fieldset onChange={() => { setReviewing(false); setDifferenceReviewed(false); }} className="desktop-closeout-fields" disabled={saving || Boolean(receipt && receipt.status !== 'failed')}>
            {reviewing && <div ref={reviewPanel} tabIndex={-1} className="closeout-review" role="status" aria-label="Closeout review">
              <h3>{targetStatus === '9' ? 'Review cancellation' : 'Review closeout'}</h3>
              <p>{job.jkNumber} · {job.customerName}</p>
              <div className="closeout-review-facts"><div><span>Status</span><strong>{live.status.label} → {targetStatus === '8' ? 'Completed' : targetStatus === '9' ? 'Cancelled' : 'Confirmed'}</strong></div>
              {targetStatus !== '9' && <><div><span>Category</span><strong>{category}</strong></div><div><span>Truck</span><strong>{live.truck || 'Unassigned'} → {truck || 'Unassigned'}</strong></div><div><span>Krewe</span><strong>{[live.driver.label,...live.navigators.filter(person=>person.value).map(person=>person.label)].filter(Boolean).join(' · ') || 'Not assigned'}</strong></div><div><span>Actual job time</span><strong>{timeLabel(live.actualStartHour.value,live.actualStartMinute.value)} – {timeLabel(live.actualEndHour.value,live.actualEndMinute.value)}</strong></div></>}
              </div>
              {targetStatus === '9' ? <p>{cancellationReason.trim()}</p> : <>
              <div className="closeout-review-facts"><div><span>Load · {live.loadQuantity || '0'} full trucks{live.loadSize.value ? ` + ${live.loadSize.value}` : ''}</span><strong>{money(Number(inputMoney(live.loadPrice)))}</strong></div>
                {Number(inputMoney(live.bedloadPrice)) > 0 && <div><span>Bedload</span><strong>{money(Number(inputMoney(live.bedloadPrice)))}</strong></div>}
                {[...live.otherCharges,...pendingOtherCharges].map((charge,index)=><div key={index}><span>{charge.label} · {charge.quantity || '1'}{index>=live.otherCharges.length ? ' (to add)' : ''}</span><strong>{'typeValue' in charge && String(charge.typeValue).split('|')[2]==='1' ? 'Calculated by JunkWare' : money(charge.total ? Number(inputMoney(charge.total)) : Number(charge.quantity || '1')*Number(inputMoney(charge.price)))}</strong></div>)}
                <div><span>Subtotal</span><strong>{money(totals!.subtotal)}</strong></div><div><span>Discount</span><strong>−{money(Number(inputMoney(live.discount)))}</strong></div><div><span>Tip</span><strong>{money(Number(inputMoney(live.tip)))}</strong></div><div className="closeout-review-total"><span>Total{totals!.estimated ? ' (estimated)' : ''}</span><strong>{money(totals!.total)}</strong></div>
              </div>
              <div className="closeout-review-facts">{live.payments.map((payment,index)=><div key={index}><span>Already recorded · {payment.description}</span><strong>{payment.amount}</strong></div>)}</div>
              <p>{addPayment ? `Payment to record: ${live.paymentMethods.find(option => option.value === paymentMethod)?.label} · ${money(Number(inputMoney(paymentAmount)))}${paymentReference ? ` · ${paymentReferenceLabel(live.paymentMethods.find(option => option.value === paymentMethod))}: ${paymentReference}` : ''}` : 'No new payment will be recorded.'}</p>
              {addPayment && Math.abs(paymentDifference)>0.01 && <div className="closeout-payment-difference"><strong>{paymentDifference>0 ? `${money(paymentDifference)} above the draft balance` : `${money(-paymentDifference)} remains after this entry`}</strong><p>Draft balance {money(draftBalance)} · Payment entered {money(Number(inputMoney(paymentAmount)))}. Check charges, tip and payment amount{totals!.estimated ? '; percentage fees are estimates' : ''}.</p>{paymentDifference>0 && <label><input type="checkbox" checked={differenceReviewed} onChange={event=>{event.stopPropagation();setDifferenceReviewed(event.target.checked);setError('');}}/><span>I checked this payment difference</span></label>}</div>}
              {category==='Estimate' && targetStatus==='8' && <p>Estimate outcome: {estimateReason} · {estimateExplanation}{noDiscountReason ? ` · No discount: ${noDiscountReason}` : ''}</p>}
              </>}
              <p className="closeout-confirm-note">{dryRun ? "Dry run only. Nothing will be uploaded or saved to JunkWare, and no customer receipt will be sent." : <>Confirmation saves this {targetStatus==='9' ? 'cancellation' : 'appointment'} in JunkWare.{targetStatus==='8' ? ' Completion may send the normal closeout alert.' : ''}</>}</p>
            </div>}
            <p className="closeout-step-note">{reviewing ? 'Review the summary above, or edit any field below.' : '1. Job details and charges → 2. Review → 3. Confirm in JunkWare'}</p>
            <fieldset data-closeout-step={photoSteps ? "1" : "0"} className="ops-closeout-status-options"><legend>Status</legend>
              {(crewMode?[['8','Completed']]:[['1', 'Confirmed'], ['8', 'Completed'], ['9', 'Cancelled']]).map(([value, label]) => <label key={value}><input type="radio" name={statusGroupId} value={value} checked={targetStatus === value} disabled={live.status.value === '8' && value !== '8'} onChange={() => { setTargetStatus(value); setReviewing(false); setError(''); }} /><span>{label}</span></label>)}
            </fieldset>
            {targetStatus === '9' ? <section className="appointment-create-section">
              <label><span>Cancellation reason</span><textarea aria-label="Closeout cancellation reason" maxLength={500} rows={2} value={cancellationReason} onChange={event => { setCancellationReason(event.target.value); setReviewing(false); }} /></label>
              <p>Cancellation saves only the status and reason. Charges, payments and crew edits in this draft are not submitted.</p>
            </section> : <>
            <label data-closeout-step={photoSteps ? "1" : "0"}><span>Final appointment category</span><select value={category} onChange={event => { setCategory(event.target.value); setReviewing(false); setEstimateReason(''); setEstimateExplanation(''); setNoDiscountReason(''); }}><option>Job</option><option>Estimate</option></select></label>
            <div data-closeout-step={photoSteps ? "1" : "0"} className="drawer-facts">
              <div><span>Junkware status</span><strong>{live.status.label || "Unavailable"}</strong></div>
              <div><span>Saved total</span><strong>{live.total || "Unavailable"}</strong></div>
              <div><span>Balance</span><strong>{live.balance || "Unavailable"}</strong></div>
            </div>
            {saving ? <div className="ops-closeout-editor-message progress" role="status" aria-live="polite">Saving changes and checking them in JunkWare…</div> : null}

            {targetStatus === '8' && category === 'Estimate' && live.status.value !== '8' ? <section data-closeout-step={photoSteps ? "1" : "0"} className="appointment-create-section estimate-outcome-fields">
              <h4>Estimate outcome required by JunkWare</h4>
              <label><span>Why did this remain an estimate?</span><select value={estimateReason} onChange={event => { setEstimateReason(event.target.value); setReviewing(false); }}><option value="">Select reason</option><option>Price/Budget</option><option>Date/Time</option><option>Other</option></select></label>
              <label><span>Outcome notes</span><textarea rows={2} maxLength={2000} value={estimateExplanation} onChange={event => { setEstimateExplanation(event.target.value); setReviewing(false); }} /></label>
              {!(Number(inputMoney(live.discount)) > 0) ? <label><span>Why was no discount offered?</span><textarea rows={2} maxLength={2000} value={noDiscountReason} onChange={event => { setNoDiscountReason(event.target.value); setReviewing(false); }} /></label> : null}
            </section> : null}

            <section data-closeout-step={photoSteps ? "1" : "0"} className="appointment-create-section">
              <label><span>Truck</span><select aria-label="Appointment truck" disabled={crewMode} value={truck} onChange={event => {
                setTruck(event.target.value); setReviewing(false);
                setLive(current => { if (!current) return current; const next={...current};
                  for (const key of Object.keys(gpsDefaults.current) as CloseoutTimeKey[]) if (next[key].value===gpsDefaults.current[key]) next[key]={...next[key],value:''};
                  gpsDefaults.current={}; return next;
                });
              }}>
                <option value="">Select truck</option>
                {(live.truckOptions || []).filter(option => option.value && /truck\s*#?\s*\d+/i.test(option.label)).map(option => { const label = option.label.replace(/Truck#?\s*/i, 'Truck ').trim(); return <option key={option.value} value={label}>{label}</option>; })}
                {truck && !(live.truckOptions || []).some(option => option.label.replace(/Truck#?\s*/i, 'Truck ').trim() === truck) && <option value={truck}>{truck}</option>}
              </select></label>
              <h4>Krewe Assigned to This Job</h4>{crewMode && dailyCrew.current && <p>Today’s driver and navigator are filled in from this phone. Add any extra crew who worked this job.</p>}
              <label>
                <span>Driver</span>
                <select disabled={crewMode && Boolean(dailyCrew.current)} value={live.driver.value} onChange={(event) => update("driver", { value: event.target.value, label: event.target.selectedOptions[0]?.text || "" })}>
                  {live.drivers.map((option) => <option key={`driver-${option.value}`} value={option.value}>{option.label || "Choose driver"}</option>)}
                </select>
              </label>
              <div className="ops-closeout-crew-list">
                {live.navigators.map((navigator, index) => (
                  <div className="ops-closeout-crew-row" key={`navigator-${index}`}>
                    <label>
                      <span>{crewMode && index>=(dailyCrew.current?.navigators.length || 0)?`Additional crew ${index-(dailyCrew.current?.navigators.length || 0)+1}`:`Navigator ${index + 1}`}</span>
                      <select disabled={crewMode && index<(dailyCrew.current?.navigators.length || 0)} value={navigator.value} onChange={(event) => setNavigator(index, event.target.value)}>
                        {live.navigatorOptions.map((option) => <option key={`navigator-${index}-${option.value}`} value={option.value}>{option.label || "Choose navigator"}</option>)}
                      </select>
                    </label>
                    <button type="button" className="ops-button subtle" disabled={crewMode && index<(dailyCrew.current?.navigators.length || 0)} onClick={() => removeNavigator(index)}>Remove</button>
                  </div>
                ))}
              </div>
              <button type="button" className="ops-button subtle" onClick={addNavigator}>{crewMode?'+ Add additional crew':'+ Add another navigator'}</button>
            </section>

            <section data-closeout-step={photoSteps ? "1" : "0"} className="appointment-create-section">
              <h4>Actual Job Time</h4>
              {hasGpsTimes ? <><p>Truck GPS: {onsiteTimeFacts(job.onsiteTime!).filter(fact=>fact.label!=='On-site time').map(fact=>`${fact.label} ${fact.value}`).join(' · ')}. Rounded to JunkWare’s available minutes.</p>
                <button type="button" className="ops-button subtle" onClick={()=>{setReviewing(false);gpsDefaults.current={...gpsTimes};setLive(current=>{if(!current)return current;const next={...current};for(const key of Object.keys(gpsTimes) as CloseoutTimeKey[])next[key]={...next[key],value:gpsTimes[key]!};return next;});}}>Use GPS times</button></> : <p>Confirmed GPS visit times are unavailable for this truck. Enter the actual job times.</p>}
              {hasGpsTimes && !gpsTimes.actualEndHour && <p>GPS departure has not been recorded. Enter the finish time when confirmed.</p>}
              <div className="ops-closeout-time-grid">
                <span>Started</span>
                <select aria-label="Actual start hour" value={live.actualStartHour.value} onChange={(event) => updateSelect("actualStartHour", event.target.value)}>{live.actualStartHour.options.map((option) => <option key={`sh-${option.value}`} value={option.value}>{option.label || "Hour"}</option>)}</select>
                <select aria-label="Actual start minute" value={live.actualStartMinute.value} onChange={(event) => updateSelect("actualStartMinute", event.target.value)}>{live.actualStartMinute.options.map((option) => <option key={`sm-${option.value}`} value={option.value}>{option.label || "Minute"}</option>)}</select>
                <span>Finished</span>
                <select aria-label="Actual finish hour" value={live.actualEndHour.value} onChange={(event) => updateSelect("actualEndHour", event.target.value)}>{live.actualEndHour.options.map((option) => <option key={`eh-${option.value}`} value={option.value}>{option.label || "Hour"}</option>)}</select>
                <select aria-label="Actual finish minute" value={live.actualEndMinute.value} onChange={(event) => updateSelect("actualEndMinute", event.target.value)}>{live.actualEndMinute.options.map((option) => <option key={`em-${option.value}`} value={option.value}>{option.label || "Minute"}</option>)}</select>
              </div>
            </section>

            <section data-closeout-step="1" className="appointment-create-section">
              <h4>Job Charges</h4>
              <div className="appointment-closeout-grid">
                <label><span>Full trucks</span><input value={live.loadQuantity} inputMode="decimal" onChange={(event) => updateLoadQuantity(event.target.value)} /></label>
                <label><span>Load size</span><select value={live.loadSize.value} onChange={(event) => updateLoadSize(event.target.value)}>{live.loadSize.options.map((option) => <option key={`load-${option.value}`} value={option.value}>{option.label || "Full truck / none"}</option>)}</select></label>
                <p>Truck count and load size fill the load price from JunkWare rates. You can adjust the quoted price before discount. For half a truck (3/6), enter 0 full trucks and select 3 (1/2).</p>
                <label><span>Load price</span><input value={live.loadPrice} inputMode="decimal" onChange={(event) => update("loadPrice", event.target.value)} /></label>
                <label><span>Bedload quantity</span><input value={live.bedloadQuantity} inputMode="decimal" onChange={(event) => updateBedloadQuantity(event.target.value)} /></label>
                <label><span>Bedload size</span><select value={live.bedloadSize.value} onChange={(event) => updateBedloadSize(event.target.value)}>{live.bedloadSize.options.map((option) => <option key={`bed-${option.value}`} value={option.value}>{option.label || "None"}</option>)}</select></label>
                <label><span>Bedload price</span><input value={live.bedloadPrice} inputMode="decimal" onChange={(event) => update("bedloadPrice", event.target.value)} /></label>
                {category === 'Job' && <label><span>Job category</span><select value={live.jobCategory.value} onChange={(event) => updateSelect("jobCategory", event.target.value)}>{live.jobCategory.options.map((option) => <option key={`category-${option.value}`} value={option.value}>{option.label || "Choose category"}</option>)}</select></label>}
                {live.howHeard && <label><span>How heard</span><select value={live.howHeard.value} onChange={event => update("howHeard", { ...live.howHeard!, value: event.target.value })}>{live.howHeard.options.map(option => <option key={option.value} value={option.value}>{option.label || "Choose how heard"}</option>)}</select></label>}
              </div>
              <div className="ops-closeout-other-charges">
                <h5>Other Charges</h5>
                {live.otherCharges.length ? (
                  <div className="ops-closeout-charge-list" aria-label="Existing Other Charges">
                    {live.otherCharges.map((charge, index) => (
                      <div key={`existing-charge-${index}`}>
                        <span>{charge.label}</span>
                        <span>{charge.quantity ? `${charge.quantity} × ${charge.price}` : charge.price}</span>
                        <strong>{charge.total}</strong>
                      </div>
                    ))}
                  </div>
                ) : null}
                {pendingOtherCharges.length ? (
                  <div className="ops-closeout-charge-list pending" aria-label="Other Charges to add">
                    {pendingOtherCharges.map((charge) => (
                      <div key={charge.clientId}>
                        <span><small>To add</small>{charge.label}</span>
                        <span>{charge.typeValue.split("|")[2] === "1" ? `${charge.typeValue.split("|")[1]}% of job total` : `${charge.quantity} × $${charge.price}`}</span>
                        <button type="button" className="ops-closeout-text-button" onClick={() => removePendingOtherCharge(charge.clientId)}>Remove</button>
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="ops-closeout-charge-entry">
                  <label>
                    <span>Other charge</span>
                    <select value={otherChargeType} onChange={(event) => selectOtherCharge(event.target.value)}>
                      {live.otherChargeOptions.map((option) => <option key={`other-charge-${option.value}`} value={option.value}>{option.label || "Choose charge"}</option>)}
                    </select>
                  </label>
                  <label><span>Qty</span><input value={otherChargeQuantity} inputMode="decimal" onChange={(event) => setOtherChargeQuantity(event.target.value)} /></label>
                  <label className={otherChargePriceIsAutomatic ? "is-disabled" : ""}><span>Price / amount</span><input value={otherChargePrice} inputMode="decimal" placeholder={otherChargePriceIsAutomatic ? `${otherChargeType.split("|")[1]}% auto` : ""} disabled={otherChargePriceIsAutomatic} onChange={(event) => setOtherChargePrice(event.target.value)} /></label>
                  <button type="button" className="ops-button subtle" onClick={addOtherCharge}>+ Add charge</button>
                </div>
              </div>
            </section>

            {totals && <div data-closeout-step="1" className="ops-closeout-totals" aria-label="Draft charge totals" aria-live="polite">
              <div><span>Subtotal</span><strong>{money(totals.subtotal)}</strong></div>
              <small>Before discount and tip{totals.estimated ? ' · Percentage fees estimated' : ''}</small>
                <label><span>Discount</span><input value={live.discount} inputMode="decimal" onChange={(event) => update("discount", event.target.value)} /></label>
                <label><span>Tip</span><input value={live.tip} inputMode="decimal" onChange={(event) => update("tip", event.target.value)} /></label>
              <div><span>Total after discount and tip</span><strong>{money(totals.total)}</strong></div>
            </div>}
            <section data-closeout-step={photoSteps ? "3" : "2"} className="appointment-create-section">
              <h4>Payments</h4>
              {live.payments.length ? <div className="ops-closeout-payments">{live.payments.map((payment, index) => <div key={`payment-${index}`}><span>{payment.description}</span><strong>{payment.amount}</strong></div>)}</div> : <p>No payment has been entered in Junkware.</p>}
              <label className="ops-closeout-payment-toggle"><input type="checkbox" checked={addPayment} disabled={!live.paymentMethods.some(option => option.value)} onChange={(event) => setAddPayment(event.target.checked)} /> <span>{crewMode?"Record a collected payment":"Add a payment"}</span></label>
              {!live.paymentMethods.some(option => option.value) && <p role="alert">Payment methods could not be loaded. Reload from JunkWare to try again.</p>}
              {addPayment ? <div className="ops-closeout-payment-entry">
                <fieldset className="ops-closeout-payment-methods"><legend>Payment method</legend>
                  {live.paymentMethods.filter(option => option.value && (!crewMode || !/billed/i.test(option.label))).map(option => <label key={option.value}><input type="radio" name={paymentGroupId} value={option.value} checked={paymentMethod === option.value} onChange={() => { setPaymentMethod(option.value); setPaymentReference(""); setReviewing(false); }} /><span>{option.label}</span></label>)}
                </fieldset>
                <label><span>Payment amount</span><input aria-label="Payment amount" value={paymentAmount} inputMode="decimal" placeholder="Amount" onChange={(event) => setPaymentAmount(event.target.value)} /></label>
                {paymentReferenceLabel(live.paymentMethods.find(option => option.value === paymentMethod)) && <label><span>{paymentReferenceLabel(live.paymentMethods.find(option => option.value === paymentMethod))}</span><input aria-label={paymentReferenceLabel(live.paymentMethods.find(option => option.value === paymentMethod))} value={paymentReference} maxLength={/card/i.test(paymentReferenceLabel(live.paymentMethods.find(option => option.value === paymentMethod))) ? 4 : 30} onChange={event => setPaymentReference(event.target.value)} /></label>}
                <p>{crewMode?"Record money already collected. This does not charge a card. Payments already recorded in JunkWare are shown above; do not enter them again.":"Records payment information in JunkWare. Card charges processed through JunkWare are added automatically; record a card payment here only if it was already collected elsewhere. Billed means payment is still owed."}</p>
              </div> : null}
            </section>

            </>}
            {!canWrite && <p role="status">{crewMode?"This closeout is read-only. Check the saved result or contact dispatch.":"Your role can read this closeout. A manager must save changes."}</p>}
            </fieldset>
            <button type="button" className="ops-button subtle" onClick={() => void load()} disabled={saving || loading || photoSteps?.busy || Boolean(receipt && ['pending', 'uncertain'].includes(receipt.status))}>Reload from JunkWare</button>
          </>
        )}
        {message ? <div className="ops-closeout-editor-message success">{message}</div> : null}
        {error && !live ? <div className="ops-closeout-editor-message error">{error}</div> : null}
        {!actionHost && actions}
      </div>
      {actionHost && actions && createPortal(actions, actionHost)}
    </details>
  );
}
