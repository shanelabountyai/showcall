import { crewStream } from '../../../../../src/live/routes';

/** The crew portal stream (D-040, D-041): the token in the path is the only credential, re-checked every poll. */
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  return crewStream(request, (await params).token);
}
