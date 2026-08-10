export const FLEET_CHECKLIST_CADENCES = ["daily", "weekly", "monthly"] as const;
export type FleetChecklistCadence = (typeof FLEET_CHECKLIST_CADENCES)[number];

export const FLEET_CHECKLIST_ITEM_STATUSES = ["pass", "attention", "na"] as const;
export type FleetChecklistItemStatus = (typeof FLEET_CHECKLIST_ITEM_STATUSES)[number];

export type FleetChecklistDefinition = {
  itemId: string;
  category: string;
  label: string;
  guidance: string;
};

export type FleetChecklistCustomization = {
  truck: string;
  cadence: FleetChecklistCadence;
  hiddenItemIds: string[];
  customItems: FleetChecklistDefinition[];
  updatedAt: string;
};

export const FLEET_CHECKLIST_DEFINITIONS: Record<FleetChecklistCadence, FleetChecklistDefinition[]> = {
  daily: [
    { itemId: "daily-fluids", category: "Under hood", label: "Engine oil, coolant, and fluids", guidance: "Check levels and look for visible leaks." },
    { itemId: "daily-tires", category: "Walkaround", label: "Tires and wheels", guidance: "Look for low pressure, cuts, damage, or loose lug nuts." },
    { itemId: "daily-lights", category: "Walkaround", label: "Lights and signals", guidance: "Check headlights, brake lights, hazards, and turn signals." },
    { itemId: "daily-glass", category: "Cab", label: "Windshield, mirrors, and wipers", guidance: "Confirm clear visibility and proper wiper operation." },
    { itemId: "daily-brakes", category: "Safety", label: "Brakes and parking brake", guidance: "Check normal response before leaving the yard." },
    { itemId: "daily-horn", category: "Safety", label: "Horn, backup alarm, and camera", guidance: "Confirm audible warnings and camera view work." },
    { itemId: "daily-lift", category: "Body / lift", label: "Lift, hydraulics, and safety locks", guidance: "Inspect hoses and test normal operation without leaks." },
    { itemId: "daily-body", category: "Body / lift", label: "Box, doors, and exterior", guidance: "Check latches, panels, steps, and new body damage." },
    { itemId: "daily-safety", category: "Safety", label: "Safety equipment", guidance: "Confirm cones, extinguisher, first aid kit, and PPE are aboard." },
    { itemId: "daily-tools", category: "Equipment", label: "Tools, straps, and supplies", guidance: "Confirm required equipment is present and secured." },
    { itemId: "daily-cab", category: "Cab", label: "Cab cleanliness and warning lights", guidance: "Remove trash and report any dashboard warning light." },
    { itemId: "daily-fuel", category: "Ready status", label: "Fuel / DEF and ready for route", guidance: "Confirm adequate fuel, DEF when applicable, and no blocking defect." },
  ],
  weekly: [
    { itemId: "weekly-pressure", category: "Tires", label: "Tire pressure and tread depth", guidance: "Measure all tires and inspect for uneven wear." },
    { itemId: "weekly-hydraulics", category: "Body / lift", label: "Hydraulic fluid, cylinders, and hoses", guidance: "Inspect fluid level, fittings, hoses, and cylinders closely." },
    { itemId: "weekly-battery", category: "Under hood", label: "Battery and electrical connections", guidance: "Check terminals, hold-down, corrosion, and visible wiring." },
    { itemId: "weekly-belts", category: "Under hood", label: "Belts, hoses, and air filter", guidance: "Look for cracks, rubbing, loose fittings, or restriction." },
    { itemId: "weekly-brakes", category: "Chassis", label: "Brake components and air system", guidance: "Inspect visible components and listen for air leaks." },
    { itemId: "weekly-suspension", category: "Chassis", label: "Suspension and steering", guidance: "Check springs, shocks, steering linkage, and unusual play." },
    { itemId: "weekly-emergency", category: "Safety", label: "Emergency equipment inspection", guidance: "Inspect extinguisher gauge, first aid stock, triangles, and cones." },
    { itemId: "weekly-clean", category: "Condition", label: "Detailed cab and box cleanout", guidance: "Clean the truck and remove loose debris from work areas." },
  ],
  monthly: [
    { itemId: "monthly-service", category: "Service", label: "Oil and preventive-service interval", guidance: "Compare current mileage with the next scheduled service." },
    { itemId: "monthly-brakes", category: "Chassis", label: "Brake wear inspection", guidance: "Inspect pads, rotors or drums, lines, and parking brake." },
    { itemId: "monthly-tires", category: "Tires", label: "Tire rotation and replacement review", guidance: "Review tread wear, age, matching, and rotation needs." },
    { itemId: "monthly-lift", category: "Body / lift", label: "Lift lubrication and structural inspection", guidance: "Lubricate service points and inspect welds, pins, and locks." },
    { itemId: "monthly-drivetrain", category: "Chassis", label: "Drivetrain, steering, and suspension", guidance: "Look for leaks, looseness, wear, or unusual noise." },
    { itemId: "monthly-safety", category: "Compliance", label: "Registration and safety documents", guidance: "Confirm current documents and required inspection materials are aboard." },
    { itemId: "monthly-inventory", category: "Equipment", label: "Equipment and supply inventory", guidance: "Reconcile tools, straps, PPE, and consumable supplies." },
    { itemId: "monthly-roadtest", category: "Condition", label: "Road test and overall condition", guidance: "Check handling, braking, noises, warning lights, and general condition." },
  ],
};

export function fleetChecklistPeriodKey(date: string, cadence: FleetChecklistCadence): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  if (cadence === "daily") return date;
  if (cadence === "monthly") return date.slice(0, 7);

  const [year, month, day] = date.split("-").map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  const weekday = value.getUTCDay();
  const daysSinceMonday = weekday === 0 ? 6 : weekday - 1;
  value.setUTCDate(value.getUTCDate() - daysSinceMonday);
  return value.toISOString().slice(0, 10);
}

export function fleetChecklistCadenceLabel(cadence: FleetChecklistCadence): string {
  return cadence.charAt(0).toUpperCase() + cadence.slice(1);
}

export function effectiveFleetChecklistDefinitions(
  truck: string,
  cadence: FleetChecklistCadence,
  customizations: FleetChecklistCustomization[],
): FleetChecklistDefinition[] {
  const customization = customizations.find((row) => row.truck === truck && row.cadence === cadence);
  if (!customization) return FLEET_CHECKLIST_DEFINITIONS[cadence];
  const hiddenIds = new Set(customization.hiddenItemIds);
  return [
    ...FLEET_CHECKLIST_DEFINITIONS[cadence].filter((item) => !hiddenIds.has(item.itemId)),
    ...customization.customItems,
  ];
}
