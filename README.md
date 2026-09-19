# Habits

Ein Gewohnheitstracker als **eine einzige Datei**: HTTP-Server, Frontend und
SQLite-Treiber sind in das Binary einkompiliert. Zur Laufzeit entsteht nur noch
die Datenbankdatei.

Das Layout orientiert sich an [Loop Habit Tracker](https://github.com/isoron/uhabits):
eine Zeile pro Gewohnheit, eine Spalte pro Tag, heute ganz rechts.

## Bauen

```bash
go mod tidy
go build -o habits .
```

Braucht Go 1.26 oder neuer — das ist die Untergrenze, die `modernc.org/libc`
mitbringt. Tests laufen ohne jede Vorbereitung:

```bash
go test ./...
```

`internal/store` legt sich dafür eine echte SQLite-Datei im Temp-Verzeichnis an
und spielt alle Migrationen ein; weil der Treiber reines Go ist, braucht auch
das keine Toolchain.

Das Ergebnis ist statisch gelinkt — der SQLite-Treiber ist
[`modernc.org/sqlite`](https://pkg.go.dev/modernc.org/sqlite), ein reiner
Go-Port ohne cgo. Deshalb funktioniert auch Cross-Compiling ohne C-Toolchain:

```bash
GOOS=linux GOARCH=amd64 go build -trimpath -ldflags="-s -w" -o dist/habits-linux-amd64 .
GOOS=linux GOARCH=arm64 go build -trimpath -ldflags="-s -w" -o dist/habits-linux-arm64 .
```

`-trimpath` entfernt lokale Pfade aus dem Binary, `-s -w` die Debug-Symbole
(spart rund ein Drittel der Größe).

## Starten

```bash
./habits
```

Läuft dann auf <http://localhost:8080> im Modus `single-user` — ohne
Authentifizierung, alle Daten gehören dem Benutzer `local`. Das ist der
Entwicklungsmodus.

## Konfiguration

Alles über Umgebungsvariablen, damit keine Konfigurationsdatei neben dem Binary
liegen muss.

| Variable | Default | Bedeutung |
|---|---|---|
| `HABITS_ADDR` | `:8080` | Listen-Adresse |
| `HABITS_DB` | `habits.db` | Pfad zur SQLite-Datei |
| `HABITS_TZ` | `Local` | Zeitzone, die „heute" bestimmt (z. B. `Europe/Berlin`) |
| `HABITS_AUTH_MODE` | `single-user` | `single-user` oder `authelia` |
| `HABITS_DEFAULT_USER` | `local` | Benutzer im Modus `single-user` |
| `HABITS_TRUSTED_PROXIES` | — | **Pflicht** im Modus `authelia`: Komma-Liste aus IPs/CIDRs |
| `HABITS_USER_HEADER` | `Remote-User` | Header mit der Benutzerkennung |
| `HABITS_NAME_HEADER` | `Remote-Name` | Anzeigename (optional) |
| `HABITS_EMAIL_HEADER` | `Remote-Email` | E-Mail (optional) |
| `HABITS_GROUPS_HEADER` | `Remote-Groups` | Gruppen (optional) |

`HABITS_TZ` ist bewusst serverseitig: eine selbst gehostete Instanz soll genau
eine Vorstellung davon haben, welcher Tag gerade läuft.

## Authelia

Die Anwendung hat **keine eigenen Accounts**. Sie liest die Identität aus dem
`Remote-User`-Header, den der Reverse Proxy setzt, nachdem Authelias
`/api/verify` die Anfrage bestätigt hat. Jeder Benutzer sieht nur seine eigenen
Gewohnheiten; die Kennung wird kleingeschrieben gespeichert, damit `Alice` und
`alice` nicht zwei getrennte Datensätze bekommen.

> **Wichtig:** Header-Auth ist nur so sicher wie der Netzwerkpfad. Wer den Port
> direkt erreichen kann, könnte sich sonst per `Remote-User: admin` als
> beliebiger Benutzer ausgeben. Deshalb startet der Modus `authelia` nur mit
> gesetztem `HABITS_TRUSTED_PROXIES`, und Anfragen von anderen Peers werden mit
> 403 abgewiesen. Zusätzlich sollte der Port nur im internen Netz erreichbar
> sein (Docker: kein `ports:`-Mapping, nur ein gemeinsames Netzwerk).

Beispiel für Traefik:

```yaml
labels:
  - "traefik.http.routers.habits.rule=Host(`habits.example.com`)"
  - "traefik.http.routers.habits.middlewares=authelia@docker"
  - "traefik.http.services.habits.loadbalancer.server.port=8080"
```

Beispiel für Caddy:

```caddyfile
habits.example.com {
    forward_auth authelia:9091 {
        uri /api/verify?rd=https://auth.example.com
        copy_headers Remote-User Remote-Groups Remote-Name Remote-Email
    }
    reverse_proxy habits:8080
}
```

Passend dazu:

```bash
HABITS_AUTH_MODE=authelia
HABITS_TRUSTED_PROXIES=172.18.0.0/16
HABITS_TZ=Europe/Berlin
HABITS_DB=/data/habits.db
```

`/healthz` liegt außerhalb der Authentifizierung, damit ein Container-Healthcheck
ohne Identitäts-Header auskommt.

## Bedienung

| Aktion | Wie |
|---|---|
| Abhaken | Auf den Tag tippen |
| Anzahl/Zeit/Distanz erhöhen | Tippen erhöht um einen Schritt (Zeit: 5 min, Distanz: 500 m), nach dem Ziel zurück auf 0 |
| Genauen Wert setzen | Lange drücken oder Rechtsklick |
| Rückgängig / Wiederholen | `Strg+Z` / `Strg+Umschalt+Z`, oder der „Rückgängig"-Button im Toast |
| Neue Gewohnheit | `N` |
| Einstellungen | Zahnrad in der Kopfzeile |
| Design, Tage in der Übersicht, Archiv | alles im Einstellungsdialog |
| Kategorie zuweisen oder neu anlegen | Feld „Kategorie" im Habit-Editor |
| Kategorie umbenennen / löschen | ✎ und ✕ in der Blocküberschrift |
| Detailansicht schließen | `Esc` |
| Tag im Jahresverlauf ablesen | Mauszeiger über das Quadrat |

Gelöschte Gewohnheiten werden 30 Tage lang nur als gelöscht markiert. Erst danach
räumt der Start des Binaries sie endgültig ab — bis dahin bringt „Rückgängig"
sie mitsamt ihrer gesamten Historie zurück.

## Datenmodell

**Kategorien** — Gewohnheiten lassen sich zu Kategorien gruppieren; die Übersicht
zeichnet pro Kategorie einen eigenen Block. Eine Gewohnheit ohne Kategorie landet
im Block „Ohne Kategorie". Gibt es überhaupt keine Kategorie, ist das Board ein
einzelner Block ohne Überschriften.

Kategorien werden — wie Gewohnheiten — nur als gelöscht markiert. Ihre
Gewohnheiten behalten dabei die Zuordnung und rutschen lediglich in den Block
„Ohne Kategorie". Ein „Rückgängig" stellt den Block deshalb genau so wieder her,
wie er war, ohne eine einzige Gewohnheit anzufassen.

**Frequenzen** — `daily`, `times_per_week` (x-mal pro Woche, Woche beginnt
montags), `weekdays` (Bitmaske, Bit 0 = Montag), `every_n_days` (Intervall plus
Ankerdatum, damit eine Bearbeitung die Phase nicht verschiebt).

**Typen** — `check` (Haken), `count` (Anzahl, z. B. 8 Gläser), `time` (Zeit in
Minuten) und `distance` (Distanz in Metern). Intern ist jeder Eintrag eine Ganzzahl pro Tag; „erledigt" heißt
`wert >= zielwert`. Ein Tag ohne Eintrag hat *keine* Zeile in `entries`, statt
einer Zeile mit dem Wert 0 — so muss keine Auswertung zwischen „nicht erfasst"
und „mit 0 erfasst" unterscheiden.

**Serien** — ein noch offener heutiger Tag unterbricht keine Serie. Bei
`times_per_week` zählt die Serie in Wochen statt in Tagen, weil dort nicht der
einzelne Tag, sondern die Woche das Ziel ist.

## API

Alle Endpunkte liegen unter `/api` und antworten mit JSON.

| Methode | Pfad | Zweck |
|---|---|---|
| `GET` | `/api/state` | Kompletter Zustand für einen Kaltstart (ein Request); folgt der Einstellung `showArchived`, `?archived=0`/`1` überschreibt sie |
| `POST` | `/api/habits` | Anlegen |
| `GET` | `/api/habits/{id}` | Einzelne Gewohnheit mit **voller** Historie |
| `PATCH` | `/api/habits/{id}` | Ändern (nur gesendete Felder) |
| `DELETE` | `/api/habits/{id}` | Soft-Delete |
| `POST` | `/api/habits/{id}/restore` | Soft-Delete rückgängig machen |
| `POST` | `/api/habits/reorder` | Reihenfolge setzen |
| `PUT` | `/api/habits/{id}/entries/{date}` | Tageswert setzen |
| `POST` | `/api/categories` | Kategorie anlegen |
| `PATCH` | `/api/categories/{id}` | Umbenennen |
| `DELETE` | `/api/categories/{id}` | Soft-Delete |
| `POST` | `/api/categories/{id}/restore` | Soft-Delete rückgängig machen |
| `POST` | `/api/categories/reorder` | Reihenfolge setzen |
| `GET`/`PATCH` | `/api/settings` | Einstellungen, siehe unten |
| `GET` | `/api/background` | Hintergrundbild ausliefern (404, wenn keines hinterlegt) |
| `PUT` | `/api/background` | Bild hochladen (roher Body, JPEG oder PNG, höchstens 12 MB) |
| `DELETE` | `/api/background` | Bild entfernen |

Alle schreibenden Endpunkte verlangen `Content-Type: application/json`. Das ist
kein Formalismus: ohne diese Bedingung wäre `POST` von einer fremden Seite aus
erreichbar, weil ein Formular `text/plain` senden darf und ein solcher Body
gültiges JSON sein kann. Mit der Bedingung muss der Browser vorher einen
Preflight schicken, den die Same-Origin-Policy abweist.

`/api/state` liefert neben den Gewohnheiten auch die Tabellen, die der Client
zum Lesen eines gespeicherten Wertes braucht: `colors` (die Palette) und `kinds`
(pro Typ `scale`, `step`, `max`, `unit`). Sie werden geschickt statt im
JavaScript ein zweites Mal hingeschrieben — diese Zahlen entscheiden, ob 5000
fünf Kilometer oder fünfhundert Wiederholungen bedeutet, und eine zweite Kopie
könnte auseinanderlaufen, ohne dass irgendetwas bricht.

`PUT …/entries/{date}` liefert im Feld `previous` den überschriebenen Wert
zurück. Genau daraus baut das Frontend seinen Undo-Stack: Rückgängig heißt
einfach, `previous` wieder zu schreiben. Deshalb funktioniert Undo auch ohne
jede lokale Persistenz.

## Aufbau

```
main.go                     Start, Signal-Handling, //go:embed des Frontends
internal/config             Konfiguration aus der Umgebung
internal/auth               Authelia-Forward-Auth als Middleware
internal/domain             Habits, Frequenzen, Serien — ohne I/O
internal/store              SQLite: Schema, Migrationen, Queries
internal/httpapi            Routing, JSON, Auslieferung des Frontends
web/                        Frontend (ES-Module, kein Build-Schritt)
  assets/overview.js        Board: Blöcke pro Kategorie, geteilter Tages-Header
  assets/cells.js           Habit-Zeile und Tageszelle
  assets/actions.js         alle Mutationen, jeweils mit Undo-Schritt
  assets/icons.js           Inline-SVG-Icons für Buttons
  assets/categorypicker.js  verschachtelter Dialog zur Kategorieauswahl
  assets/settings.js        Einstellungsdialog, schreibt jede Änderung sofort
```

`internal/domain` kennt weder Datenbank noch HTTP. Die Regeln — wann ein Habit
fällig ist, wann ein Tag als erledigt gilt, wie eine Serie zählt — stehen dort
und sind ohne Server testbar. Das ist keine Absichtserklärung: `stats_test.go`,
`habit_test.go` und `date_test.go` testen sie genau so, ohne Datenbank und ohne
Netzwerk.

Das Frontend ist bewusst ohne Build-Schritt gebaut: native ES-Module, kein npm,
kein Bundler. `go build` bleibt damit der einzige Befehl, der zum Release nötig
ist.

## Erweitern

**Neue Migration** — einen weiteren String an `migrations` in
`internal/store/store.go` anhängen. Bereits ausgelieferte Einträge nie ändern;
`PRAGMA user_version` verfolgt den Stand.

**Neues Feld an einer Gewohnheit** — Feld in `domain.Habit` und dessen
`Validate()`, Spalte per Migration, Lesen/Schreiben in
`internal/store/habits.go`, optionaler Zeiger in `habitInput`
(`internal/httpapi/handlers_habits.go`), Eingabe in `web/assets/editor.js`.
Und zuletzt in `writableFields()` in `web/assets/actions.js`: PATCH liest ein
fehlendes Feld als „unverändert", ein dort vergessenes Feld wird also von
seinem eigenen Undo nicht zurückgenommen.

**Neuer Habit-Typ** — `AllKinds` in `internal/domain/habit.go` ergänzen und die
vier Methoden `Scale`, `Step`, `MaxTarget`, `Unit` bedienen. Der Client bekommt
das über `kinds` in `/api/state` und braucht keine eigene Tabelle; im Editor
kommen nur die Eingabefelder dazu.

**Neues Werkzeug (Kanban, Pomodoro, To-do)** — als eigenes `internal/<tool>`
mit eigenem Domain-Paket und eigenen Tabellen. Was dabei geteilt wird, ist die
Infrastruktur: `config`, `auth`, die Store-Verbindung, das Routing und die
CSS-Tokens in `web/assets/base.css`.

**Undo für eine neue Aktion** — die Aktion in `web/assets/actions.js`
ausführen und anschließend `record({label, undo, redo})` aufrufen. `undo` und
`redo` sind Server-Aufrufe, keine lokalen Zustandsänderungen; deshalb bleibt
die Historie auch dann korrekt, wenn parallel ein zweites Gerät schreibt.


**Historie und Nachladen** — `/api/state` liefert pro Gewohnheit nur die
Einträge der letzten 200 Tage; das reicht für das Board und hält die Antwort
klein. Die Detailansicht zeichnet ein ganzes Kalenderjahr und holt sich deshalb
beim Öffnen einmal die vollständige Historie über `/api/habits/{id}` nach.
Streaks und die beste Serie rechnet der Server ohnehin immer über alles.

## Einstellungen

Das Zahnrad in der Kopfzeile öffnet den Einstellungsdialog. Er ist in Reiter
geteilt; alle Werte liegen serverseitig pro Benutzer.

| Schlüssel | Werte | Bedeutung |
|---|---|---|
| `theme` | `system`, `light`, `dark` | Erscheinungsbild; `system` folgt dem Gerät |
| `font` | `system`, `inter`, `roboto`, `geist`, `opensans`, `montserrat`, `poppins`, `lato` | Schriftart, alle im Binary |
| `overviewDays` | 0 = automatisch, sonst 3–90 | Tagesspalten im Board |
| `alignWeeks` | bool | Board auf ganze Kalenderwochen ausrichten |
| `showArchived` | bool | Archivierte Gewohnheiten einblenden |
| `reorderMode` | `drag`, `buttons` | Ziehen am Griff oder Pfeile je Eintrag |
| `pattern` | `none`, `dots`, `grid`, `diagonal`, `cross`, `image` | Textur hinter der Seite; `image` ist das hochgeladene Bild |
| `bandColor` | `neutral` oder eine Habit-Farbe | Färbung der Heute-Spalte |
| `bandOpacity` | 0–100 | Wie kräftig diese Markierung gezeichnet wird |
| `backgroundDim` | 0–100 | Abdunklung des hochgeladenen Bildes |
| `backgroundBlur` | 0–100 | Weichzeichnung desselben |
| `surfaceOpacity` | 20–100 | Deckkraft der Karten über einem Bild |
| `surfaceBlur` | 0–100 | Wie weich sie durchscheinen lassen |

Die Anzahl der Tage: **Automatisch** füllt die verfügbare Breite, sonst wählst
du eine feste Zahl. Die gewählte Zahl ist eine Obergrenze, keine Garantie — 28
Spalten passen auf ein Telefon nicht. Der Dialog nennt deshalb immer die
tatsächlich gezeigte Anzahl und erklärt die Abweichung, statt das Board still
abzuschneiden.

Bei einer festen Zahl schrumpft das Board auf genau diese Spalten und bleibt
dabei im Fenster zentriert. Im Modus „Automatisch" füllt es die Breite, und die
Namensspalte nimmt den Rest auf — das ist der Unterschied zwischen „so viele
wie möglich" und „genau so viele".

Alle Einstellungen liegen serverseitig pro Benutzer und gelten damit auf jedem
Gerät. Jede Änderung wird sofort geschrieben; es gibt keinen Speichern-Knopf,
weil die Einstellungen voneinander unabhängig sind.

## Bekannte Grenzen

- Der SQLite-Pool ist auf **eine** Verbindung begrenzt. Für einen persönlichen
  Tracker ist das die einfachste korrekte Wahl; sollte Lesedurchsatz je zum
  Thema werden, wäre ein zweiter, nur lesender Pool die Lösung — nicht ein
  größerer gemeinsamer.
- Die Fälligkeitslogik ist in `internal/domain/habit.go` und
  `web/assets/habit.js` doppelt vorhanden — der Server braucht sie zur
  Validierung, der Client, um ein ganzes Raster ohne Round-Trip zu zeichnen.
  Änderungen an Frequenzregeln müssen an beiden Stellen erfolgen. Die *Zahlen*
  je Typ (Skala, Schrittweite, Obergrenze) sind dagegen nicht mehr doppelt: sie
  kommen als `kinds` mit `/api/state`.
- Die Listen der Schriftarten und Muster stehen in `internal/store/settings.go`,
  in `web/assets/app.js` und in den `<option>`-Elementen von `index.html`. Ein
  Auseinanderlaufen fällt hier nur auf den Default zurück, statt Daten falsch zu
  lesen — deshalb bisher belassen.
- Der Typ einer Gewohnheit lässt sich nicht mehr ändern, sobald Tage erfasst
  sind. Jeder Typ speichert eine Ganzzahl pro Tag, aber nicht dieselbe: 5000
  sind fünf Kilometer oder fünfhundert Wiederholungen. Eine ehrliche Umrechnung
  gibt es nicht, also wird der Wechsel abgelehnt statt die Historie still
  umzudeuten. Ohne Einträge bleibt er möglich — dann wird er auch gebraucht.
- Die Detailansicht zeichnet immer das *laufende* Kalenderjahr. Frühere Jahre
  sind über die Oberfläche nicht erreichbar.
