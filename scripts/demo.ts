/**
 * Demo story for the Phase 1 gate (S-6): "the keynote moves 15 minutes."
 *
 * Run after `npm run db:seed`. Moves Day 1's Ballroom A keynote 15 minutes
 * later through the same `saveSession` + `publishAgenda` path the grid UI
 * uses, then rebases the run sheet and re-issues call sheets — narrating
 * exactly what moves and which roles' sheets actually change. Cascade
 * preview/commit and call-sheet issuing have no UI (P0-2's deliberate
 * scope); this script is how that half of the story gets shown.
 */
import { hhmm, shortDay, fromDbDate } from '../src/time';
import { saveSession } from '../src/agenda/grid';
import { publishAgenda } from '../src/agenda/publish';
import { systemClock } from '../src/clock';
import { prisma } from '../src/db';
import { commitCascade, loadRunSheet, previewCascade } from '../src/runsheet/cascade';
import { issueCallSheets } from '../src/callsheet/callsheet';

const event = await prisma.event.findFirstOrThrow({ where: { name: 'Northwind Leadership Summit' } });
const keynote = await prisma.session.findFirstOrThrow({
  where: { eventId: event.id, title: { startsWith: 'Opening keynote' } },
  include: { speakers: true },
});

console.log(`${event.name} — moving "${keynote.title}" (${shortDay(fromDbDate(keynote.day))}) from ${hhmm(keynote.startMin)}–${hhmm(keynote.endMin)} by 15 min.\n`);

await saveSession(event.id, {
  id: keynote.id, title: keynote.title, day: fromDbDate(keynote.day), roomId: keynote.roomId,
  startMin: keynote.startMin + 15, endMin: keynote.endMin + 15,
  speakerIds: keynote.speakers.map((s) => s.speakerId),
});
const version = await publishAgenda(event.id, systemClock);
console.log(`Published agenda v${version.number}.\n`);

const preview = await previewCascade(event.id, { rebase: true });
if (preview.problems.length) {
  console.log('Rebase blocked:');
  for (const p of preview.problems) console.log(`  ${p.message}`);
  process.exit(1);
}
const labels = new Map((await loadRunSheet(event.id)).rows.map((r) => [r.id, r.label]));
console.log(`Cascade: ${preview.moved.length} row(s) move.`);
for (const m of preview.moved) {
  const from = m.from ? `${hhmm(m.from.startMin)}–${hhmm(m.from.endMin)}` : '(new)';
  const to = m.to ? `${hhmm(m.to.startMin)}–${hhmm(m.to.endMin)}` : '(dropped)';
  console.log(`  ${labels.get(m.id) ?? m.id}: ${from} → ${to}`);
}
await commitCascade(event.id, { rebase: true }, preview.moved);
console.log('\nCommitted. Issuing call sheets...\n');

const issued = await issueCallSheets(event.id, systemClock);
if (!issued.length) {
  console.log('No role sheet changed — nothing re-issued.');
} else {
  for (const { issue, diff } of issued) {
    const role = await prisma.callRole.findUniqueOrThrow({ where: { id: issue.roleId } });
    console.log(`${role.name}: issue #${issue.number}`);
    for (const r of diff.added) console.log(`  added: ${r.label} ${hhmm(r.startMin)}–${hhmm(r.endMin)}`);
    for (const r of diff.removed) console.log(`  removed: ${r.label}`);
    for (const { from, to } of diff.changed) console.log(`  changed: ${to.label} ${hhmm(from.startMin)}–${hhmm(from.endMin)} → ${hhmm(to.startMin)}–${hhmm(to.endMin)}`);
  }
}
const allRoles = await prisma.callRole.findMany({ where: { eventId: event.id } });
const untouched = allRoles.filter((r) => !issued.some((i) => i.issue.roleId === r.id));
if (untouched.length) console.log(`\nUnchanged, not re-issued: ${untouched.map((r) => r.name).join(', ')}.`);

await prisma.$disconnect();
