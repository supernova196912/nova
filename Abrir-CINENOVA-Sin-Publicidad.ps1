$ErrorActionPreference = 'Stop'

$siteUrl = 'http://127.0.0.1:8000/web/'
$pythonExe = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $pythonExe) {
    throw 'No encuentro Python en PATH. Instala Python o inicia server.py manualmente.'
}

$chromeCandidates = @(
    (Join-Path $env:ProgramFiles 'Google\Chrome\Application\chrome.exe'),
    (Join-Path ${env:ProgramFiles(x86)} 'Google\Chrome\Application\chrome.exe'),
    (Join-Path $env:LOCALAPPDATA 'Google\Chrome\Application\chrome.exe')
) | Where-Object { $_ -and (Test-Path -LiteralPath $_) }

if (-not $chromeCandidates) {
    throw 'No encuentro Google Chrome. Este lanzador necesita Chrome instalado.'
}
$chromeExe = $chromeCandidates | Select-Object -First 1

try {
    Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
} catch {
    Start-Process -FilePath $pythonExe -ArgumentList @('server.py', '--host', '127.0.0.1', '--port', '8000') -WorkingDirectory $PSScriptRoot -WindowStyle Hidden
    $ready = $false
    for ($attempt = 0; $attempt -lt 12; $attempt++) {
        Start-Sleep -Seconds 1
        try {
            Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 2 | Out-Null
            $ready = $true
            break
        } catch {}
    }
    if (-not $ready) { throw 'No se pudo iniciar la web local en el puerto 8000.' }
}

# Mismos dominios de publicidad que se filtran en la APK funcional.
$adDomains = @(
    'doubleclick.net', 'googlesyndication.com', 'googleadservices.com',
    'imasdk.googleapis.com', 'adnxs.com', 'popads.net', 'popcash.net',
    'exoclick.com', 'juicyads.com', 'adsterra.com', 'highperformanceformat.com',
    'monetag.com', 'onclickalgo.com', 'acscdn.com', 'taboola.com', 'outbrain.com',
    'mgid.com', 'adform.net', 'adsrvr.org', 'rubiconproject.com', 'pubmatic.com',
    'openx.net', 'criteo.com', 'smartadserver.com', 'propellerads.com', 'clickadu.com',
    'evadav.com', 'trafficstars.com', 'hilltopads.com', 'googletagservices.com',
    'adservice.google.com', 'adskeeper.com', 'adkernel.com', 'bashirian.biz',
    '21wiz.com', 'morencius.com', 'servetraff.com'
)

$resolverRules = @('MAP localhost 127.0.0.1')
foreach ($domain in $adDomains) {
    $resolverRules += "MAP $domain 0.0.0.0"
    $resolverRules += "MAP *.$domain 0.0.0.0"
}
$resolverRules = $resolverRules -join ','

# Usa un perfil independiente para no cambiar el Chrome habitual ni sus extensiones.
$profileDir = Join-Path $env:LOCALAPPDATA 'CINENOVA\ChromeSinPublicidad'
$chromeArgs = @(
    '--no-first-run',
    '--new-window',
    "--user-data-dir=`"$profileDir`"",
    "--host-resolver-rules=`"$resolverRules`"",
    $siteUrl
)
Start-Process -FilePath $chromeExe -ArgumentList $chromeArgs
