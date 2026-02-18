$path = "src\app\page.tsx"
$lines = [System.IO.File]::ReadAllLines($path)
$out = [System.Collections.Generic.List[string]]::new()
foreach ($line in $lines) {
    # Skip lines that are ONLY an addTab(...); call (with optional leading whitespace)
    if ($line -match '^\s*addTab\(') { continue }
    $out.Add($line)
}
[System.IO.File]::WriteAllLines($path, $out)
Write-Host "Done. Lines removed: $($lines.Count - $out.Count)"
