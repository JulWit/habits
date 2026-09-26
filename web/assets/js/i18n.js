// Translation of the interface.
//
// The English text is its own key, the way gettext does it: the markup and the
// scripts stay readable in the language they were written in, and a string
// without a translation simply shows in English rather than as a key nobody
// can read. Placeholders are written {name} and filled from the second
// argument of t().
//
// The language is the one the server rendered into <html lang>, from the
// user's setting or the browser's Accept-Language. It is fixed for the life of
// the page: changing it reloads, because much of the interface is built once
// and would otherwise keep the old words.

import { state } from "./state.js";

export const lang = document.documentElement.lang === "de" ? "de" : "en";

/** The locale numbers and times are written in. en-GB for the day-month order. */
export const locale = lang === "de" ? "de-DE" : "en-GB";

/**
 * German, keyed by the English text.
 *
 * An array holds the singular and the plural, picked by `n`. Only German needs
 * them where the English is the same either way ("5-day streak"); where English
 * differs too, the code already asks for each form by its own key.
 */
const de = {
  // ---------- shell: header, board, empty state ----------
  "New habit": "Neue Gewohnheit",
  "Search": "Suche",
  "Search (/)": "Suche (/)",
  "Show only open": "Nur offene zeigen",
  "Settings": "Einstellungen",
  "Nothing left open today.": "Heute ist nichts mehr offen.",
  "No habits yet": "Noch keine Gewohnheiten",
  "Create your first habit — daily, on certain weekdays or every few days.":
    "Leg deine erste Gewohnheit an — täglich, an bestimmten Wochentagen oder alle paar Tage.",
  "Create first habit": "Erste Gewohnheit anlegen",

  // ---------- habit editor ----------
  "Edit habit": "Gewohnheit bearbeiten",
  "Name": "Name",
  "e.g. drink water": "z. B. Wasser trinken",
  "Colour": "Farbe",
  "Colour {color}": "Farbe {color}",
  "No colour": "Keine Farbe",
  "Icon": "Symbol",
  "Icon {name}": "Symbol {name}",
  "No icon": "Kein Symbol",
  // The icons and the palette by name (icons.js), for screen readers and tooltips.
  "Water drop": "Wassertropfen", "Apple": "Apfel", "Cutlery": "Besteck", "Coffee": "Kaffee",
  "Pill": "Tablette", "Heart": "Herz", "Dumbbell": "Hantel", "Bicycle": "Fahrrad",
  "Mountain": "Berg", "Flame": "Flamme", "Bed": "Bett", "Moon": "Mond", "Sun": "Sonne",
  "Book": "Buch", "Pencil": "Stift", "Light bulb": "Glühbirne", "Code": "Code",
  "Globe": "Globus", "Music": "Musik", "Paint palette": "Farbpalette", "Camera": "Kamera",
  "Leaf": "Blatt", "House": "Haus", "Wallet": "Geldbörse", "People": "Personen",
  "Smartphone": "Smartphone", "No entry": "Verbotsschild", "Smile": "Lächeln",
  "Star": "Stern", "Target": "Zielscheibe", "Clock": "Uhr", "Check mark": "Häkchen",
  "Red": "Rot", "Orange": "Orange", "Yellow": "Gelb", "Lime": "Hellgrün", "Green": "Grün",
  "Teal": "Petrol", "Sky blue": "Himmelblau", "Blue": "Blau", "Indigo": "Indigo",
  "Violet": "Violett", "Pink": "Pink", "Slate": "Schiefergrau",
  "Category": "Kategorie",
  "Kind": "Art",
  "Check": "Abhaken",
  "Count": "Anzahl",
  "Time": "Zeit",
  "Distance": "Strecke",
  "Daily target": "Tagesziel",
  "Unit": "Einheit",
  "e.g. glasses": "z. B. Gläser",
  "Step": "Schritt",
  "e.g. 1": "z. B. 1",
  "e.g. 5": "z. B. 5",
  "e.g. 0.5": "z. B. 0,5",
  "A click on a day changes the entry by this much.":
    "Ein Klick auf einen Tag ändert den Eintrag um so viel.",
  "Daily target in minutes": "Tagesziel in Minuten",
  "Step in minutes": "Schritt in Minuten",
  "Daily target in km": "Tagesziel in km",
  "Step in km": "Schritt in km",
  "Frequency": "Häufigkeit",
  "Daily": "Täglich",
  "Times per week": "Mal pro Woche",
  "Weekdays": "Wochentage",
  "Custom interval": "Eigener Abstand",
  "How many times per week": "Wie oft pro Woche",
  "The week starts on Monday. Which days you pick is up to you.":
    "Die Woche beginnt am Montag. Welche Tage du wählst, bleibt dir überlassen.",
  "On these days": "An diesen Tagen",
  "Repeat": "Wiederholen",
  "Every week": "Jede Woche",
  "Every few weeks": "Alle paar Wochen",
  "Once a month": "Einmal im Monat",
  "Every … weeks": "Alle … Wochen",
  "Starting on": "Ab dem",
  "Which one in the month": "Welcher im Monat",
  "First": "Erster",
  "Second": "Zweiter",
  "Third": "Dritter",
  "Fourth": "Vierter",
  "Last": "Letzter",
  "First and Monday means the first Monday of every month.":
    "Erster und Montag heißt: der erste Montag jedes Monats.",
  "Every … days": "Alle … Tage",
  "Cancel": "Abbrechen",
  "Create": "Anlegen",
  "Save": "Speichern",
  "No category": "Keine Kategorie",
  "Deleted category": "Gelöschte Kategorie",
  "Please select at least one weekday.": "Bitte wähle mindestens einen Wochentag.",

  // ---------- settings ----------
  "Settings sections": "Bereiche der Einstellungen",
  "Appearance": "Darstellung",
  "Overview": "Übersicht",
  "Archive": "Archiv",
  "Language & time": "Sprache & Zeit",
  "Theme": "Design",
  "System": "System",
  "Light": "Hell",
  "Dark": "Dunkel",
  "Font": "Schrift",
  "Density": "Dichte",
  "Compact": "Kompakt",
  "Standard": "Standard",
  "Comfortable": "Großzügig",
  "Spacing inside and around every element, and how heavy its emphasis is set.":
    "Abstände in und um jedes Element und wie kräftig Hervorhebungen gesetzt sind.",
  "Accent colour": "Akzentfarbe",
  "Opacity": "Deckkraft",
  "Neutral": "Neutral",
  "Today band": "Heute-Band",
  "Band through today's column": "Band durch die heutige Spalte",
  "Off, only today's date in the header is marked.":
    "Aus: Nur das heutige Datum in der Kopfzeile wird markiert.",
  "Band opacity": "Deckkraft des Bands",
  "Background pattern": "Hintergrundmuster",
  "Plain": "Schlicht",
  "Dots": "Punkte",
  "Grid": "Raster",
  "Diagonal": "Diagonal",
  "Cross-hatch": "Kreuzschraffur",
  "Own image": "Eigenes Bild",
  "Background image": "Hintergrundbild",
  "Choose image": "Bild wählen",
  "Remove": "Entfernen",
  "JPEG or PNG, at most 12 MB. The image is stored unchanged.":
    "JPEG oder PNG, höchstens 12 MB. Das Bild wird unverändert gespeichert.",
  "The image may be at most 12 MB.": "Das Bild darf höchstens 12 MB groß sein.",
  "Image": "Bild",
  "Dim": "Abdunkeln",
  "Blur": "Weichzeichnen",
  "Surfaces": "Flächen",
  "Reordering": "Anordnen",
  "Arrange": "Anordnen",
  "Shows the handles for moving habits and categories. Applies until the page is next loaded.":
    "Zeigt die Griffe zum Verschieben von Gewohnheiten und Kategorien. Gilt bis zum nächsten Laden der Seite.",
  "Drag": "Ziehen",
  "Buttons": "Pfeile",
  "Categories and habits are moved by their handle.":
    "Kategorien und Gewohnheiten werden an ihrem Griff verschoben.",
  "Categories and habits are moved with arrows — by keyboard too.":
    "Kategorien und Gewohnheiten werden mit Pfeilen verschoben — auch per Tastatur.",
  "Days in the overview": "Tage in der Übersicht",
  "Automatic": "Automatisch",
  "As many days are shown as fit in the window — currently {n}.":
    "Es werden so viele Tage gezeigt, wie ins Fenster passen — derzeit {n}.",
  "Only {n} days fit in the window right now. In a wider window it will be {days}.":
    "Gerade passen nur {n} Tage ins Fenster. In einem breiteren Fenster sind es {days}.",
  "{n} days are shown right now.": "Gerade werden {n} Tage gezeigt.",
  "Start the week on Monday": "Woche am Montag beginnen",
  "The overview ends on today.": "Die Übersicht endet mit heute.",
  "Possible from 7 columns on — {n} fit right now.":
    "Ab 7 Spalten möglich — gerade passen {n}.",
  "The overview shows whole calendar weeks, including the remaining days of this week.":
    "Die Übersicht zeigt ganze Kalenderwochen, einschließlich der restlichen Tage dieser Woche.",
  "Show archived habits": "Archivierte Gewohnheiten zeigen",
  "1 habit is archived.": "1 Gewohnheit ist archiviert.",
  "{n} habits are archived.": "{n} Gewohnheiten sind archiviert.",
  "Done": "Fertig",
  "Language": "Sprache",
  "Browser language": "Sprache des Browsers",
  "The page reloads to switch the language.": "Zum Wechseln der Sprache wird die Seite neu geladen.",
  "Time zone": "Zeitzone",
  "Server default": "Vorgabe des Servers",
  "Server default ({zone})": "Vorgabe des Servers ({zone})",
  "Other": "Weitere",
  "Use this device's time zone ({zone})": "Zeitzone dieses Geräts verwenden ({zone})",
  "Decides when a new day begins on the board.": "Bestimmt, wann auf der Übersicht ein neuer Tag beginnt.",
  "It is {time} there now.": "Dort ist es jetzt {time} Uhr.",

  // ---------- category dialogs and screen ----------
  "Choose category": "Kategorie wählen",
  "New category": "Neue Kategorie",
  "Name of the new category": "Name der neuen Kategorie",
  "Edit category": "Kategorie bearbeiten",
  "Progress": "Fortschritt",
  "Show today's progress": "Heutigen Fortschritt zeigen",
  "The bar and the count beside the name on the board.":
    "Der Balken und die Anzahl neben dem Namen auf der Übersicht.",
  "1 habit": "1 Gewohnheit",
  "{n} habits": "{n} Gewohnheiten",
  "Habits": "Gewohnheiten",
  "Perfect days {since}": "Perfekte Tage {since}",
  "(since {date})": "(seit {date})",
  "{n} of {total}": "{n} von {total}",
  "No habit in this category yet.": "In dieser Kategorie ist noch keine Gewohnheit.",
  "wk": "Wo.",
  "day": "Tag",
  "days": "Tage",

  // ---------- search ----------
  "Search habits and categories": "Gewohnheiten und Kategorien suchen",
  "Search habits and categories…": "Gewohnheiten und Kategorien suchen …",
  "Results": "Ergebnisse",
  "No habit or category matches.": "Keine Gewohnheit oder Kategorie passt.",
  "Category · 1 habit": "Kategorie · 1 Gewohnheit",
  "Category · {n} habits": "Kategorie · {n} Gewohnheiten",

  // ---------- value dialog ----------
  "Enter value": "Wert eingeben",
  "Less": "Weniger",
  "More": "Mehr",
  "Value": "Wert",
  "Value in {unit}": "Wert in {unit}",
  "Clear": "Löschen",
  "Daily target: {target}": "Tagesziel: {target}",
  "{goal} · step: {step}": "{goal} · Schritt: {step}",

  // ---------- board ----------
  "Earlier days": "Frühere Tage",
  "Later days": "Spätere Tage",
  "Back to today": "Zurück zu heute",
  "Move habit": "Gewohnheit verschieben",
  "Move habit up": "Gewohnheit nach oben",
  "Move habit down": "Gewohnheit nach unten",
  "Move category": "Kategorie verschieben",
  "Move category up": "Kategorie nach oben",
  "Move category down": "Kategorie nach unten",
  "{done} of {due} done today": "{done} von {due} heute erledigt",
  "{done} of {due} done": "{done} von {due} erledigt",
  "Done today": "Heute erledigt",
  "Today": "Heute",
  "Nothing due today": "Heute steht nichts an",
  "All habits done!": "Alle Gewohnheiten erledigt!",
  "Everything ticked off. Well done!": "Alles abgehakt. Gut gemacht!",
  "Done for today – enjoy the rest of it.": "Fertig für heute – genieß den Rest des Tages.",
  "{n} of {n}. Nothing left to do today.": "{n} von {n}. Heute ist nichts mehr zu tun.",
  "A clean sweep today!": "Heute alles geschafft!",

  // ---------- day cells ----------
  "done": "erledigt",
  "planned": "geplant",
  "{value} planned": "{value} geplant",
  "{value} of {target}": "{value} von {target}",
  "{value} of {target} planned": "{value} von {target} geplant",
  "open": "offen",
  "not scheduled": "nicht geplant",
  ", day {n} of a streak": ", Tag {n} einer Serie",
  "{name}, {when}: cleared": "{name}, {when}: gelöscht",

  // ---------- habit descriptions ----------
  "daily": "täglich",
  "{n}× per week": "{n}× pro Woche",
  "last": "letzter",
  "1st": "1.",
  "2nd": "2.",
  "3rd": "3.",
  "4th": "4.",
  "{which} {days} of the month": "{which} {days} im Monat",
  "{days} every {n} weeks": "{days} alle {n} Wochen",
  "Mon–Fri": "Mo–Fr",
  "every {n} days": "alle {n} Tage",
  "Archived": "Archiviert",
  "archived": "archiviert",
  "{n}-day streak": ["{n} Tag in Folge", "{n} Tage in Folge"],
  "{n}-week streak": ["{n} Woche in Folge", "{n} Wochen in Folge"],

  // ---------- relative dates ----------
  "today": "heute",
  "yesterday": "gestern",
  "the day before yesterday": "vorgestern",
  "tomorrow": "morgen",
  "the day after tomorrow": "übermorgen",
  "{n} days ago": "vor {n} Tagen",
  "just now": "gerade eben",
  "{n} min ago": "vor {n} Min.",
  "{n} h ago": "vor {n} Std.",

  // ---------- detail screen ----------
  "Back": "Zurück",
  "Edit": "Bearbeiten",
  "Delete": "Löschen",
  "Reactivate": "Reaktivieren",
  "verb|Archive": "Archivieren",
  "1 day": "1 Tag",
  "{n} days": "{n} Tage",
  "1 week": "1 Woche",
  "{n} weeks": "{n} Wochen",
  "Current streak": "Aktuelle Serie",
  "Best streak": "Beste Serie",
  "Rate (30 days)": "Quote (30 Tage)",
  "Total": "Gesamt",
  "Activity": "Aktivität",
  "Last done": "Zuletzt erledigt",
  "Not yet": "Noch nie",
  "Last changed": "Zuletzt geändert",
  "Year {year}": "Jahr {year}",
  "still ahead": "liegt noch vor dir",
  "nothing recorded": "nichts eingetragen",
  "Today, {date}": "Heute, {date}",
  "less": "weniger",
  "more": "mehr",
  "Day": "Tag",
  "Week": "Woche",
  "Month": "Monat",
  "Cumulative": "Kumuliert",
  "Period": "Zeitraum",
  "No entries in {year} yet.": "{year} gibt es noch keine Einträge.",
  "in {year}": "im Jahr {year}",
  " {scope} · avg ": " {scope} · Ø ",
  " on 1 active day · best day ": " an 1 aktiven Tag · bester Tag ",
  " on {n} active days · best day ": " an {n} aktiven Tagen · bester Tag ",
  "{total} · of that +{sum}": "{total} · davon +{sum}",
  "{total} · nothing added": "{total} · nichts dazugekommen",
  "End of {month}": "Ende {month}",
  "Week from {date}": "Woche ab {date}",

  // ---------- undo, toasts ----------
  "Undo": "Rückgängig",
  "Redo": "Wiederholen",
  "Undone: {label}": "Rückgängig gemacht: {label}",
  "Redone: {label}": "Wiederhergestellt: {label}",
  "Close": "Schließen",
  "Unknown error": "Unbekannter Fehler",
  "Entry cleared: {name}, {when}": "Eintrag gelöscht: {name}, {when}",
  "\"{name}\" created": "„{name}“ angelegt",
  "\"{name}\" edited": "„{name}“ bearbeitet",
  "\"{name}\" deleted": "„{name}“ gelöscht",
  "\"{name}\" archived": "„{name}“ archiviert",
  "\"{name}\" reactivated": "„{name}“ reaktiviert",
  "Category \"{name}\" created": "Kategorie „{name}“ angelegt",
  "Category \"{name}\" edited": "Kategorie „{name}“ bearbeitet",
  "Category \"{name}\" deleted": "Kategorie „{name}“ gelöscht",
  "Category \"{name}\" deleted — 1 habit kept":
    "Kategorie „{name}“ gelöscht — 1 Gewohnheit bleibt erhalten",
  "Category \"{name}\" deleted — {n} habits kept":
    "Kategorie „{name}“ gelöscht — {n} Gewohnheiten bleiben erhalten",

  // ---------- messages from the server and the network ----------
  "No connection to the server": "Keine Verbindung zum Server",
  "Session expired — please reload the page": "Sitzung abgelaufen — bitte lade die Seite neu",
  "Entries may be at most one year in the future":
    "Einträge dürfen höchstens ein Jahr in der Zukunft liegen",
  "The habit is not scheduled on this day": "Die Gewohnheit ist an diesem Tag nicht geplant",
  "Entries may not be dated before {year}": "Einträge dürfen nicht vor dem Jahr {year} liegen.",
  "The new order names the same entry twice.": "Die neue Reihenfolge nennt einen Eintrag doppelt.",
  "Internal server error": "Interner Serverfehler",
  "Not found": "Nicht gefunden",
  "the image could not be read": "Das Bild konnte nicht gelesen werden",

  // Validation, keyed by the server's templates (domain.Invalid). A string
  // placeholder is translated on its own, a number written in German notation.
  "name must not be empty": "Der Name darf nicht leer sein.",
  "name is longer than {max} characters": "Der Name darf höchstens {max} Zeichen lang sein.",
  "unit is longer than {max} characters": "Die Einheit darf höchstens {max} Zeichen lang sein.",
  "category name must not be empty": "Der Name der Kategorie darf nicht leer sein.",
  "category name is longer than {max} characters":
    "Der Name der Kategorie darf höchstens {max} Zeichen lang sein.",
  "colour must be a hex value like #4caf50": "Die Farbe muss ein Hex-Wert wie #4caf50 sein.",
  "unknown icon \"{icon}\"": "Unbekanntes Symbol „{icon}“.",
  "unknown habit kind \"{kind}\"": "Unbekannte Art „{kind}“.",
  "unknown frequency \"{frequency}\"": "Unbekannte Häufigkeit „{frequency}“.",
  "unknown category": "Diese Kategorie gibt es nicht mehr.",
  "date is missing": "Das Datum fehlt.",
  "target must be at least 0.1": "Das Tagesziel muss mindestens 0,1 sein.",
  "time must be at least 0.1 minutes": "Die Zeit muss mindestens 0,1 Minuten betragen.",
  "distance must be at least 1 metre": "Die Strecke muss mindestens 1 Meter betragen.",
  "target may be at most {max}": "Das Tagesziel darf höchstens {max} sein.",
  "time may be at most {max} minutes": "Die Zeit darf höchstens {max} Minuten betragen.",
  "distance may be at most {max} kilometres": "Die Strecke darf höchstens {max} Kilometer betragen.",
  "step may be at most {max}": "Der Schritt darf höchstens {max} sein.",
  "step may be at most {max} minutes": "Der Schritt darf höchstens {max} Minuten betragen.",
  "step may be at most {max} kilometres": "Der Schritt darf höchstens {max} Kilometer betragen.",
  "value must not be negative": "Der Wert darf nicht negativ sein.",
  "value may be at most {max}": "Der Wert darf höchstens {max} sein.",
  "value may be at most {max} minutes": "Der Wert darf höchstens {max} Minuten betragen.",
  "value may be at most {max} kilometres": "Der Wert darf höchstens {max} Kilometer betragen.",
  "times per week must be between 1 and 7": "„Mal pro Woche“ muss zwischen 1 und 7 liegen.",
  "at least one weekday must be selected": "Bitte wähle mindestens einen Wochentag.",
  "invalid weekday selection": "Ungültige Auswahl der Wochentage.",
  "week interval must be between 1 and 52 weeks":
    "Der Wochenabstand muss zwischen 1 und 52 Wochen liegen.",
  "week of the month must be 1 to 4 or the last":
    "Die Woche im Monat muss die erste bis vierte oder die letzte sein.",
  "a week interval and a week of the month cannot be combined":
    "Ein Wochenabstand und eine Woche im Monat lassen sich nicht kombinieren.",
  "interval must be between 1 and 365 days": "Der Abstand muss zwischen 1 und 365 Tagen liegen.",
  "The kind can no longer be changed: 1 day is already recorded, and its value would mean something else as \"{kind}\". Create a new habit instead.":
    "Die Art lässt sich nicht mehr ändern: Es ist schon 1 Tag erfasst, und sein Wert hätte als „{kind}“ eine andere Bedeutung. Leg stattdessen eine neue Gewohnheit an.",
  "The kind can no longer be changed: {count} days are already recorded, and their values would mean something else as \"{kind}\". Create a new habit instead.":
    "Die Art lässt sich nicht mehr ändern: Es sind schon {count} Tage erfasst, und ihre Werte hätten als „{kind}“ eine andere Bedeutung. Leg stattdessen eine neue Gewohnheit an.",
  "the image may be at most {max} MB": "Das Bild darf höchstens {max} MB groß sein.",
  "the file is not a jpeg or png image": "Die Datei ist kein JPEG- oder PNG-Bild.",
  "only jpeg and png are supported, not {format}":
    "Nur JPEG und PNG werden unterstützt, nicht {format}.",
  "the image has no area": "Das Bild hat keine Fläche.",
  "the image may be at most {max} pixels per edge":
    "Das Bild darf höchstens {max} Pixel pro Kante haben.",
  "the image has too many pixels (at most {max} million)":
    "Das Bild hat zu viele Pixel (höchstens {max} Millionen).",
  "unknown time zone \"{zone}\"": "Unbekannte Zeitzone „{zone}“.",
};

