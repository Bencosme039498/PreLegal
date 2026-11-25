# Builds the PreLegal image and (re)starts the container at http://localhost:8000.
# Every start gets a fresh, empty database (PRELEGAL_DB_RESET=true; production keeps its
# database, see README "Deployment").
# Failures are detected through $LASTEXITCODE: with ErrorActionPreference "Stop", Windows
# PowerShell 5.1 turns docker's progress output on stderr into terminating errors.

$Image = "prelegal"
$Container = "prelegal"
$Port = if ($env:PRELEGAL_PORT) { $env:PRELEGAL_PORT } else { 8000 }  # override if 8000 is taken

Set-Location (Join-Path $PSScriptRoot "..")

docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Error "Docker is not running. Start Docker Desktop and try again."
    exit 1
}

Write-Host "Building image '$Image'..."
docker build -t $Image .
if ($LASTEXITCODE -ne 0) { Write-Error "docker build failed."; exit 1 }

docker rm -f $Container *> $null

# .env (e.g. OPENAI_API_KEY) is passed at run time, never baked into the image.
$envArgs = @("-e", "PRELEGAL_DB_RESET=true")
if (Test-Path ".env") { $envArgs += @("--env-file", ".env") }

Write-Host "Starting container '$Container'..."
docker run -d --name $Container -p "${Port}:8000" @envArgs $Image | Out-Null
if ($LASTEXITCODE -ne 0) {
    docker rm -f $Container *> $null
    Write-Error "Could not start the container. Is port $Port already in use? Set PRELEGAL_PORT to use another port."
    exit 1
}

for ($i = 0; $i -lt 30; $i++) {
    try {
        Invoke-RestMethod -Uri "http://localhost:$Port/api/health" -TimeoutSec 2 | Out-Null
        Write-Host "PreLegal is running at http://localhost:$Port"
        exit 0
    } catch {
        Start-Sleep -Seconds 1
    }
}

Write-Host "PreLegal did not become healthy within 30 seconds. Recent logs:"
docker logs --tail 50 $Container
exit 1
