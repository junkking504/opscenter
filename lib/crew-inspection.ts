import { CrewPhoneError } from './crew-phone';
import { crewPhoneBody, crewPhoneFailure, crewPhoneResponse, requireCrewPhone } from './crew-phone-http';
import { readCrewDay } from './crew-phone-day';
import { InspectionError, inspectionDate, type InspectionDevice } from './truck-inspection';
import { findTruckInspection, submitTruckInspection } from './truck-inspection-store';

/** Inspections share the enrolled crew phone; no second device or cookie is issued. */
export async function crewInspection(request: Request) {
  try {
    const phone = requireCrewPhone(request);
    const device: InspectionDevice = { ...phone, createdAt: phone.enrolledAt };
    if (request.method === 'GET') {
      const requestId = new URL(request.url).searchParams.get('requestId');
      if (requestId) return crewPhoneResponse({ report: findTruckInspection(phone.deviceId, requestId) });
      const day = readCrewDay(phone);
      return crewPhoneResponse({ device, trucks: [phone.truck], date: inspectionDate(),
        inspectors: day ? [...new Set([day.responsible, day.driver, ...day.navigators])] : [],
        defaultInspector: day?.responsible || '', truckLocked: true });
    }
    if (request.method !== 'POST') return crewPhoneResponse({ error: 'Method not allowed.' }, 405, { Allow: 'GET, POST' });
    const body = await crewPhoneBody(request, 5_100_000);
    if (body.action !== 'submit') throw new CrewPhoneError('Choose a valid inspection action.');
    const report = body.report;
    if (!report || typeof report !== 'object' || Array.isArray(report)) throw new CrewPhoneError('Enter an inspection.');
    if ((report as Record<string, unknown>).truck !== phone.truck) throw new CrewPhoneError('This phone can inspect only its assigned truck.', 403);
    requireCrewPhone(request); // Recheck after receiving the photo payload.
    return crewPhoneResponse({ report: submitTruckInspection(report, device) });
  } catch (error) {
    if (error instanceof InspectionError) return crewPhoneResponse({ error: error.message }, error.statusCode);
    return crewPhoneFailure(error);
  }
}
