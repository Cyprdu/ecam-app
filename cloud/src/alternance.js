// Recherche d'alternance (rentrée septembre 2027, CSIU 2) — d'après la fiche de l'étudiant du 14/10/2026.
// Les dates des entreprises sont des ESTIMATIONS faites à partir de leurs calendriers 2026 : à confirmer.
export const PLAN = {
  goal: { start: '2027-09-01', title: 'Alternance CSIU 2 — cybersécurité OT / réseaux industriels', where: 'Lyon (ou Bourg-en-Bresse)', wish: 'De préférence avec PEE, intéressement, participation ouverts aux alternants' },
  companies: [
    { id: 'savencia', name: 'Savencia IT & Digital Services', where: 'Lyon 3e', fit: 3, why: '« Alternant Assistant RSSI Industriel » publié le 27/03/2026 : le poste le plus proche de ton programme.',
      when: 'Offre attendue vers mars–avril 2027 · candidature spontanée possible dès novembre 2026',
      links: [['Offre 2026 (référence)', 'https://rhalternance.com/jobs/informatique-internet-et-telecommunication/lyon/[alternant]-cybers%C3%A9curit%C3%A9-industrielle-h-f-537232874'], ['JobTeaser', 'https://www.jobteaser.com/']],
      expect: 'Réseaux industriels (OT, SCADA), ISO 27001 et NIST, Excel / Power BI, anglais B2. Niveau Master demandé : tenter quand même en spontané.',
      cv: 'Mettre en avant ISO 27001 / NIST (« notions »), gestion de projet, reporting (Excel, Power BI), évaluation de maturité cyber, sensibilisation.' },
    { id: 'enedis', name: 'Enedis', where: 'Lyon', fit: 3, why: 'Alternances cybersécurité (analyste VOC, ingénieur) et stage « Cybersécurité industrielle » à Lyon : réseau électrique = dimension industrielle.',
      when: 'Candidatures ouvertes ~8 janvier 2027 (8 janvier en 2026) · événement alternants à Lyon début février',
      links: [['Rencontres alternance (Seekube)', 'https://www.enedis.fr/rencontres-alternance'], ['EDF recrute', 'https://www.edf.fr/edf-recrute']],
      expect: 'Gestion des vulnérabilités, réseaux, rigueur. Candidature sur Seekube puis rendez-vous recruteur.',
      cv: 'ISO 27001 / NIST, gestion des vulnérabilités, réseaux (adressage, VLAN, firewall), distribution électrique (module protocoles industriels).' },
    { id: 'vinci', name: 'VINCI Energies — Actemium, Citeos, Axians, VESI', where: 'Lyon et région', fit: 2, why: 'PEE du groupe. Actemium (process industriel), Citeos (villes = volet « urbain »), Axians (réseaux, cyber).',
      when: 'Offres de rentrée publiées au printemps–été (2026) · spontané dès décembre 2026',
      links: [['jobs.vinci.com (alertes e-mail)', 'https://jobs.vinci.com/'], ['Wizbii', 'https://www.wizbii.com/']],
      expect: 'Firewall / VPN / Wi-Fi / SD-WAN (Axians), automates et protocoles industriels (Actemium, Citeos).',
      cv: 'Actemium / Citeos : automates, GRAFCET, supervision, protocoles industriels. Axians : réseaux, firewall, VPN, Linux.' },
    { id: 'edf', name: 'EDF', where: 'Lyon', fit: 2, why: 'Apprentissages automatisme / informatique industrielle repérés.', when: 'À surveiller dès janvier 2027',
      links: [['EDF recrute', 'https://www.edf.fr/edf-recrute']], expect: 'Automatisme, informatique industrielle.', cv: 'Automates, GRAFCET, supervision, réseaux OT, modèle de Purdue.' },
    { id: 'framatome', name: 'Framatome', where: 'Lyon', fit: 2, why: 'Apprentissages automatisme / informatique industrielle repérés (Engagement Jeunes).', when: 'À surveiller dès janvier 2027',
      links: [['La Bonne Alternance', 'https://labonnealternance.apprentissage.beta.gouv.fr/']], expect: 'Automatisme, informatique industrielle.', cv: 'Automates, capteurs / actionneurs, supervision, sécurité OT.' },
    { id: 'airbus', name: 'Airbus Defence and Space Cyber', where: 'Partenaire de l’ECAM', fit: 2, why: 'Partenariat avec ECAM LaSalle : passer par le service relations entreprises de l’école.',
      when: 'Dès maintenant (contact école)', links: [['Article sur le partenariat', 'https://www.lejournaldesentreprises.com/auvergne-rhone-alpes/breve/ecam-lasalle-signe-un-partenariat-avec-airbus-defence-and-space-cyber-2067362']],
      expect: 'Cybersécurité, rigueur, anglais.', cv: 'Threat modeling (MITRE), analyse de surface d’attaque, IAM, chiffrement, anglais.' },
    { id: 'orano', name: 'Orano', where: 'Lieu à vérifier', fit: 1, why: 'Offre de technicien maintenance informatique industrielle repérée.', when: 'À surveiller',
      links: [['La Bonne Alternance', 'https://labonnealternance.apprentissage.beta.gouv.fr/']], expect: 'Informatique industrielle.', cv: 'Automates, réseaux OT, Linux / Windows.' },
    { id: 'repli', name: 'Plan B : Nexa, ISCOD, autres (Lyon)', where: 'Lyon 1er, Écully', fit: 1, why: 'Alternances cyber / systèmes et réseaux sans OT : solution de repli.', when: 'Juillet–septembre 2027 si rien avant',
      links: [['Offres Lyon (Jooble)', 'https://fr.jooble.org/emploi-alternance-securite-informatique/Lyon']], expect: 'Admin systèmes et réseaux, cybersécurité IT.', cv: 'Réseaux, Linux, Windows, Python, firewall / VPN.' },
  ],
  platforms: [
    ['jobs.vinci.com', 'https://jobs.vinci.com/', 'Offres VINCI, alertes e-mail'],
    ['Enedis — Seekube', 'https://www.enedis.fr/rencontres-alternance', 'Candidatures et rendez-vous Enedis'],
    ['EDF recrute', 'https://www.edf.fr/edf-recrute', 'Offres EDF'],
    ['La Bonne Alternance', 'https://labonnealternance.apprentissage.beta.gouv.fr/', 'Offres + candidatures spontanées'],
    ['JobTeaser', 'https://www.jobteaser.com/', 'Grands groupes'],
    ['Welcome to the Jungle', 'https://www.welcometothejungle.com/', 'Grands groupes'],
    ['Wizbii', 'https://www.wizbii.com/', 'Grands groupes'],
    ['France Travail', 'https://candidat.francetravail.fr/', 'Offres et dépôt de candidature'],
    ['LinkedIn Emplois', 'https://www.linkedin.com/jobs/', 'Veille, alertes'],
    ['Indeed', 'https://fr.indeed.com/', 'Veille, alertes'],
    ['Jooble (Lyon)', 'https://fr.jooble.org/emploi-alternance-securite-informatique/Lyon', 'Veille'],
  ],
  keywords: ['alternance cybersécurité OT', 'cybersécurité industrielle', 'automatisme informatique industrielle', 'réseaux industriels', 'SCADA', 'technicien réseaux et sécurité', 'assistant RSSI industriel'],
  // Étapes : chacune devient un rappel (notifications 3 jours avant, la veille, le jour même)
  steps: [
    ['2026-10-17', 'Créer les alertes : jobs.vinci, LinkedIn, Indeed, La Bonne Alternance, JobTeaser, WTTJ (mots-clés dans l’app)'],
    ['2026-10-20', 'Contacter le service relations entreprises de l’ECAM (offres réservées, Airbus) et demander le rythme et le calendrier d’alternance'],
    ['2026-10-31', 'CV, lettre type et LinkedIn prêts (Claude peut les rédiger depuis l’app)'],
    ['2026-11-16', 'Candidatures spontanées : Savencia, Enedis, EDF, Framatome'],
    ['2026-12-01', 'Candidatures spontanées : VINCI (Actemium, Citeos, Axians Lyon)'],
    ['2026-12-10', 'Repérer les forums et jobdatings (ECAM, Lyon) de l’hiver'],
    ['2027-01-05', 'Créer le compte Seekube : Enedis ouvre ses candidatures vers le 8 janvier'],
    ['2027-01-08', 'Postuler chez Enedis dès l’ouverture (Seekube)'],
    ['2027-01-25', 'Vérifier les événements Enedis Lyon et les jobdatings de février'],
    ['2027-03-15', 'Surveiller l’offre Savencia (publiée le 27 mars en 2026) et les offres VINCI'],
    ['2027-04-15', 'Relancer les candidatures spontanées sans réponse'],
    ['2027-05-15', 'Entretiens · contrat d’apprentissage : vérifier les démarches avec l’école'],
    ['2027-07-01', 'Plan B : offres restantes (Nexa, ISCOD, La Bonne Alternance…) pour septembre'],
  ],
  expect: ['Réseaux : adressage IP, Ethernet, bases firewall / VPN / Wi-Fi / SD-WAN', 'OT : réseaux industriels, SCADA, architectures en zones', 'Normes : ISO 27001, NIST (même en notions)', 'Outils : Excel, Power BI', 'Anglais B1 / B2', 'Rigueur, organisation, analyse, relationnel, curiosité', 'CV + lettre ou message de motivation ; entretien RH puis manager, souvent en visio'],
  cv: ['En-tête : nom, e-mail, téléphone, Lyon, LinkedIn (et GitHub)', 'Accroche : étudiant Bachelor CSIU (ECAM LaSalle Lyon) cherchant une alternance de 2e année dès septembre 2027 en cybersécurité OT / réseaux industriels', 'Formation : Bachelor CSIU, promo 2029, modules clés',
    'OT / ICS : modèle de Purdue, architecture OT et DMZ industrielle, inventaire des actifs OT, protocoles et topologies OT', 'Automatismes : automates, GRAFCET, capteurs / actionneurs, supervision', 'Sécurité : threat modeling (MITRE, securiCAD), surface d’attaque, IAM, filtrage / VPN, chiffrement',
    'Réseaux et systèmes : LAN, VLAN, routage, Linux, Windows, MySQL · Langages : Python, C', 'Projets : TP et projets de l’école (threat modeling, infra réseau, automate) + projets perso réels (home lab, CTF)', 'Langues (niveau honnête), expériences et certifications réelles, permis, mobilité, disponibilité septembre 2027'],
  questions: ['Rythme et durée de l’alternance (semaines école / entreprise) : demander à l’école', 'Date de signature du contrat d’apprentissage : demander à l’école', 'Pour chaque entreprise : PEE, intéressement, participation ouverts aux alternants ? Abondement ? Ancienneté requise ?'],
};

