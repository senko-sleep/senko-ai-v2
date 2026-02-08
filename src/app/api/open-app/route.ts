import { NextRequest } from "next/server";
import { exec } from "child_process";
import os from "os";

export const runtime = "nodejs";

// Whitelist of safe app names -> commands per platform
const APP_COMMANDS: Record<string, Record<string, string>> = {
  // Windows
  win32: {
    chrome: "start chrome",
    "google chrome": "start chrome",
    firefox: "start firefox",
    edge: "start msedge",
    notepad: "start notepad",
    calculator: "start calc",
    calc: "start calc",
    paint: "start mspaint",
    explorer: "start explorer",
    "file explorer": "start explorer",
    cmd: "start cmd",
    terminal: "start wt",
    "windows terminal": "start wt",
    powershell: "start powershell",
    settings: "start ms-settings:",
    spotify: "start spotify:",
    discord: "start discord:",
    steam: "start steam:",
    vscode: "start code",
    "visual studio code": "start code",
    "task manager": "start taskmgr",
    snipping: "start snippingtool",
    "snipping tool": "start snippingtool",
    word: "start winword",
    excel: "start excel",
    powerpoint: "start powerpnt",
    outlook: "start outlook",
    teams: "start msteams:",
    "microsoft teams": "start msteams:",
    obs: "start obs64",
    vlc: "start vlc",
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
      // Try to open it directly as a best-effort on Windows
      if (platform === "win32") {
        const safeApp = appName.replace(/[^a-zA-Z0-9 _-]/g, "");
        if (!safeApp) {
          return Response.json({
            error: `Unknown app: "${app}". Available: ${Object.keys(platformApps).join(", ")}`,
          }, { status: 400 });
        }

        return new Promise<Response>((resolve) => {
          exec(`start ${safeApp}`, { timeout: 5000 }, (err) => {
            if (err) {
              resolve(Response.json({
                error: `Could not open "${app}". Available: ${Object.keys(platformApps).join(", ")}`,
              }, { status: 400 }));
            } else {
              resolve(Response.json({ success: true, app: safeApp, platform }));
            }
          });
        });
      }

      return Response.json({
        error: `Unknown app: "${app}". Available: ${Object.keys(platformApps).join(", ")}`,
      }, { status: 400 });
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
