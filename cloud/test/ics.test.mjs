import { parseICS } from '../src/index.js';
const ics = 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:a1\r\nDTSTART;TZID=Europe/Paris:20261013T080000\r\nDTEND;TZID=Europe/Paris:20261013T100000\r\nSUMMARY:Outils Mathématiques Appliquées - DS Etudiants Bachelor CSIU 1 Lyon - S\r\n 3\r\nLOCATION:LL101E\r\nX-TEACHERS:DUPONT Jean\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nUID:b2\r\nDTSTART:20261012T120000Z\r\nSUMMARY:Rattrapage Gestion Capital Humain\r\nEND:VEVENT\r\nEND:VCALENDAR';
const [b, a] = parseICS(ics);
const eq = (x, y) => { if (x !== y) throw new Error(`${x} !== ${y}`); };
eq(a.subject, 'Outils Mathématiques Appliquées'); eq(a.type, 'DS'); eq(a.start, '2026-10-13T08:00'); eq(a.end, '2026-10-13T10:00'); eq(a.room, 'LL101E'); eq(a.uid, '2026-10-13T08:00|Outils Mathématiques Appliquées');
eq(b.subject, 'Rattrapage Gestion Capital Humain'); eq(b.start, '2026-10-12T14:00'); // UTC -> Paris
console.log('ics OK');

import { diffSchedule } from '../src/index.js';
const prev = { horizon: '2026-10-22T23:59', items: [['2026-10-14T10:00|Anglais', 'A1'], ['2026-10-15T08:00|Maths', 'B2'], ['2026-10-16T08:00|Réseau', 'C3'], ['2026-10-01T08:00|Passé', '']] };
const cur = { horizon: '2026-10-23T23:59', items: [['2026-10-15T14:00|Anglais', 'A1'], ['2026-10-15T08:00|Maths', 'B9'], ['2026-10-23T08:00|Hors fenêtre', '']] };
const lines = diffSchedule(prev, cur, '2026-10-08T12:00');
eq(lines.length, 3);
eq(lines[0], 'Anglais déplacé : mer. 14/10 10h00 → jeu. 15/10 14h00');
eq(lines[1], 'Réseau annulé (ven. 16/10 08h00)');
eq(lines[2], 'Maths jeu. 15/10 08h00 : salle B9');
console.log('diff OK');

import { mergeBlocks } from '../src/index.js';
const ev = (start, end, subject = 'Réseau', type = 'CM', room = 'A') => ({ uid: start + '|' + subject, start, end, subject, type, room });
const mb = mergeBlocks([ev('2026-10-09T10:00', '2026-10-09T12:00'), ev('2026-10-09T08:00', '2026-10-09T10:00'), ev('2026-10-09T13:30', '2026-10-09T15:30'), ev('2026-10-09T15:30', '2026-10-09T17:30', 'Réseau', 'TD', 'B'), ev('2026-10-09T17:30', '2026-10-09T18:30', 'Maths')]);
eq(mb.length, 3);
eq(mb[0].start + '-' + mb[0].end, '2026-10-09T08:00-2026-10-09T12:00'); eq(mb[0].uid, '2026-10-09T08:00|Réseau'); eq(mb[0].parts.length, 2);
eq(mb[1].start + '-' + mb[1].end, '2026-10-09T13:30-2026-10-09T17:30'); eq(mb[1].type, 'CM + TD'); eq(mb[1].room, 'A / B');
eq(mb[2].subject, 'Maths'); // autre matière : jamais fusionnée
console.log('fusion OK');

import { nameDate } from '../src/index.js';
const nd = (s) => JSON.stringify(nameDate(s, '2026-10-08'));
eq(nd('8 octobre 2026 à 23:41'), '{"day":"2026-10-08","time":"23:41"}');
eq(nd('1er sept. à 13h45'), '{"day":"2026-09-01","time":"13:45"}');
eq(nd('Réseau 09/10/2026 08h05'), '{"day":"2026-10-09","time":"08:05"}');
eq(nd('2026-09-15 10.12'), '{"day":"2026-09-15","time":"10:12"}');
eq(nd('5 décembre'), '{"day":"2025-12-05","time":null}'); // dans le futur → l'année d'avant
eq(nd('Cours éthique partie 2'), 'null');
eq(nd('Rue Pierre Audry'), 'null');
console.log('noms OK');

import { fixName } from '../src/index.js';
eq(fixName('9 oct. 2026 \uFFFD 08:03'), '9 oct. 2026 à 08:03');
eq(fixName('3 f\uFFFDvr. 2027 \uFFFD 10:15'), '3 févr. 2027 à 10:15');
eq(fixName('Cours r\uFFFDseau'), 'Cours réseau');
eq(fixName('Sans accent'), 'Sans accent');
eq(nd(fixName('3 f\uFFFDvr. 2027 \uFFFD 10:15')), '{"day":"2027-02-03","time":"10:15"}');
console.log('noms abîmés OK');
