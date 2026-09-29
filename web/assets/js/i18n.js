// Translation of the UI. The English text is the key; untranslated texts are
// shown in English. Placeholders are written {name}.
//
// The language is taken from <html lang> and changes only on reload.

import {state} from './state.js';

export const lang = document.documentElement.lang === 'de' ? 'de' : 'en';

/** Locale for formatting numbers and dates. */
export const locale = lang === 'de' ? 'de-DE' : 'en-GB';

/**
 * German translations, keyed by the English text. An array holds singular and
 * plural, selected by `n`.
 */
const de = {
  // ---------- shell: header, board, empty state ----------
  'New habit': 'Neue Gewohnheit',
  'Search': 'Suche',
  'Search (/)': 'Suche (/)',
  'Show only open': 'Nur offene zeigen',
  'Settings': 'Einstellungen',
  'Nothing left open on this day.': 'An diesem Tag ist nichts mehr offen.',
  'No habits yet': 'Noch keine Gewohnheiten',
  'Create your first habit — daily, on certain weekdays or every few days.':
      'Leg deine erste Gewohnheit an — täglich, an bestimmten Wochentagen oder alle paar Tage.',
  'Create first habit': 'Erste Gewohnheit anlegen',

  // ---------- habit editor ----------
  'Edit habit': 'Gewohnheit bearbeiten',
  'Name': 'Name',
  'e.g. drink water': 'z. B. Wasser trinken',
  'Colour': 'Farbe',
  'Colour {color}': 'Farbe {color}',
  'No colour': 'Keine Farbe',
  'Icon': 'Symbol',
  'Icon {name}': 'Symbol {name}',
  'No icon': 'Kein Symbol',
  // Icon and colour names (icons.js).
  'Water drop': 'Wassertropfen',
  'Apple': 'Apfel',
  'Cutlery': 'Besteck',
  'Coffee': 'Kaffee',
  'Pill': 'Tablette',
  'Heart': 'Herz',
  'Dumbbell': 'Hantel',
  'Bicycle': 'Fahrrad',
  'Mountain': 'Berg',
  'Flame': 'Flamme',
  'Bed': 'Bett',
  'Moon': 'Mond',
  'Sun': 'Sonne',
  'Book': 'Buch',
  'Pencil': 'Stift',
  'Light bulb': 'Glühbirne',
  'Code': 'Code',
  'Globe': 'Globus',
  'Music': 'Musik',
  'Paint palette': 'Farbpalette',
  'Camera': 'Kamera',
  'Leaf': 'Blatt',
  'House': 'Haus',
  'Wallet': 'Geldbörse',
  'People': 'Personen',
  'Smartphone': 'Smartphone',
  'No entry': 'Verbotsschild',
  'Smile': 'Lächeln',
  'Star': 'Stern',
  'Target': 'Zielscheibe',
  'Clock': 'Uhr',
  'Check mark': 'Häkchen',
  'Alarm clock': 'Wecker',
  'Morning': 'Morgens',
  'Midday': 'Mittags',
  'Evening': 'Abends',
  'Hourglass': 'Sanduhr',
  'Calendar': 'Kalender',
  'Calendar with check mark': 'Kalender mit Häkchen',
  'Red': 'Rot',
  'Orange': 'Orange',
  'Yellow': 'Gelb',
  'Lime': 'Hellgrün',
  'Green': 'Grün',
  'Teal': 'Petrol',
  'Sky blue': 'Himmelblau',
  'Blue': 'Blau',
  'Indigo': 'Indigo',
  'Violet': 'Violett',
  'Pink': 'Pink',
  'Slate': 'Schiefergrau',
  'Category': 'Kategorie',
  'Kind': 'Art',
  'Check': 'Abhaken',
  'Count': 'Anzahl',
  'Time': 'Zeit',
  'Distance': 'Strecke',
  'Daily target': 'Tagesziel',
  'Unit': 'Einheit',
  'e.g. glasses': 'z. B. Gläser',
  'Step': 'Schritt',
  'e.g. 1': 'z. B. 1',
  'e.g. 5': 'z. B. 5',
  'e.g. 0.5': 'z. B. 0,5',
  'A click on a day changes the entry by this much.':
      'Ein Klick auf einen Tag ändert den Eintrag um so viel.',
  'Daily target in minutes': 'Tagesziel in Minuten',
  'Step in minutes': 'Schritt in Minuten',
  'Daily target in km': 'Tagesziel in km',
  'Step in km': 'Schritt in km',
  'Frequency': 'Häufigkeit',
  'Details': 'Details',
  'Status': 'Status',
  'Shown on the board': 'In der Übersicht angezeigt',
  'Not shown': 'Nicht angezeigt',
  'Created': 'Angelegt',
  'Daily': 'Täglich',
  'Times per week': 'Mal pro Woche',
  'Weekdays': 'Wochentage',
  'Custom interval': 'Eigener Abstand',
  'Times per month': 'Mal pro Monat',
  'How many times per week': 'Wie oft pro Woche',
  'How many times per month': 'Wie oft pro Monat',
  'Counted per calendar month. Which days you pick is up to you.':
      'Gezählt wird je Kalendermonat. Welche Tage du wählst, bleibt dir überlassen.',
  'Goal': 'Ziel',
  'At least': 'Mindestens',
  'At most': 'Höchstens',
  'A limit is kept on every due day that stays within it, days without an entry included. It needs fixed days, not a number per week or month.':
      'Ein Limit ist an jedem fälligen Tag eingehalten, der darunter bleibt, auch an Tagen ohne Eintrag. Es braucht feste Tage, keine Anzahl pro Woche oder Monat.',
  'Daily limit': 'Tageslimit',
  'Daily limit in minutes': 'Tageslimit in Minuten',
  'Daily limit in km': 'Tageslimit in km',
  'The week starts on Monday. Which days you pick is up to you.':
      'Die Woche beginnt am Montag. Welche Tage du wählst, bleibt dir überlassen.',
  'On these days': 'An diesen Tagen',
  'Repeat': 'Wiederholen',
  'Every week': 'Jede Woche',
  'Every few weeks': 'Alle paar Wochen',
  'Once a month': 'Einmal im Monat',
  'Every … weeks': 'Alle … Wochen',
  'Starting on': 'Ab dem',
  'Skip days': 'Tage überspringen',
  'Skip days…': 'Tage überspringen …',
  'Skip': 'Überspringen',
  'From': 'Von',
  'Until': 'Bis',
  'This habit': 'Diese Gewohnheit',
  'All habits': 'Alle Gewohnheiten',
  'Only due days without an entry are skipped; days with an entry keep it. Skipped days neither break nor extend a streak. Archived habits are left out.':
      'Übersprungen werden nur fällige Tage ohne Eintrag; Tage mit Eintrag behalten ihn. Übersprungene Tage unterbrechen keine Serie und verlängern sie nicht. Archivierte Gewohnheiten bleiben außen vor.',
  'Skip days of all habits': 'Tage aller Gewohnheiten überspringen',
  'Nothing to skip: the days are not due or already have an entry.':
      'Nichts zu überspringen: Die Tage sind nicht fällig oder haben schon einen Eintrag.',
  '1 day skipped': '1 Tag übersprungen',
  '{n} days skipped': '{n} Tage übersprungen',
  'Which one in the month': 'Welcher im Monat',
  'First': 'Erster',
  'Second': 'Zweiter',
  'Third': 'Dritter',
  'Fourth': 'Vierter',
  'Last': 'Letzter',
  'First and Monday means the first Monday of every month.':
      'Erster und Montag heißt: der erste Montag jedes Monats.',
  'Every … days': 'Alle … Tage',
  'Apply to past days as well': 'Auch für vergangene Tage übernehmen',
  'Days that reached their target stay ticked; the others are cleared. The recorded values are not kept.':
      'Tage, die ihr Ziel erreicht haben, bleiben abgehakt, die anderen werden geleert. Die erfassten Werte bleiben nicht erhalten.',
  'Ticked days get the new daily target.':
      'Abgehakte Tage bekommen das neue Tagesziel.',
  'Recorded values keep their number in the new unit, e.g. 5 becomes 5 {unit}.':
      'Erfasste Werte behalten ihre Zahl in der neuen Einheit, aus 5 wird z. B. 5 {unit}.',
  'minutes': 'Minuten',
  'km': 'km',
  'times': 'Mal',
  'Off, the new target and frequency apply from today on. Past days keep the ones they had.':
      'Aus: Ziel und Häufigkeit gelten ab heute. Vergangene Tage behalten die bisherigen.',
  'Cancel': 'Abbrechen',
  'Create': 'Anlegen',
  'Save': 'Speichern',
  'No category': 'Keine Kategorie',
  'Deleted category': 'Gelöschte Kategorie',
  'Please select at least one weekday.':
      'Bitte wähle mindestens einen Wochentag.',

  // ---------- settings ----------
  'Settings sections': 'Bereiche der Einstellungen',
  'Appearance': 'Darstellung',
  'Overview': 'Übersicht',
  'Archive': 'Archiv',
  'Language & time': 'Sprache & Zeit',
  'Theme, font, colours and background':
      'Design, Schrift, Farben und Hintergrund',
  'Reordering and days shown': 'Anordnen und angezeigte Tage',
  'Language and time zone': 'Sprache und Zeitzone',
  'Archived habits': 'Archivierte Gewohnheiten',
  'Current user': 'Aktueller Benutzer',
  'Groups: {list}': 'Gruppen: {list}',
  'About the app': 'Über die App',
  'Version': 'Version',
  'Development build': 'Entwicklungsstand',
  'modified': 'geändert',
  'Unknown': 'Unbekannt',
  'Commit': 'Commit',
  'Built': 'Erstellt',
  'Go version': 'Go-Version',
  'Theme': 'Design',
  'System': 'System',
  'Light': 'Hell',
  'Dark': 'Dunkel',
  'Font': 'Schrift',
  'Density': 'Dichte',
  'Compact': 'Kompakt',
  'Standard': 'Standard',
  'Comfortable': 'Großzügig',
  'Spacing inside and around every element, and how heavy its emphasis is set.':
      'Abstände in und um jedes Element und wie kräftig Hervorhebungen gesetzt sind.',
  'Accent colour': 'Akzentfarbe',
  'Opacity': 'Deckkraft',
  'Neutral': 'Neutral',
  'Today band': 'Heute-Band',
  'Band through today\'s column': 'Band durch die heutige Spalte',
  'Off, only today\'s date in the header is marked.':
      'Aus: Nur das heutige Datum in der Kopfzeile wird markiert.',
  'Band opacity': 'Deckkraft des Bands',
  'Background pattern': 'Hintergrundmuster',
  'Plain': 'Schlicht',
  'Grain': 'Körnung',
  'Dots': 'Punkte',
  'Grid': 'Raster',
  'Lines': 'Linien',
  'Icons': 'Symbole',
  'Halftone dots': 'Halbtonpunkte',
  'Reordering': 'Anordnen',
  'Arrange': 'Anordnen',
  'Shows the handles for moving habits and categories. Applies until the page is next loaded.':
      'Zeigt die Griffe zum Verschieben von Gewohnheiten und Kategorien. Gilt bis zum nächsten Laden der Seite.',
  'Drag': 'Ziehen',
  'Buttons': 'Pfeile',
  'Categories and habits are moved by their handle.':
      'Kategorien und Gewohnheiten werden an ihrem Griff verschoben.',
  'Categories and habits are moved with arrows — by keyboard too.':
      'Kategorien und Gewohnheiten werden mit Pfeilen verschoben — auch per Tastatur.',
  'Days in the overview': 'Tage in der Übersicht',
  'Automatic': 'Automatisch',
  'As many days are shown as fit in the window — currently {n}.':
      'Es werden so viele Tage gezeigt, wie ins Fenster passen — derzeit {n}.',
  'Only {n} days fit in the window right now. In a wider window it will be {days}.':
      'Gerade passen nur {n} Tage ins Fenster. In einem breiteren Fenster sind es {days}.',
  '{n} days are shown right now.': 'Gerade werden {n} Tage gezeigt.',
  'Start the week on Monday': 'Woche am Montag beginnen',
  'The overview ends on today.': 'Die Übersicht endet mit heute.',
  'Possible from 7 columns on — {n} fit right now.':
      'Ab 7 Spalten möglich — gerade passen {n}.',
  'The overview shows whole calendar weeks, including the remaining days of this week.':
      'Die Übersicht zeigt ganze Kalenderwochen, einschließlich der restlichen Tage dieser Woche.',
  'Show archived habits': 'Archivierte Gewohnheiten zeigen',
  '1 habit is archived.': '1 Gewohnheit ist archiviert.',
  '{n} habits are archived.': '{n} Gewohnheiten sind archiviert.',
  'Done': 'Fertig',
  'Language': 'Sprache',
  'Browser language': 'Sprache des Browsers',
  'The page reloads to switch the language.':
      'Zum Wechseln der Sprache wird die Seite neu geladen.',
  'Time zone': 'Zeitzone',
  'Server default': 'Vorgabe des Servers',
  'Server default ({zone})': 'Vorgabe des Servers ({zone})',
  'Other': 'Weitere',
  'Use this device\'s time zone ({zone})':
      'Zeitzone dieses Geräts verwenden ({zone})',
  'Decides when a new day begins on the board.':
      'Bestimmt, wann auf der Übersicht ein neuer Tag beginnt.',
  'It is {time} there now.': 'Dort ist es jetzt {time} Uhr.',
  'Data': 'Daten',
  'Import, export and delete': 'Importieren, exportieren und löschen',
  'Export': 'Export',
  'Import': 'Import',
  'Saves your habits with their schedules and recorded days, and your categories, as a file: a backup that importing restores. Statistics are computed again.':
      'Speichert deine Gewohnheiten mit ihren Zeitplänen und erfassten Tagen sowie deine Kategorien als Datei: eine Sicherung, die ein Import wiederherstellt. Statistiken werden neu berechnet.',
  'Export habits': 'Gewohnheiten exportieren',
  'Adds the habits of an exported file with their history. Habits whose name already exists are skipped; categories of the same name are shared.':
      'Fügt die Gewohnheiten einer exportierten Datei mit ihrem Verlauf hinzu. Gewohnheiten, deren Name schon existiert, werden übersprungen; gleichnamige Kategorien werden gemeinsam genutzt.',
  'Import habits': 'Gewohnheiten importieren',
  'The file is not an export of the habits.':
      'Die Datei ist kein Export der Gewohnheiten.',
  '1 habit imported.': '1 Gewohnheit importiert.',
  '{n} habits imported.': '{n} Gewohnheiten importiert.',
  '1 habit imported': '1 Gewohnheit importiert',
  '{n} habits imported': '{n} Gewohnheiten importiert',
  '1 category created.': '1 Kategorie angelegt.',
  '{n} categories created.': '{n} Kategorien angelegt.',
  '1 habit already existed and was skipped.':
      '1 Gewohnheit gab es schon; sie wurde übersprungen.',
  '{n} habits already existed and were skipped.':
      '{n} Gewohnheiten gab es schon; sie wurden übersprungen.',
  '"{name}": {message}': '„{name}“: {message}',
  'Deletes all your habits with their recorded days, your categories and your settings. This cannot be undone; export your habits first to keep them.':
      'Löscht alle deine Gewohnheiten mit ihren erfassten Tagen, deine Kategorien und deine Einstellungen. Das lässt sich nicht rückgängig machen; exportiere deine Gewohnheiten vorher, um sie zu behalten.',
  'Delete all data': 'Alle Daten löschen',
  'Delete all data?': 'Alle Daten löschen?',
  'All habits, recorded days, categories and settings will be deleted for good.':
      'Alle Gewohnheiten, erfassten Tage, Kategorien und Einstellungen werden endgültig gelöscht.',

  // ---------- category dialogs and screen ----------
  'Choose category': 'Kategorie wählen',
  'New category': 'Neue Kategorie',
  'Name of the new category': 'Name der neuen Kategorie',
  'Edit category': 'Kategorie bearbeiten',
  'Progress': 'Fortschritt',
  'Show today\'s progress': 'Heutigen Fortschritt zeigen',
  'The bar and the count beside the name on the board.':
      'Der Balken und die Anzahl neben dem Namen auf der Übersicht.',
  'Habits': 'Gewohnheiten',
  'Perfect days {since}': 'Perfekte Tage {since}',
  '(since {date})': '(seit {date})',
  '{n} of {total}': '{n} von {total}',
  'No habit in this category yet.':
      'In dieser Kategorie ist noch keine Gewohnheit.',

  // ---------- day statistics ----------
  'Day statistics': 'Tagesstatistik',
  'Show day statistics': 'Tagesstatistik anzeigen',
  'Average per day': 'Ø pro Tag',
  '1 habit due': '1 Gewohnheit fällig',
  '{n} habits due': '{n} Gewohnheiten fällig',
  'Nothing due': 'Nichts fällig',
  'Perfect days: {n}': 'Perfekte Tage: {n}',
  'By weekday': 'Nach Wochentag',
  'By month': 'Nach Monat',
  'Highlights': 'Höhepunkte',
  'Habits completed': 'Erledigte Gewohnheiten',
  'Days without progress': 'Tage ohne Fortschritt',
  'Best weekday': 'Bester Wochentag',
  'Best month': 'Bester Monat',
  'wk': 'Wo.',
  'mo': 'Mon.',
  'day': 'Tag',
  'days': 'Tage',

  // ---------- search ----------
  'Search habits and categories': 'Gewohnheiten und Kategorien suchen',
  'Search habits and categories…': 'Gewohnheiten und Kategorien suchen …',
  'Clear search': 'Suche leeren',
  'Results': 'Ergebnisse',
  'No habit or category matches.': 'Keine Gewohnheit oder Kategorie passt.',
  'Category · 1 habit': 'Kategorie · 1 Gewohnheit',
  'Category · {n} habits': 'Kategorie · {n} Gewohnheiten',

  // ---------- value dialog ----------
  'Enter value': 'Wert eingeben',
  'Less': 'Weniger',
  'More': 'Mehr',
  'Value': 'Wert',
  'Value in {unit}': 'Wert in {unit}',
  'Clear': 'Löschen',
  'Daily target: {target}': 'Tagesziel: {target}',
  'Daily limit: {target}': 'Tageslimit: {target}',
  'Completed': 'Erledigt',
  'Skip this day': 'Tag überspringen',
  '{goal} · step: {step}': '{goal} · Schritt: {step}',

  // ---------- board ----------
  'Earlier days': 'Frühere Tage',
  'Later days': 'Spätere Tage',
  'Back to today': 'Zurück zu heute',
  'Move habit': 'Gewohnheit verschieben',
  'Move habit up': 'Gewohnheit nach oben',
  'Move habit down': 'Gewohnheit nach unten',
  'Move category': 'Kategorie verschieben',
  'Move category up': 'Kategorie nach oben',
  'Move category down': 'Kategorie nach unten',
  '{done} of {due} done': '{done} von {due} erledigt',
  'Nothing due on this day': 'An diesem Tag steht nichts an',
  'Done on this day': 'An diesem Tag erledigt',
  'All habits done!': 'Alle Gewohnheiten erledigt!',
  'Everything ticked off. Well done!': 'Alles abgehakt. Gut gemacht!',
  'Done for today – enjoy the rest of it.':
      'Fertig für heute – genieß den Rest des Tages.',
  '{n} of {n}. Nothing left to do today.':
      '{n} von {n}. Heute ist nichts mehr zu tun.',
  'A clean sweep today!': 'Heute alles geschafft!',

  // ---------- day cells ----------
  'done': 'erledigt',
  'planned': 'geplant',
  '{value} planned': '{value} geplant',
  '{value} of {target}': '{value} von {target}',
  '{value} of {target} planned': '{value} von {target} geplant',
  'open': 'offen',
  'not scheduled': 'nicht geplant',
  'skipped': 'übersprungen',
  '{value}, over the limit of {target}': '{value}, über dem Limit von {target}',
  '{value}, within the limit of {target}': '{value}, im Limit von {target}',
  '{value}, not saved yet': '{value}, noch nicht gespeichert',
  'cleared, not saved yet': 'gelöscht, noch nicht gespeichert',
  'nothing, within the limit': 'nichts, im Limit',
  '{value} of at most {target}': '{value} von höchstens {target}',
  'none at all': 'gar nichts',
  'at most {value}': 'höchstens {value}',
  ', day {n} of a streak': ', Tag {n} einer Serie',
  '{name}, {when}: cleared': '{name}, {when}: gelöscht',
  '{name}, {when}: skipped': '{name}, {when}: übersprungen',

  // ---------- habit descriptions ----------
  'daily': 'täglich',
  '{n}× per week': '{n}× pro Woche',
  '{n}× per month': '{n}× pro Monat',
  'last': 'letzter',
  '1st': '1.',
  '2nd': '2.',
  '3rd': '3.',
  '4th': '4.',
  '{which} {days} of the month': '{which} {days} im Monat',
  '{days} every {n} weeks': '{days} alle {n} Wochen',
  'Mon–Fri': 'Mo–Fr',
  'every {n} days': 'alle {n} Tage',
  'Archived': 'Archiviert',
  'archived': 'archiviert',
  '{n}-day streak': ['{n} Tag in Folge', '{n} Tage in Folge'],
  '{n}-week streak': ['{n} Woche in Folge', '{n} Wochen in Folge'],
  '{n}-month streak': ['{n} Monat in Folge', '{n} Monate in Folge'],

  // ---------- relative dates ----------
  'today': 'heute',
  'yesterday': 'gestern',
  'the day before yesterday': 'vorgestern',
  'tomorrow': 'morgen',
  'the day after tomorrow': 'übermorgen',
  '{n} days ago': 'vor {n} Tagen',
  'just now': 'gerade eben',
  '{n} min ago': 'vor {n} Min.',
  '{n} h ago': 'vor {n} Std.',

  // ---------- detail screen ----------
  'Back': 'Zurück',
  'Edit': 'Bearbeiten',
  'Delete': 'Löschen',
  'Reactivate': 'Reaktivieren',
  'verb|Archive': 'Archivieren',
  'More options': 'Weitere Optionen',
  'Discard changes?': 'Änderungen verwerfen?',
  'Keep editing': 'Weiter bearbeiten',
  'Discard': 'Verwerfen',
  '1 day': '1 Tag',
  '{n} days': '{n} Tage',
  '1 week': '1 Woche',
  '{n} weeks': '{n} Wochen',
  '1 month': '1 Monat',
  '{n} months': '{n} Monate',
  'Current streak': 'Aktuelle Serie',
  'Best streak': 'Beste Serie',
  'Rate ({n} days)': 'Quote ({n} Tage)',
  'Rate (all time)': 'Quote (gesamt)',
  'Completion rate over': 'Quote über',
  'The rate in a habit\'s statistics: the share of its due days completed in this time, skipped days left out.':
      'Die Quote in der Statistik einer Gewohnheit: der Anteil der fälligen Tage in dieser Zeit, die erledigt sind, ohne übersprungene Tage.',
  '7 days': '7 Tage',
  '30 days': '30 Tage',
  '90 days': '90 Tage',
  '365 days': '365 Tage',
  'All time': 'Gesamter Verlauf',
  'Previous year': 'Vorheriges Jahr',
  'Next year': 'Nächstes Jahr',
  'No entries in {year}.': '{year} gibt es keine Einträge.',
  'Total': 'Gesamt',
  'Activity': 'Aktivität',
  'Last done': 'Zuletzt erledigt',
  'Not yet': 'Noch nie',
  'Last changed': 'Zuletzt geändert',
  '1 change waiting': '1 Änderung wartet',
  '{n} changes waiting': '{n} Änderungen warten',
  'Offline': 'Offline',
  'Offline — changes are kept on this device and sent later.':
      'Offline — Änderungen bleiben auf diesem Gerät und werden später gesendet.',
  'Session expired — changes are kept on this device and sent after you reload the page.':
      'Sitzung abgelaufen — Änderungen bleiben auf diesem Gerät und werden gesendet, sobald du die Seite neu lädst.',
  'Back online — 1 change sent': 'Wieder online — 1 Änderung gesendet',
  'Back online — {n} changes sent': 'Wieder online — {n} Änderungen gesendet',
  'Not sent: {error}': 'Nicht gesendet: {error}',
  'Offline — showing the last loaded state':
      'Offline — du siehst den zuletzt geladenen Stand',
  'since {date}': 'seit {date}',
  'Until {date}': 'Bis {date}',
  'Year {year}': 'Jahr {year}',
  'still ahead': 'liegt noch vor dir',
  'nothing recorded': 'nichts eingetragen',
  'Today, {date}': 'Heute, {date}',
  'less': 'weniger',
  'more': 'mehr',
  'Day': 'Tag',
  'Week': 'Woche',
  'Month': 'Monat',
  'Cumulative': 'Kumuliert',
  'Period': 'Zeitraum',
  'No entries in {year} yet.': '{year} gibt es noch keine Einträge.',
  'in {year}': 'im Jahr {year}',
  ' {scope} · avg ': ' {scope} · Ø ',
  ' on 1 active day · best day ': ' an 1 aktiven Tag · bester Tag ',
  ' on {n} active days · best day ': ' an {n} aktiven Tagen · bester Tag ',
  '{total} · of that +{sum}': '{total} · davon +{sum}',
  '{total} · nothing added': '{total} · nichts dazugekommen',
  'End of {month}': 'Ende {month}',
  'Week from {date}': 'Woche ab {date}',

  // ---------- undo, toasts ----------
  'Undo': 'Rückgängig',
  'Redo': 'Wiederholen',
  'Undone: {label}': 'Rückgängig gemacht: {label}',
  'Redone: {label}': 'Wiederhergestellt: {label}',
  'Close': 'Schließen',
  'Unknown error': 'Unbekannter Fehler',
  'Entry cleared: {name}, {when}': 'Eintrag gelöscht: {name}, {when}',
  'Day skipped: {name}, {when}': 'Tag übersprungen: {name}, {when}',
  '"{name}" created': '„{name}“ angelegt',
  '"{name}" edited': '„{name}“ bearbeitet',
  '"{name}" deleted': '„{name}“ gelöscht',
  '"{name}" archived': '„{name}“ archiviert',
  '"{name}" reactivated': '„{name}“ reaktiviert',
  'Category "{name}" created': 'Kategorie „{name}“ angelegt',
  'Category "{name}" edited': 'Kategorie „{name}“ bearbeitet',
  'Category "{name}" deleted': 'Kategorie „{name}“ gelöscht',
  'Category "{name}" deleted — 1 habit kept':
      'Kategorie „{name}“ gelöscht — 1 Gewohnheit bleibt erhalten',
  'Category "{name}" deleted — {n} habits kept':
      'Kategorie „{name}“ gelöscht — {n} Gewohnheiten bleiben erhalten',
};

