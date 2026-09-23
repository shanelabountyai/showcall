import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';

/** Run an edit; a refusal comes back to `path` as ?error=, anything else is a bug and surfaces as one. An edit that returns URLSearchParams lands on `path` with them. */
export async function refusable(path: string, fn: () => Promise<unknown>, ...refusals: (abstract new (...a: never[]) => Error)[]) {
  let message: string | null = null;
  let result: unknown;
  try {
    result = await fn();
  } catch (e) {
    if (!refusals.some((R) => e instanceof R)) throw e;
    message = (e as Error).message;
  }
  if (message) redirect(`${path}?error=${encodeURIComponent(message)}`);
  revalidatePath(path);
  redirect(result instanceof URLSearchParams ? `${path}?${result}` : path);
}
