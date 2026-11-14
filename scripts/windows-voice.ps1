param([Parameter(Mandatory=$true)][string]$InputFile, [Parameter(Mandatory=$true)][string]$OutputFile)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Speech
$request = Get-Content -LiteralPath $InputFile -Raw -Encoding UTF8 | ConvertFrom-Json
$speaker = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
  $voices = @($speaker.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Culture.Name -like 'en-*' })
  $voice = $voices | Where-Object { $_.VoiceInfo.Gender -eq 'Female' } | Select-Object -First 1
  if (!$voice) { $voice = $voices | Select-Object -First 1 }
  if (!$voice) { throw 'No enabled English system voice is installed.' }
  $speaker.SelectVoice($voice.VoiceInfo.Name)
  $speaker.Rate = 0
  $speaker.SetOutputToWaveFile($OutputFile)
  $speaker.Speak([string]$request.text)
  $speaker.SetOutputToNull()
  [Console]::Out.Write($voice.VoiceInfo.Name)
} finally { $speaker.Dispose() }
