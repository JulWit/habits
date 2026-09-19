<#
.SYNOPSIS
    Removes Windows firewall rules pointing at habits.exe.

.DESCRIPTION
    `go run` compiles into a fresh temp directory on every start
    (...\Temp\go-buildNNNNNNNN\b001\exe\habits.exe). Firewall rules apply per
    program path, so Windows creates a new one on every start - after a few
    dozen restarts there are as many of them in the list, most pointing at paths
    that no longer exist or never will again.

    The script finds every rule whose program ends in the given file name, shows
    them broken down by origin, and removes them.

.PARAMETER Program
    File name of the program. Default: habits.exe

.PARAMETER TempOnly
    Only remove rules whose program lives in the temp directory - that is, the
    throwaway builds from `go run`. Rules for a permanently installed habits.exe,
    or one built in the project, are left standing.

.EXAMPLE
    .\Remove-HabitsFirewallRules.ps1 -WhatIf

    Shows what would be removed without changing anything.

.EXAMPLE
    .\Remove-HabitsFirewallRules.ps1 -TempOnly

    Clears away only the rules of the temp builds.

.NOTES
    Changing firewall rules requires administrator rights. Without them the
    script stops rather than throwing one error per rule.

    The file is stored as UTF-8 with a BOM: Windows PowerShell 5.1 reads .ps1
    files without a BOM as ANSI and mangles every non-ASCII character.
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
    Write-Warning 'Removing firewall rules requires administrator rights.'
    Write-Warning 'Please start PowerShell as administrator and run the script again.'
    return
}

Write-Host "Searching for firewall rules for '$Program' ..."

$tempRoot = [System.IO.Path]::GetTempPath()

# The detour through the application filter is necessary because a rule does not
# carry the program path itself: Get-NetFirewallRule knows the name and the
# direction, the path hangs off the associated filter object.
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
    Write-Host "No rules found for '$Program'." -ForegroundColor Green
    return
}

$temp = @($found | Where-Object { $_.IsTemp })
$other = @($found | Where-Object { -not $_.IsTemp })

Write-Host ''
Write-Host ("Found: {0} rule(s) - {1} from the temp directory, {2} from other paths." -f $found.Count, $temp.Count, $other.Count)

if ($other.Count -gt 0) {
    Write-Host ''
    Write-Host 'Paths outside of temp:'
    $other | Select-Object -ExpandProperty Path -Unique | ForEach-Object { Write-Host "  $_" }
}

$targets = if ($TempOnly) { $temp } else { $found }

if ($targets.Count -eq 0) {
    Write-Host ''
    Write-Host 'Nothing to remove.' -ForegroundColor Green
    return
}

Write-Host ''
if ($PSCmdlet.ShouldProcess(("{0} firewall rule(s) for {1}" -f $targets.Count, $Program), 'Remove')) {
    $removed = 0
    $failed = 0

    foreach ($target in $targets) {
        try {
            Remove-NetFirewallRule -Name $target.Name -ErrorAction Stop
            $removed++
        } catch {
            $failed++
            Write-Warning ("Rule '{0}' ({1}) could not be removed: {2}" -f $target.Name, $target.Path, $_.Exception.Message)
        }
    }

    Write-Host ''
    Write-Host ("Removed: {0}" -f $removed) -ForegroundColor Green
    if ($failed -gt 0) {
        Write-Host ("Failed: {0}" -f $failed) -ForegroundColor Yellow
    }
}
