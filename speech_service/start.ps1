$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$python = 'C:\Users\48043\AppData\Local\Programs\Python\Python310\python.exe'
if (-not (Test-Path $python)) {
    throw "Python 3.10 was not found at $python. Update the `$python value in speech_service/start.ps1."
}

if (-not $env:TODO_SPEECH_DEVICE) {
    $env:TODO_SPEECH_DEVICE = 'cuda:0'
}
& $python (Join-Path $PSScriptRoot 'launcher.py')
