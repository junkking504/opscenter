type AppointmentAuditInput = {
  appointmentType: unknown;
  status: unknown;
};

type PaymentAuditInput = AppointmentAuditInput & {
  paymentAmount: unknown;
  paymentType: unknown;
};

type PhotoAuditInput = AppointmentAuditInput & {
  photoAuditAvailable: boolean;
  photoCount: number;
};

export function isEstimateAppointment(appointmentType: unknown): boolean {
  return /estimate/i.test(String(appointmentType || ""));
}

export function isClosedAppointment(status: unknown): boolean {
  const value = String(status || "").toLowerCase();
  return value.includes("completed") || value.includes("closed") || value.includes("paid");
}

export function shouldFlagMissingPaymentType(input: PaymentAuditInput): boolean {
  const amount = Number(String(input.paymentAmount || 0).replace(/[^0-9.-]/g, "")) || 0;
  const paymentType = String(input.paymentType || "").trim();
  return isClosedAppointment(input.status)
    && !isEstimateAppointment(input.appointmentType)
    && amount > 0
    && !paymentType;
}

export function shouldFlagMissingPhotos(input: PhotoAuditInput): boolean {
  return isClosedAppointment(input.status)
    && input.photoAuditAvailable
    && input.photoCount === 0;
}

export function missingPaymentTypeLabel(appointmentType: unknown, compact = false): string {
  if (isEstimateAppointment(appointmentType)) {
    return compact ? "Payment Not Required" : "Not Required For Estimate";
  }
  return compact ? "Payment Not Selected" : "Unavailable";
}
