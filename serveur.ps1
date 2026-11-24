# Petit serveur web local pour D-50 Editor (aucune installation requise)
# Usage : clic droit > Exécuter avec PowerShell, ou : powershell -ExecutionPolicy Bypass -File serveur.ps1
param([int]$Port = 8050, [switch]$NoBrowser)

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$types = @{ '.html'='text/html; charset=utf-8'; '.js'='text/javascript; charset=utf-8'; '.css'='text/css; charset=utf-8';
            '.svg'='image/svg+xml'; '.png'='image/png'; '.webmanifest'='application/manifest+json'; '.json'='application/json';
            '.syx'='application/octet-stream'; '.md'='text/plain; charset=utf-8' }

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "D-50 Editor : http://localhost:$Port/   (Ctrl+C pour arreter)"
if (-not $NoBrowser) { Start-Process "http://localhost:$Port/" }

try {
  while ($listener.IsListening) {
    $ctx = $listener.GetContext()
    try {
      $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath.TrimStart('/'))
      if ($path -eq '') { $path = 'index.html' }
      $file = [IO.Path]::GetFullPath((Join-Path $root $path))
      if ($file.StartsWith($root) -and (Test-Path $file -PathType Leaf)) {
        $bytes = [IO.File]::ReadAllBytes($file)
        $ext = [IO.Path]::GetExtension($file).ToLower()
        $ctx.Response.ContentType = $(if ($types[$ext]) { $types[$ext] } else { 'application/octet-stream' })
        $ctx.Response.Headers.Add('Cache-Control', 'no-cache')
        $ctx.Response.ContentLength64 = $bytes.Length
        if ($ctx.Request.HttpMethod -ne 'HEAD') { $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length) }
      } else { $ctx.Response.StatusCode = 404 }
    } catch { Write-Host "Erreur: $($_.Exception.Message)" }
    finally { try { $ctx.Response.Close() } catch {} }
  }
} finally { $listener.Stop() }
