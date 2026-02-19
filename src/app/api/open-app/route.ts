import { NextRequest } from "next/server";
import { exec } from "child_process";
import os from "os";

export const runtime = "nodejs";

// Builds a PowerShell command that searches both user and common Start Menu folders
// for a .lnk matching the display name, then launches it — no Store dependency.
function psSearch(displayName: string): string {
  const escaped = displayName.replace(/'/g, "''");
  return `powershell -Command "$n='${escaped}';$dirs=@([Environment]::GetFolderPath('StartMenu'),[Environment]::GetFolderPath('CommonStartMenu'));$lnk=$dirs|ForEach-Object{Get-ChildItem -Path $_ -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue}|Where-Object{$_.BaseName -like \\"*$n*\\"}|Select-Object -First 1;if($lnk){Start-Process $lnk.FullName}else{Start-Process '${escaped}'}"`;
}

// Known app name -> executable mappings per platform
const APP_COMMANDS: Record<string, Record<string, string>> = {
  // Windows - mix of traditional apps and UWP/Store apps
  win32: {
    // Traditional desktop apps
    chrome: 'start "" "chrome"',
    "google chrome": 'start "" "chrome"',
    firefox: 'start "" "firefox"',
    edge: 'start "" "msedge"',
    notepad: 'start "" "notepad"',
    calculator: 'start "" "calc"',
    calc: 'start "" "calc"',
    paint: 'start "" "mspaint"',
    explorer: 'start "" "explorer"',
    "file explorer": 'start "" "explorer"',
    cmd: 'start "" "cmd"',
    terminal: 'start "" "wt"',
    "windows terminal": 'start "" "wt"',
    powershell: 'start "" "powershell"',
    "task manager": 'start "" "taskmgr"',
    snipping: 'start "" "snippingtool"',
    "snipping tool": 'start "" "SnippingTool"',
    word: 'start "" "winword"',
    excel: 'start "" "excel"',
    powerpoint: 'start "" "powerpnt"',
    outlook: 'start "" "outlook"',
    obs: 'start "" "obs64"',
    vlc: 'start "" "vlc"',
    brave: 'start "" "brave"',
    "brave browser": 'start "" "brave"',
    vscode: 'start "" "code"',
    "visual studio code": 'start "" "code"',
    // Apps found via Start Menu path search (no Store dependency)
    spotify: psSearch("Spotify"),
    discord: psSearch("Discord"),
    steam: psSearch("Steam"),
    settings: 'start "" "ms-settings:"',
    "microsoft store": 'start "" "ms-windows-store:"',
    store: 'start "" "ms-windows-store:"',
    teams: psSearch("Microsoft Teams"),
    "microsoft teams": psSearch("Microsoft Teams"),
    xbox: psSearch("Xbox"),
    photos: psSearch("Photos"),
    mail: psSearch("Mail"),
    calendar: psSearch("Calendar"),
    "to do": psSearch("Microsoft To Do"),
    todo: psSearch("Microsoft To Do"),
    "microsoft to do": psSearch("Microsoft To Do"),
    slack: psSearch("Slack"),
    zoom: psSearch("Zoom"),
    telegram: psSearch("Telegram"),
    whatsapp: psSearch("WhatsApp"),
    figma: psSearch("Figma"),
    "epic games": psSearch("Epic Games Launcher"),
    epic: psSearch("Epic Games Launcher"),
    blender: psSearch("Blender"),
    gimp: psSearch("GIMP"),
    audacity: psSearch("Audacity"),
  },
  // macOS
  darwin: {
    chrome: "open -a 'Google Chrome'",
    "google chrome": "open -a 'Google Chrome'",
    firefox: "open -a Firefox",
    safari: "open -a Safari",
    notepad: "open -a TextEdit",
    textedit: "open -a TextEdit",
    calculator: "open -a Calculator",
    finder: "open -a Finder",
    terminal: "open -a Terminal",
    settings: "open -a 'System Preferences'",
    spotify: "open -a Spotify",
    discord: "open -a Discord",
    vscode: "open -a 'Visual Studio Code'",
    "visual studio code": "open -a 'Visual Studio Code'",
  },
  // Linux
  linux: {
    chrome: "google-chrome",
    "google chrome": "google-chrome",
    firefox: "firefox",
    notepad: "gedit",
    calculator: "gnome-calculator",
    explorer: "nautilus",
    "file explorer": "nautilus",
    terminal: "gnome-terminal",
    settings: "gnome-control-center",
    spotify: "spotify",
    discord: "discord",
    vscode: "code",
    "visual studio code": "code",
  },
};

export async function POST(req: NextRequest) {
  try {
    const { app } = await req.json();
    if (!app || typeof app !== "string") {
      return Response.json({ error: "app name required" }, { status: 400 });
    }

    const platform = os.platform(); // win32, darwin, linux
    const platformApps = APP_COMMANDS[platform];
    if (!platformApps) {
      return Response.json({ error: `Unsupported platform: ${platform}` }, { status: 400 });
    }

    const appName = app.toLowerCase().trim();
    const command = platformApps[appName];

    if (!command) {
      // Try to open ANY app directly - no whitelist restrictions
      const safeApp = appName.replace(/[^a-zA-Z0-9 _.-]/g, "");
      if (!safeApp) {
        return Response.json({ error: `Invalid app name: "${app}"` }, { status: 400 });
      }

      if (platform === "win32") {
        // Windows: Try multiple methods in sequence
        // 1. Direct exe name (fastest, works for apps on PATH)
        // 2. PowerShell Start Menu search (finds installed apps by display name without Store)
        // 3. explorer shell:AppsFolder search (UWP fallback)
        return new Promise<Response>((resolve) => {
          // First try direct exe name
          const exeCommand = `start "" "${safeApp}"`;
          exec(exeCommand, { timeout: 5000 }, (err1) => {
            if (!err1) {
              resolve(Response.json({ success: true, app: safeApp, platform, command: exeCommand, method: "exe" }));
              return;
            }
            // Exe failed — search Start Menu shortcuts (.lnk) by display name
            const psCommand = `powershell -Command "$name = '${safeApp}'; $dirs = @([Environment]::GetFolderPath('StartMenu'), [Environment]::GetFolderPath('CommonStartMenu')); $lnk = $dirs | ForEach-Object { Get-ChildItem -Path $_ -Recurse -Filter '*.lnk' -ErrorAction SilentlyContinue } | Where-Object { $_.BaseName -like \\"*$name*\\" } | Select-Object -First 1; if ($lnk) { Start-Process $lnk.FullName } else { Start-Process '${safeApp}' }"`;
            exec(psCommand, { timeout: 10000 }, (err2) => {
              if (!err2) {
                resolve(Response.json({ success: true, app: safeApp, platform, command: psCommand, method: "startmenu" }));
              } else {
                resolve(Response.json({
                  error: `Could not open "${app}". Tried direct launch and Start Menu search.`,
                }, { status: 400 }));
              }
            });
          });
        });
      } else if (platform === "darwin") {
        const directCommand = `open -a "${safeApp}"`;
        return new Promise<Response>((resolve) => {
          exec(directCommand, { timeout: 10000 }, (err) => {
            if (err) {
              resolve(Response.json({ error: `Could not open "${app}": ${err.message}` }, { status: 400 }));
            } else {
              resolve(Response.json({ success: true, app: safeApp, platform, command: directCommand }));
            }
          });
        });
      } else {
        // Linux: just run the command
        return new Promise<Response>((resolve) => {
          exec(safeApp, { timeout: 10000 }, (err) => {
            if (err) {
              resolve(Response.json({ error: `Could not open "${app}": ${err.message}` }, { status: 400 }));
            } else {
              resolve(Response.json({ success: true, app: safeApp, platform, command: safeApp }));
            }
          });
        });
      }
    }

    return new Promise<Response>((resolve) => {
      exec(command, { timeout: 5000 }, (err) => {
        if (err) {
          resolve(Response.json({ error: `Failed to open ${app}: ${err.message}` }, { status: 500 }));
        } else {
          resolve(Response.json({ success: true, app: appName, command, platform }));
        }
      });
    });
  } catch (err) {
    return Response.json({
      error: err instanceof Error ? err.message : "Failed to open app",
    }, { status: 500 });
  }
}
