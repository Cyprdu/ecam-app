// Plan de lecture de la Bible en un an (une étape par jour à partir du 9 septembre 2026).
// Une étape non marquée comme lue reste à lire : le plan se décale d'autant.
const BIBLE_START = '2026-09-09';
const BIBLE_PLAN = [
  "Genèse 1-3", "Genèse 4-7", "Genèse 8-11", "Genèse 12-14", "Genèse 15-17", "Genèse 18-20",
  "Genèse 21-23", "Genèse 24-25", "Genèse 26-28", "Genèse 29-30", "Genèse 31-32", "Genèse 33-35",
  "Genèse 36-38", "Genèse 39-41", "Genèse 42-43", "Genèse 44-46", "Genèse 47-50", "Exode 1-3",
  "Exode 4-7", "Exode 8-9", "Exode 10-12", "Exode 13-15", "Exode 16-18", "Exode 19-21",
  "Exode 22-24", "Exode 25-27", "Exode 28-29", "Exode 30-32", "Exode 33-35", "Exode 36-38",
  "Exode 39-40", "Matthieu 1-4", "Matthieu 5-7", "Matthieu 8-10", "Matthieu 11-12", "Matthieu 13-14",
  "Matthieu 15-17", "Matthieu 18-20", "Matthieu 21-22", "Matthieu 23-24", "Matthieu 25-26", "Matthieu 27-28",
  "Marc 1-3", "Marc 4-5", "Marc 6-7", "Marc 8-9", "Marc 10-11", "Marc 12-13",
  "Marc 14-16", "Luc 1-2", "Luc 3-4", "Luc 5-6", "Luc 7-8", "Luc 9-10",
  "Luc 11-12", "Luc 13-15", "Luc 16-18", "Luc 19-21", "Luc 22-24", "Actes 1-2",
  "Actes 3-5", "Actes 6-7", "Actes 8-9", "Actes 10-12", "Actes 13-14", "Actes 15-16",
  "Actes 17-19", "Actes 20-21", "Actes 22-24", "Actes 25-26", "Actes 27-28", "Galates",
  "1 Thessaloniciens", "2 Thessaloniciens", "1 Corinthiens 1-4", "1 Corinthiens 5-8", "1 Corinthiens 9-12", "1 Corinthiens 13-16",
  "2 Corinthiens 1-4", "2 Corinthiens 5-9", "2 Corinthiens 10-13", "Romains 1-3", "Romains 4-7", "Romains 8-10",
  "Romains 11-13", "Romains 14-16", "Ephésiens", "Colossiens", "Philémon", "Philippiens",
  "1 Timothée", "2 Timothée", "Tite", "Hébreux 1-5", "Hébreux 6-9", "Hébreux 10-11",
  "Hébreux 12-13", "Jacques", "1 Pierre", "2 Pierre", "1 Jean", "2 Jean, 3 Jean, Jude",
  "Josué 1-3", "Josué 4-6", "Josué 7-8", "Josué 9-10", "Josué 11-13", "Josué 14-16",
  "Josué 17-19", "Josué 20-22", "Josué 23-24", "Juges 1-3", "Juges 4-5", "Juges 6-7",
  "Juges 8-9", "Juges 10-11", "Juges 12-14", "Juges 15-17", "Juges 18-19", "Juges 20-21",
  "Ruth", "1 Samuel 1-3", "1 Samuel 4-6", "1 Samuel 7-9", "1 Samuel 10-12", "1 Samuel 13-14",
  "1 Samuel 15-16", "1 Samuel 17-18", "1 Samuel 19-20", "1 Samuel 21-23", "1 Samuel 24-25", "1 Samuel 26-28",
  "1 Samuel 29-31", "2 Samuel 1-3", "2 Samuel 4-7", "2 Samuel 8-11", "2 Samuel 12-13", "2 Samuel 14-15",
  "2 Samuel 16-17", "2 Samuel 18-19", "2 Samuel 20-22", "2 Samuel 23-24", "1 Rois 1-2", "1 Rois 3-5",
  "1 Rois 6-7", "1 Rois 8", "1 Rois 9-10", "1 Rois 11-12", "1 Rois 13-14", "1 Rois 15-16",
  "1 Rois 17-18", "1 Rois 19-20", "1 Rois 21-22", "2 Rois 1-3", "2 Rois 4-5", "2 Rois 6-7",
  "2 Rois 8-9", "2 Rois 10-12", "2 Rois 13-15", "2 Rois 16-17", "2 Rois 18-19", "2 Rois 20-22",
  "2 Rois 23-25", "1 Chroniques 1-2", "1 Chroniques 3-5", "1 Chroniques 6-7", "1 Chroniques 8-10", "1 Chroniques 11-12",
  "1 Chroniques 13-16", "1 Chroniques 17-20", "1 Chroniques 21-23", "1 Chroniques 24-26", "1 Chroniques 27-29", "2 Chroniques 1-4",
  "2 Chroniques 5-7", "2 Chroniques 8-10", "2 Chroniques 11-14", "2 Chroniques 15-18", "2 Chroniques 19-21", "2 Chroniques 22-24",
  "2 Chroniques 25-27", "2 Chroniques 28-29", "2 Chroniques 30-32", "2 Chroniques 33-34", "2 Chroniques 35-36", "Esdras 1-3",
  "Esdras 4-6", "Esdras 7-8", "Esdras 9-10", "Néhémie 1-3", "Néhémie 4-6", "Néhémie 7-8",
  "Néhémie 9-11", "Néhémie 12-13", "Esther 1-5", "Esther 6-10", "Job 1-3", "Job 4-7",
  "Job 8-10", "Job 11-14", "Job 15-18", "Job 19-22", "Job 23-28", "Job 29-33",
  "Job 34-37", "Job 38-42", "Psaumes 1-9", "Psaumes 10-18", "Psaumes 19-26", "Psaumes 27-34",
  "Psaumes 35-40", "Psaumes 41-48", "Psaumes 49-55", "Psaumes 56-63", "Psaumes 64-69", "Psaumes 70-75",
  "Lévitique 1-3", "Lévitique 4-6", "Lévitique 7-8", "Lévitique 9-11", "Lévitique 12-13", "Psaumes 76-79",
  "Psaumes 80-86", "Lévitique 14-15", "Lévitique 16-18", "Lévitique 19-21", "Lévitique 22-23", "Lévitique 24-25",
  "Psaumes 87-91", "Psaumes 92-101", "Lévitique 26-27", "Nombres 1-2", "Nombres 3-4", "Nombres 5-6",
  "Nombres 7", "Psaumes 102-105", "Psaumes 106-109", "Nombres 8-10", "Nombres 11-13", "Nombres 14-15",
  "Nombres 16-17", "Nombres 18-20", "Psaumes 110-118", "Psaumes 119", "Nombres 21-22", "Nombres 23-25",
  "Nombres 26-27", "Nombres 28-29", "Nombres 30-31", "Psaumes 120-134", "Psaumes 135-142", "Nombres 32-33",
  "Nombres 34-36", "Deutéronome 1-2", "Deutéronome 3-4", "Deutéronome 5-7", "Psaumes 143-150", "Proverbes 1-4",
  "Deutéronome 8-10", "Deutéronome 11-12", "Deutéronome 13-15", "Deutéronome 16-18", "Deutéronome 19-21", "Proverbes 5-9",
  "Proverbes 10-13", "Deutéronome 22-24", "Deutéronome 25-27", "Deutéronome 28", "Deutéronome 29-31", "Deutéronome 32-34",
  "Proverbes 14-17", "Proverbes 18-21", "Proverbes 22-25", "Proverbes 26-28", "Proverbes 29-31", "Ecclésiaste 1-6",
  "Ecclésiaste 7-12", "Cantique des cantiques", "Jérémie 1-3", "Jérémie 4-5", "Jérémie 6-8", "Jérémie 9-11",
  "Jérémie 12-14", "Jérémie 15-17", "Jérémie 18-21", "Jérémie 22-24", "Jérémie 25-26", "Jérémie 27-29",
  "Jérémie 30-31", "Jérémie 32-33", "Jérémie 34-36", "Jérémie 37-39", "Jérémie 40-42", "Jérémie 43-45",
  "Jérémie 46-48", "Jérémie 49-50", "Jérémie 51-52", "Lamentations 1-2", "Lamentations 3-5", "Ezékiel 1-4",
  "Ezékiel 5-8", "Ezékiel 9-12", "Ezékiel 13-15", "Ezékiel 16-17", "Ezékiel 18-20", "Ezékiel 21-22",
  "Ezékiel 23-24", "Ezékiel 25-27", "Ezékiel 28-30", "Ezékiel 31-33", "Ezékiel 34-36", "Ezékiel 37-39",
  "Ezékiel 40-41", "Ezékiel 42-44", "Ezékiel 45-46", "Ezékiel 47-48", "Daniel 1-2", "Daniel 3-4",
  "Daniel 5-7", "Daniel 8-10", "Daniel 11-12", "Osée 1-7", "Osée 8-14", "Joël",
  "Amos 1-4", "Amos 5-9", "Abdias & Jonas", "Michée", "Nahum & Habakuk", "Sophonie & Aggée",
  "Zacharie 1-5", "Zacharie 6-10", "Zacharie 11-14", "Malachie", "Esaïe 1-3", "Esaïe 4-7",
  "Esaïe 8-10", "Esaïe 11-14", "Esaïe 15-20", "Esaïe 21-24", "Esaïe 25-28", "Esaïe 29-31",
  "Esaïe 32-35", "Esaïe 36-38", "Esaïe 39-42", "Esaïe 43-45", "Esaïe 46-49", "Esaïe 50-53",
  "Esaïe 54-58", "Esaïe 59-62", "Esaïe 63-66", "Jean 1-3", "Jean 4-5", "Jean 6-7",
  "Jean 8-9", "Jean 10-11", "Jean 12-13", "Jean 14-16", "Jean 17-18", "Jean 19-21",
  "Apocalypse 1-4", "Apocalypse 5-9", "Apocalypse 10-13", "Apocalypse 14-17", "Apocalypse 18-22"
];
// Nom dans le plan → [code aelf.org/bible, nombre de chapitres]
const BIBLE_BOOKS = {
  'Genèse': ['Gn', 50], 'Exode': ['Ex', 40], 'Lévitique': ['Lv', 27], 'Nombres': ['Nb', 36], 'Deutéronome': ['Dt', 34], 'Josué': ['Jos', 24], 'Juges': ['Jg', 21],
  'Ruth': ['Rt', 4], '1 Samuel': ['1S', 31], '2 Samuel': ['2S', 24], '1 Rois': ['1R', 22], '2 Rois': ['2R', 25], '1 Chroniques': ['1Ch', 29], '2 Chroniques': ['2Ch', 36],
  'Esdras': ['Esd', 10], 'Néhémie': ['Ne', 13], 'Esther': ['Est', 10], 'Job': ['Jb', 42], 'Psaumes': ['Ps', 150], 'Proverbes': ['Pr', 31], 'Ecclésiaste': ['Qo', 12],
  'Cantique des cantiques': ['Ct', 8], 'Esaïe': ['Is', 66], 'Jérémie': ['Jr', 52], 'Lamentations': ['Lm', 5], 'Ezékiel': ['Ez', 48], 'Daniel': ['Dn', 14],
  'Osée': ['Os', 14], 'Joël': ['Jl', 4], 'Amos': ['Am', 9], 'Abdias': ['Ab', 1], 'Jonas': ['Jon', 4], 'Michée': ['Mi', 7], 'Nahum': ['Na', 3], 'Habakuk': ['Ha', 3],
  'Sophonie': ['So', 3], 'Aggée': ['Ag', 2], 'Zacharie': ['Za', 14], 'Malachie': ['Ml', 3],
  'Matthieu': ['Mt', 28], 'Marc': ['Mc', 16], 'Luc': ['Lc', 24], 'Jean': ['Jn', 21], 'Actes': ['Ac', 28], 'Romains': ['Rm', 16], '1 Corinthiens': ['1Co', 16],
  '2 Corinthiens': ['2Co', 13], 'Galates': ['Ga', 6], 'Ephésiens': ['Ep', 6], 'Philippiens': ['Ph', 4], 'Colossiens': ['Col', 4], '1 Thessaloniciens': ['1Th', 5],
  '2 Thessaloniciens': ['2Th', 3], '1 Timothée': ['1Tm', 6], '2 Timothée': ['2Tm', 4], 'Tite': ['Tt', 3], 'Philémon': ['Phm', 1], 'Hébreux': ['He', 13],
  'Jacques': ['Jc', 5], '1 Pierre': ['1P', 5], '2 Pierre': ['2P', 3], '1 Jean': ['1Jn', 5], '2 Jean': ['2Jn', 1], '3 Jean': ['3Jn', 1], 'Jude': ['Jude', 1], 'Apocalypse': ['Ap', 22],
};

