import { isDeepStrictEqual } from 'node:util';
import type { Clock } from '../clock';
import { prisma } from '../db';
import { renderBlocksPdf, type DocumentBlock } from '../pdf/render';
import { loadRunSheet, type RunSheetRow } from '../runsheet/cascade';
import { hhmm, shortDay, type LocalDate } from '../time';

/**
 * Call sheets (P0-2, D-008). A role's sheet is an explicit projection of the
 * run sheet: only the cues tagged to that role, and of each cue only its
 * label, room, day and times. Sessions, other roles' cues, anchors, slack and
 * speakers never reach it — the florist never sees the toast order. A field
 * added to Cue stays off every sheet until it is added to `CallSheetRow`, and
 * the disclosure sweep in callsheet.test.ts checks every role against every
 * other (hard rule 7).
 */
export type CallSheetRow = { cueId: string; label: string; room: string; day: LocalDate; startMin: number; endMin: number };
export type CallSheet = { role: string; reportTo: string; rows: CallSheetRow[] };
export type CallSheetDiff = {
  added: CallSheetRow[]; removed: CallSheetRow[];
  changed: { from: CallSheetRow; to: CallSheetRow }[];
  reportTo?: { from: string; to: string };
};

/** Tags from another event cannot leak in: only rows of this run sheet are candidates. */
export function projectCallSheet(role: { name: string; reportTo: string }, tagged: Set<string>, rows: RunSheetRow[]): CallSheet {
  return {
    role: role.name, reportTo: role.reportTo,
    rows: rows
      .filter((r) => r.kind === 'cue' && tagged.has(r.id))
      .map((r) => ({ cueId: r.id, label: r.label, room: r.room, day: r.day, startMin: r.startMin, endMin: r.endMin })),
  };
}

/** Changed since the last issue. `prev` null is a first issue: everything is added. */
export function diffCallSheets(prev: CallSheet | null, next: CallSheet): CallSheetDiff {
  const before = new Map((prev?.rows ?? []).map((r) => [r.cueId, r]));
  const after = new Set(next.rows.map((r) => r.cueId));
  return {
    added: next.rows.filter((r) => !before.has(r.cueId)),
    removed: (prev?.rows ?? []).filter((r) => !after.has(r.cueId)),
    changed: next.rows.flatMap((to) => { const from = before.get(to.cueId); return from && !isDeepStrictEqual(from, to) ? [{ from, to }] : []; }),
    ...(prev && prev.reportTo !== next.reportTo && { reportTo: { from: prev.reportTo, to: next.reportTo } }),
  };
}

/** The run sheet is behind the agenda or has problems. Nothing was issued. */
export class CallSheetsBlocked extends Error {}

async function drafts(eventId: string) {
  const [sheet, roles] = await Promise.all([
    loadRunSheet(eventId),
    prisma.callRole.findMany({
      where: { eventId }, orderBy: { name: 'asc' },
      include: { cues: { select: { cueId: true } }, issues: { orderBy: { number: 'desc' }, take: 1 } },
    }),
  ]);
  return {
    sheet,
    roles: roles.map((role) => {
      const last = role.issues[0] ?? null;
      const prev = last && (last.content as CallSheet);
      const content = projectCallSheet(role, new Set(role.cues.map((c) => c.cueId)), sheet.rows);
      return { role, last, prev, content, changed: !prev || !isDeepStrictEqual(prev, content) };
    }),
  };
}

/**
 * Per role: the last issue, whether it is stale, and what changed since it.
 * Stale (D-009) is the run sheet being behind the agenda — the sheets cannot
 * be trusted until it is rebased — or the sheet no longer matching its last
 * issue. A sheet a rebase left unchanged is current, whatever version it
 * records. `changes` is measured against the run sheet as pinned.
 */
export async function callSheetStatus(eventId: string) {
  const { sheet, roles } = await drafts(eventId);
  return roles.map(({ role, last, prev, content, changed }) => ({
    roleId: role.id, role: role.name, lastIssue: last?.number ?? 0,
    stale: !!last && (sheet.stale || changed),
    changes: changed ? diffCallSheets(prev, content) : null,
  }));
}