/**
 * German messages of the server's problem codes (domain.Invalid and
 * writeError) and of the client's own network errors, keyed by code. The
 * server's English message is shown for codes missing here and in English.
 * Placeholders are filled from the problem's params.
 */
const deErrors = {
  // Network and session (api.js).
  offline: 'Keine Verbindung zum Server',
  session_expired: 'Sitzung abgelaufen — bitte lade die Seite neu',
  not_signed_in: 'Sitzung abgelaufen — bitte lade die Seite neu',
  untrusted_proxy: 'Zugriff nur über den eingerichteten Reverse Proxy',

  // Requests.
  internal: 'Interner Serverfehler',
  not_found: 'Nicht gefunden',
  unknown_endpoint: 'Unbekannte Adresse',
  unsupported_media_type: 'Die Anfrage muss JSON sein.',
  invalid_body: 'Die Anfrage ist ungültig.',
  missing_fields: 'In der Anfrage fehlen Angaben.',
  invalid_date: 'Ungültiges Datum, erwartet wird JJJJ-MM-TT.',
  invalid_year: 'Ungültiges Jahr.',
  nothing_to_undo: 'Es gibt nichts rückgängig zu machen.',
  changed_since: 'Die Daten wurden inzwischen geändert.',
  invalid_grain: 'Der Zeitraum muss Tag, Woche oder Monat sein.',

  // Entries.
  entry_too_far_ahead:
      'Einträge dürfen höchstens ein Jahr in der Zukunft liegen',
  entry_too_early: 'Einträge dürfen nicht vor dem Jahr {year} liegen.',
  not_scheduled: 'Die Gewohnheit ist an diesem Tag nicht geplant',
  date_missing: 'Das Datum fehlt.',
  value_negative: 'Der Wert darf nicht negativ sein.',
  skipped_with_value: 'Ein übersprungener Tag kann keinen Wert haben.',
  skip_range_reversed: 'Der letzte Tag liegt vor dem ersten.',
  skip_range_too_long:
      'Es lassen sich höchstens {max} Tage auf einmal überspringen.',
  value_too_large: 'Der Wert darf höchstens {max} sein.',
  value_too_large_minutes: 'Der Wert darf höchstens {max} Minuten betragen.',
  value_too_large_km: 'Der Wert darf höchstens {max} Kilometer betragen.',

  // Habits.
  name_empty: 'Der Name darf nicht leer sein.',
  name_too_long: 'Der Name darf höchstens {max} Zeichen lang sein.',
  unit_too_long: 'Die Einheit darf höchstens {max} Zeichen lang sein.',
  unknown_color: 'Unbekannte Farbe „{color}“.',
  unknown_icon: 'Unbekanntes Symbol „{icon}“.',
  unknown_kind: 'Unbekannte Art „{kind}“.',
  unknown_frequency: 'Unbekannte Häufigkeit „{frequency}“.',
  unknown_category: 'Diese Kategorie gibt es nicht mehr.',
  target_too_small: 'Das Tagesziel muss mindestens 0,1 sein.',
  limit_negative: 'Das Tageslimit darf nicht negativ sein.',
  unknown_target_type: 'Unbekannte Zielart „{type}“.',
  limit_needs_fixed_days:
      'Ein Limit gilt für feste Tage, nicht für eine Anzahl pro Woche oder Monat.',
  time_too_small: 'Die Zeit muss mindestens 0,1 Minuten betragen.',
  distance_too_small: 'Die Strecke muss mindestens 1 Meter betragen.',
  target_too_large: 'Das Tagesziel darf höchstens {max} sein.',
  time_too_large_minutes: 'Die Zeit darf höchstens {max} Minuten betragen.',
  distance_too_large_km: 'Die Strecke darf höchstens {max} Kilometer betragen.',
  step_too_large: 'Der Schritt darf höchstens {max} sein.',
  step_too_large_minutes: 'Der Schritt darf höchstens {max} Minuten betragen.',
  step_too_large_km: 'Der Schritt darf höchstens {max} Kilometer betragen.',
  times_per_week_range: '„Mal pro Woche“ muss zwischen 1 und 7 liegen.',
  times_per_month_range: '„Mal pro Monat“ muss zwischen 1 und 28 liegen.',
  weekday_missing: 'Bitte wähle mindestens einen Wochentag.',
  weekdays_invalid: 'Ungültige Auswahl der Wochentage.',
  week_interval_range:
      'Der Wochenabstand muss zwischen 1 und 52 Wochen liegen.',
  week_of_month_invalid:
      'Die Woche im Monat muss die erste bis vierte oder die letzte sein.',
  week_interval_and_month:
      'Ein Wochenabstand und eine Woche im Monat lassen sich nicht kombinieren.',
  interval_range: 'Der Abstand muss zwischen 1 und 365 Tagen liegen.',
  schedules_unordered:
      'Die Zeitpläne müssen an verschiedenen Tagen beginnen, der älteste zuerst.',
  schedules_with_target:
      'Zeitpläne können nicht zusammen mit Ziel oder Häufigkeit gesetzt werden.',
  schedules_empty: 'Mindestens ein Zeitplan ist nötig.',
  schedules_on_create: 'Eine neue Gewohnheit hat noch keine Zeitpläne.',
  schedule_start_missing: 'Ein Zeitplan braucht einen ersten Tag.',
  order_duplicate: 'Die neue Reihenfolge nennt einen Eintrag doppelt.',

  // Categories.
  category_name_empty: 'Der Name der Kategorie darf nicht leer sein.',
  category_name_too_long:
      'Der Name der Kategorie darf höchstens {max} Zeichen lang sein.',

  // Settings.
  setting_not_option: '{setting} muss einer dieser Werte sein: {options}',
  setting_out_of_range: '{setting} muss zwischen {min} und {max} liegen',
  overview_days_range:
      'Die Anzahl der Tage muss 0 (automatisch) oder zwischen 3 und {max} liegen.',
  band_color_invalid:
      'Die Akzentfarbe muss neutral oder eine der Farben der Gewohnheiten sein.',
  unknown_time_zone: 'Unbekannte Zeitzone „{zone}“.',

  // Import.
  import_format:
      'Die Datei ist kein Export der Gewohnheiten in Version {version}.',
};

