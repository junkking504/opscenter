import { crewPhoneBody, crewPhoneFailure, crewPhoneResponse, requireCrewPhone } from '@/lib/crew-phone-http';
import { requireCrewDay } from '@/lib/crew-phone-day';
import { crewInspectionDevice, crewInspectionReport } from '@/lib/crew-phone-inspection';
import { CrewPhoneError } from '@/lib/crew-phone';
import { InspectionError, inspectionDate } from '@/lib/truck-inspection';
import { findTruckInspection, submitTruckInspection } from '@/lib/truck-inspection-store';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function failure(error: unknown) {
  return crewPhoneFailure(error instanceof InspectionError ? new CrewPhoneError(error.message, error.statusCode) : error);
}

export async function GET(request: Request) {
  try {
    const phone = requireCrewPhone(request), day = requireCrewDay(phone), device = crewInspectionDevice(phone, day);
    const params = new URL(request.url).searchParams;
    if ([...params.keys()].some(key => key !== 'requestId')) throw new CrewPhoneError('Use today’s truck inspection.');
    const requestId = params.get('requestId');
    if (requestId) return crewPhoneResponse({ report: findTruckInspection(device.deviceId, requestId) });
    return crewPhoneResponse({ device, trucks: [day.truck], inspectors: [day.responsible], date: day.date, dayVersion: day.version, report: crewInspectionReport(phone, day) });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    const body = await crewPhoneBody(request, 5_100_000);
    const phone = requireCrewPhone(request), day = requireCrewDay(phone), device = crewInspectionDevice(phone, day);
    if (body.action !== 'submit' || body.dayVersion !== day.version) throw new CrewPhoneError('Today’s truck setup changed. Return to setup before inspecting.', 409);
    const report = body.report as Record<string, unknown> | undefined;
    if (!report || report.truck !== day.truck || typeof report.startedAt !== 'string' || !Number.isFinite(Date.parse(report.startedAt)) || inspectionDate(new Date(report.startedAt)) !== day.date) throw new CrewPhoneError('Inspect today’s selected truck. Return to setup if the truck changed.', 409);
    return crewPhoneResponse({ report: submitTruckInspection(report, device) });
  } catch (error) { return failure(error); }
}
