$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$projectRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$outputDirectory = Join-Path $projectRoot 'deployment'
$archivePath = [System.IO.Path]::GetFullPath((Join-Path $outputDirectory 'anhs-vote-dockhosting.zip'))
if (-not $archivePath.StartsWith($projectRoot + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw 'Deployment archive must stay inside the project directory.'
}

$relativeFiles = @(
    'Dockerfile', '.dockerignore', '.gitignore', 'README.md', 'package.json', 'package-lock.json',
    'scripts/check-dev-ports.js', 'scripts/package-dockhosting.ps1',
    'server/package.json', 'server/package-lock.json', 'server/.env.example',
    'server/scripts/start-production.js', 'server/scripts/diagnose.js',
    'web/package.json', 'web/package-lock.json', 'web/index.html', 'web/vite.config.js',
    'chain/target/idl/voting_system.json',
    'docs/DOCKHOSTING.md', 'docs/WINDOWS_TRANSFER.md'
)
$sourceDirectories = @('server/src', 'server/tests', 'web/src', 'web/public')
foreach ($directory in $sourceDirectories) {
    foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $projectRoot $directory) -Recurse -File)) {
        if ($file.Name -like '.env*' -or $file.Name -like '*.sqlite*' -or $file.Name -like '*-keypair.json' -or
            $file.Name -eq 'id.json' -or $file.Name -like '*.pem' -or $file.Name -like '*.key') {
            continue
        }
        $relativeFiles += $file.FullName.Substring($projectRoot.Length + 1).Replace('\', '/')
    }
}

New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$stream = [System.IO.File]::Open($archivePath, [System.IO.FileMode]::Create, [System.IO.FileAccess]::Write)
$archive = New-Object System.IO.Compression.ZipArchive($stream, [System.IO.Compression.ZipArchiveMode]::Create)
try {
    foreach ($relative in ($relativeFiles | Sort-Object -Unique)) {
        $sourcePath = Join-Path $projectRoot $relative
        if (-not (Test-Path -LiteralPath $sourcePath -PathType Leaf)) { throw "Missing deployment source: $relative" }
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile(
            $archive, $sourcePath, $relative, [System.IO.Compression.CompressionLevel]::Optimal
        ) | Out-Null
    }
} finally {
    $archive.Dispose()
    $stream.Dispose()
}
Write-Output "Deployment source archive: $archivePath"
Write-Output 'Private configuration, election data, wallet keys, and node_modules are excluded.'