/**
 * Returns the message template for a problem code in the UI language, or
 * undefined if there is none (then the server's English message is shown).
 */
export function errorTemplate(code) {
  return lang === 'de' ? deErrors[code] : undefined;
}

const dictionary = lang === 'de' ? de : {};

/**
 * Translates `text` and fills in its {placeholders} from `vars`. Unknown texts
 * are returned unchanged. `vars.context` selects a variant of an ambiguous
 * text, keyed as "context|text" (e.g. "verb|Archive").
 */
export function t(text, vars = {}) {
  const inContext =
      vars.context ? dictionary[`${vars.context}|${text}`] : undefined;
  let out = inContext ?? dictionary[text] ?? text;
  if (Array.isArray(out)) out = out[vars.n === 1 ? 0 : 1];
  return out.replace(
      /\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
}

/**
 * Returns the user's time zone, the server's, or undefined (browser default)
 * if the browser does not know either.
 */
export function userTimeZone() {
  for (const zone of [state.settings?.timeZone, state.serverTimeZone]) {
    if (!zone) continue;
    try {
      new Intl.DateTimeFormat('en', {timeZone: zone});
      return zone;
    } catch {
      // Unknown to the browser; try the next one.
    }
  }
  return undefined;
}

/** Attributes whose text is translated. */
const TRANSLATED_ATTRIBUTES = ['title', 'aria-label', 'placeholder'];

/**
 * Translates the text nodes and TRANSLATED_ATTRIBUTES below `root` in place.
 * Elements with translate="no" are skipped.
 */
export function translateDocument(root = document.body) {
  if (lang === 'en') return;
  const skip = (el) => el?.closest('[translate="no"]');

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.nodeValue.trim();
    // Normalise whitespace.
    const text = raw.replace(/\s+/g, ' ');
    if (!text || !(text in dictionary) || skip(node.parentElement)) continue;
    // Keep the surrounding whitespace.
    node.nodeValue = node.nodeValue.replace(raw, t(text));
  }

  for (const attr of TRANSLATED_ATTRIBUTES) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const text = el.getAttribute(attr);
      if (text in dictionary && !skip(el)) el.setAttribute(attr, t(text));
    }
  }
}