const dictionary = lang === "de" ? de : {};

/**
 * The text in the page's language, with {placeholders} filled in.
 *
 * An unknown text comes back as it is, so a sentence added without a
 * translation still reads - in English.
 *
 * `vars.context` tells apart one English word with two meanings: "Archive" is
 * a place on the settings tab and a verb on a button, and German needs a word
 * for each. The dictionary keys the second as "verb|Archive".
 */
export function t(text, vars = {}) {
  const inContext = vars.context ? dictionary[`${vars.context}|${text}`] : undefined;
  let out = inContext ?? dictionary[text] ?? text;
  if (Array.isArray(out)) out = out[vars.n === 1 ? 0 : 1];
  return out.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
}

/**
 * The zone the user's days are counted in: their own choice, else the
 * server's. Undefined - the browser's own - when neither is a name the browser
 * can format in, which is what "Local" from a server without HABITS_TZ is.
 */
export function userTimeZone() {
  for (const zone of [state.settings?.timeZone, state.serverTimeZone]) {
    if (!zone) continue;
    try {
      new Intl.DateTimeFormat("en", { timeZone: zone });
      return zone;
    } catch {
      // Not a zone this browser knows; try the next.
    }
  }
  return undefined;
}

/** The attributes that carry words a person reads or hears. */
const TRANSLATED_ATTRIBUTES = ["title", "aria-label", "placeholder"];

/**
 * Translates the static markup of the shell in place.
 *
 * index.html is written in English, and the server only fills in the language
 * attribute; rather than keying every element, the text nodes and the handful
 * of attributes above are looked up as they stand. Anything marked
 * translate="no" is left alone - the name of the app, for one.
 */
export function translateDocument(root = document.body) {
  if (lang === "en") return;
  const skip = (el) => el?.closest('[translate="no"]');

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const raw = node.nodeValue.trim();
    // A sentence wrapped over two lines in the markup is one sentence here.
    const text = raw.replace(/\s+/g, " ");
    if (!text || !(text in dictionary) || skip(node.parentElement)) continue;
    // The whitespace around the text is kept: it is what separates an icon from
    // its caption.
    node.nodeValue = node.nodeValue.replace(raw, t(text));
  }

  for (const attr of TRANSLATED_ATTRIBUTES) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const text = el.getAttribute(attr);
      if (text in dictionary && !skip(el)) el.setAttribute(attr, t(text));
    }
  }
}