/**
 * Issue a new version for every role whose sheet changed since its last
 * issue, and only those. Refused while the run sheet is stale or has
 * problems: a sheet issued from it would send out times that are wrong.
 */
export async function issueCallSheets(eventId: string, clock: Clock) {
  const { sheet, roles } = await drafts(eventId);
  if (sheet.stale) throw new CallSheetsBlocked(`The run sheet is built from agenda v${sheet.agendaVersion}; rebase it onto v${sheet.currentVersion} before issuing call sheets`);
  if (sheet.problems.length) throw new CallSheetsBlocked(`The run sheet has problems:\n${sheet.problems.map((p) => p.message).join('\n')}`);
  const issued = [];
  // ponytail: one role per insert, no event lock — a concurrent issue collides on (roleId, number) and fails; lock the event if two producers issue at once.
  for (const { role, last, prev, content, changed } of roles) {
    if (!changed) continue;
    const issue = await prisma.callSheetIssue.create({
      data: { roleId: role.id, number: (last?.number ?? 0) + 1, agendaVersion: sheet.agendaVersion, content, issuedAt: clock.now() },
    });
    issued.push({ issue, diff: diffCallSheets(prev, content) });
  }
  return issued;
}

const when = (r: CallSheetRow) => `${hhmm(r.startMin)}–${hhmm(r.endMin)} ${shortDay(r.day)}`;
const line = (r: CallSheetRow) => `${hhmm(r.startMin)}–${hhmm(r.endMin)} · ${r.room} · ${r.label}`;

/** The PDF for an issue. Regenerable: it reads only the stored issue, and `prev` (the issue before it) for the changes. */
export function renderCallSheetPdf(
  eventName: string,
  issue: { number: number; agendaVersion: number; issuedAt: Date; content: unknown },
  prev: { content: unknown } | null,
) {
  const sheet = issue.content as CallSheet;
  const blocks: DocumentBlock[] = [
    { kind: 'heading', text: `${sheet.role} call sheet` },
    { kind: 'meta', text: `${eventName} · Issue ${issue.number} · agenda v${issue.agendaVersion} · issued ${issue.issuedAt.toISOString().slice(0, 16).replace('T', ' ')} UTC` },
  ];
  if (sheet.reportTo) blocks.push({ kind: 'subheading', text: 'Report to' }, { kind: 'paragraph', text: sheet.reportTo });

  if (prev) {
    const d = diffCallSheets(prev.content as CallSheet, sheet);
    const changes = [
      ...d.added.map((r) => `Added: ${r.label}, ${when(r)}, ${r.room}`),
      ...d.removed.map((r) => `Removed: ${r.label}, was ${when(r)}, ${r.room}`),
      ...d.changed.map(({ from, to }) => `Changed: ${to.label}, now ${when(to)}, ${to.room} (was ${from.label}, ${when(from)}, ${from.room})`),
      ...(d.reportTo ? [`Report to changed (was: ${d.reportTo.from || 'not set'})`] : []),
    ];
    if (changes.length) blocks.push({ kind: 'subheading', text: `Changed since issue ${issue.number - 1}` }, ...changes.map((text) => ({ kind: 'paragraph' as const, text })));
  }

  const days = Map.groupBy(sheet.rows, (r) => r.day);
  if (!days.size) blocks.push({ kind: 'paragraph', text: 'No cues on this sheet.' });
  // Rows are in run-sheet order, so a day's first row is its call.
  for (const [day, rows] of days) {
    blocks.push({ kind: 'subheading', text: `${shortDay(day)} — call ${hhmm(rows[0]!.startMin)}` }, ...rows.map((r) => ({ kind: 'paragraph' as const, text: line(r) })));
  }
  return renderBlocksPdf(blocks, { title: `${sheet.role} call sheet — ${eventName}, issue ${issue.number}` });
}