// Psaume (numérotation de la Bible, celle du plan) → page(s) aelf.org, en numérotation liturgique
function psalmPages(n) {
  if (n <= 8 || n >= 148) return [n];
  if (n === 9) return ['9A'];
  if (n === 10) return ['9B'];
  if (n === 114) return ['113A'];
  if (n === 115) return ['113B'];
  if (n === 116) return [114, 115];
  if (n === 147) return [146, 147];
  return [n - 1];
}

// « Actes 6-7 », « Galates », « 2 Jean, 3 Jean, Jude », « Abdias & Jonas » → [{ title, book, chap }, …]
function bibleChapters(reading) {
  return reading.split(/, | & /).flatMap((part) => {
    const [, name, a, b] = part.match(/^(.+?)(?: (\d+)(?:-(\d+))?)?$/);
    const [book, count] = BIBLE_BOOKS[name];
    const from = a ? +a : 1, to = b ? +b : a ? +a : count;
    return Array.from({ length: to - from + 1 }, (_, i) => from + i).flatMap((n) => {
      if (book === 'Ps') return psalmPages(n).map((p) => ({ title: `Psaume ${n}` + (String(p) !== String(n) ? ` (${p})` : ''), book, chap: p }));
      return [{ title: count === 1 ? name : `${name} ${n}`, book, chap: book === 'Ab' ? 0 : n }]; // Abdias : page « 0 » sur aelf.org
    });
  });
}

// Nombre d'étapes qui devraient être lues à la fin du jour « day » (AAAA-MM-JJ)
const bibleDue = (day) => Math.min(BIBLE_PLAN.length, Math.max(0, Math.round((Date.parse(day) - Date.parse(BIBLE_START)) / 864e5) + 1));
