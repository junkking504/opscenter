export async function getDashboardData(date?: string) {
  return {
    revenueToday: 0,
    collectionsToday: 0,
    jobsCompleted: 0,
    jobsRemaining: 0,
    activeTrucks: 0,
    activeCrew: 0,
    truckRph: 0,
    crewRph: 0,
    attentionRequired: []
  };
}
