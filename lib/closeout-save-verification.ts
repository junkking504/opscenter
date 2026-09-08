import { closeoutSourceVersion } from './desktop-closeout-contract';

export class CloseoutNotAppliedError extends Error {}

/** A submit timeout can follow a successful save. Always reopen, never replay. */
export async function saveAndVerifyCloseout<T extends Record<string, unknown>>(
  before: T,
  submit: () => Promise<void>,
  reopen: () => Promise<T>,
  verify: (source: T) => void,
): Promise<T> {
  let submitError: unknown;
  try { await submit(); } catch (error) { submitError = error; }
  const persisted = await reopen();
  try { verify(persisted); }
  catch (error) {
    const cause = submitError || error;
    const message = cause instanceof Error ? cause : new Error('The source closeout could not be verified.');
    if (closeoutSourceVersion(persisted) === closeoutSourceVersion(before)) throw new CloseoutNotAppliedError(message.message);
    throw message;
  }
  return persisted;
}
