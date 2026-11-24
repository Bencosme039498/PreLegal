# Stops and removes the PreLegal container (its temporary database goes with it).
$Container = "prelegal"

docker rm -f $Container *> $null
if ($LASTEXITCODE -eq 0) {
    Write-Host "PreLegal stopped."
} else {
    Write-Host "PreLegal is not running."
}