const ics = (s) => String(s).replace(/[\\;,]/g, (c) => '\\' + c).replace(/\n/g, '\\n');
/** Calendrier abonnable (iPhone, Google…) des rappels « Alternance » : un événement d'une journée par rappel. */
export function alternanceIcs(tasks) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ECAM app//Alternance//FR', 'X-WR-CALNAME:Alternance 2027', 'X-WR-TIMEZONE:Europe/Paris', 'REFRESH-INTERVAL;VALUE=DURATION:PT6H'];
  for (const t of tasks) {
    const d = t.due.slice(0, 10).replace(/-/g, ''), next = new Date(Date.parse(t.due.slice(0, 10) + 'T12:00Z') + 864e5).toISOString().slice(0, 10).replace(/-/g, '');
    lines.push('BEGIN:VEVENT', `UID:${t.id}@ecam-app`, `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`, `DTSTART;VALUE=DATE:${d}`, `DTEND;VALUE=DATE:${next}`,
      `SUMMARY:${ics((t.done ? '✓ ' : '') + t.title)}`, ...(t.note ? [`DESCRIPTION:${ics(t.note)}`] : []), 'BEGIN:VALARM', 'ACTION:DISPLAY', 'TRIGGER:PT9H', `DESCRIPTION:${ics(t.title)}`, 'END:VALARM', 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
