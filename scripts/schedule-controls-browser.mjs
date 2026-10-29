// Use the same disclosure as an operator; phone controls stay inline.
export async function openScheduleControls(page) {
  await page.locator('.schedule-board-tools').waitFor({state:'attached'});
  const toggle=page.locator('.schedule-board-controls-trigger');
  if(await toggle.isVisible() && await toggle.getAttribute('aria-expanded')==='false') await toggle.click();
}
export async function closeScheduleControls(page) {
  const toggle=page.locator('.schedule-board-controls-trigger');
  if(await toggle.isVisible() && await toggle.getAttribute('aria-expanded')==='true') await toggle.click();
}
