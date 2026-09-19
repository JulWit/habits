<#
.SYNOPSIS
    Entfernt Windows-Firewallregeln, die auf habits.exe zeigen.

.DESCRIPTION
    `go run` kompiliert bei jedem Start in ein frisches Temp-Verzeichnis
    (...\Temp\go-buildNNNNNNNN\b001\exe\habits.exe). Firewallregeln gelten pro
    Programmpfad, also legt Windows bei jedem Start eine neue an - nach ein paar
    Dutzend Neustarts stehen entsprechend viele davon in der Liste, die meisten
    auf Pfade, die es nicht mehr gibt oder nie wieder geben wird.

    Das Skript sucht alle Regeln, deren Programm auf den angegebenen Dateinamen
    endet, zeigt sie nach Herkunft aufgeschlüsselt an und entfernt sie.

.PARAMETER Program
    Dateiname des Programms. Standard: habits.exe

.PARAMETER TempOnly
    Nur Regeln entfernen, deren Programm im Temp-Verzeichnis liegt - also die
    Wegwerf-Kompilate von `go run`. Regeln für eine fest installierte oder im
    Projekt gebaute habits.exe bleiben dann stehen.

.EXAMPLE
    .\Remove-HabitsFirewallRules.ps1 -WhatIf

    Zeigt, was entfernt würde, ohne etwas zu ändern.

.EXAMPLE
    .\Remove-HabitsFirewallRules.ps1 -TempOnly

    Räumt nur die Regeln der Temp-Kompilate weg.

.NOTES
    Das Ändern von Firewallregeln erfordert Administratorrechte. Ohne sie bricht
    das Skript ab, statt pro Regel einen Fehler zu werfen.

    Die Datei ist als UTF-8 mit BOM gespeichert: Windows PowerShell 5.1 liest
    .ps1-Dateien ohne BOM als ANSI und zerlegt dabei jeden Umlaut.
#>
[CmdletBinding(SupportsShouldProcess, ConfirmImpact = 'High')]
param(
    [ValidateNotNullOrEmpty()]
    [string]$Program = 'habits.exe',

    [switch]$TempOnly
)

$ErrorActionPreference = 'Stop'

function Test-Elevated {
    $identity = [Security.Principal.WindowsIdentity]::GetCurrent()
    $principal = New-Object Security.Principal.WindowsPrincipal($identity)
    return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

if (-not (Test-Elevated)) {
    Write-Warning 'Zum Entfernen von Firewallregeln werden Administratorrechte benötigt.'
    Write-Warning 'Bitte PowerShell als Administrator starten und das Skript erneut ausführen.'
    return
}

Write-Host "Suche Firewallregeln für '$Program' ..."

$tempRoot = [System.IO.Path]::GetTempPath()

# Der Umweg über den Anwendungsfilter ist nötig, weil eine Regel den Programmpfad
# nicht selbst trägt: Get-NetFirewallRule kennt Name und Richtung, der Pfad hängt
# am zugehörigen Filterobjekt.
$found = @(
    Get-NetFirewallApplicationFilter -ErrorAction SilentlyContinue |
        Where-Object { $_.Program -like "*\$Program" } |
        ForEach-Object {
            $rule = $_ | Get-NetFirewallRule -ErrorAction SilentlyContinue
            if ($rule) {
                [pscustomobject]@{
                    Name      = $rule.Name
                    Direction = $rule.Direction
                    Action    = $rule.Action
                    Path      = $_.Program
                    IsTemp    = $_.Program -like "$tempRoot*"
                }
            }
        }
)

if ($found.Count -eq 0) {
    Write-Host "Keine Regeln für '$Program' gefunden." -ForegroundColor Green
    return
}

$temp = @($found | Where-Object { $_.IsTemp })
$other = @($found | Where-Object { -not $_.IsTemp })

Write-Host ''
Write-Host ("Gefunden: {0} Regel(n) - {1} aus dem Temp-Verzeichnis, {2} von anderen Pfaden." -f $found.Count, $temp.Count, $other.Count)

if ($other.Count -gt 0) {
    Write-Host ''
    Write-Host 'Pfade ausserhalb von Temp:'
    $other | Select-Object -ExpandProperty Path -Unique | ForEach-Object { Write-Host "  $_" }
}

$targets = if ($TempOnly) { $temp } else { $found }

if ($targets.Count -eq 0) {
    Write-Host ''
    Write-Host 'Nichts zu entfernen.' -ForegroundColor Green
    return
}

Write-Host ''
if ($PSCmdlet.ShouldProcess(("{0} Firewallregel(n) für {1}" -f $targets.Count, $Program), 'Entfernen')) {
    $removed = 0
    $failed = 0

    foreach ($target in $targets) {
        try {
            Remove-NetFirewallRule -Name $target.Name -ErrorAction Stop
            $removed++
        } catch {
            $failed++
            Write-Warning ("Regel '{0}' ({1}) konnte nicht entfernt werden: {2}" -f $target.Name, $target.Path, $_.Exception.Message)
        }
    }

    Write-Host ''
    Write-Host ("Entfernt: {0}" -f $removed) -ForegroundColor Green
    if ($failed -gt 0) {
        Write-Host ("Fehlgeschlagen: {0}" -f $failed) -ForegroundColor Yellow
    }
}
