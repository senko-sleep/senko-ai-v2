"use client";

import { useEffect } from "react";
import {
  MapPin,
  Bell,
  Camera,
  Mic,
  Clipboard,
  Monitor,
  Globe,
  Cpu,
  HardDrive,
  Wifi,
  WifiOff,
  Shield,
  RefreshCw,
  Type,
  CornerDownLeft,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useBrowserInfo } from "@/hooks/use-browser-info";
import { useLocation } from "@/hooks/use-location";
import { usePermissions } from "@/hooks/use-permissions";
import type { AppSettings } from "@/types/chat";

interface SettingsPanelProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
}

function getDeviceType(userAgent: string): string {
  if (/tablet|ipad/i.test(userAgent)) return "Tablet";
  if (/mobile|iphone|android/i.test(userAgent)) return "Mobile";
  return "Desktop";
}

function getBrowserName(userAgent: string): string {
  if (userAgent.includes("Firefox")) return "Firefox";
  if (userAgent.includes("Edg")) return "Edge";
  if (userAgent.includes("Chrome")) return "Chrome";
  if (userAgent.includes("Safari")) return "Safari";
  return "Unknown";
}

function getOSName(platform: string): string {
  if (platform.startsWith("Win")) return "Windows";
  if (platform.startsWith("Mac")) return "macOS";
  if (platform.startsWith("Linux")) return "Linux";
  if (/iphone|ipad/i.test(platform)) return "iOS";
  if (/android/i.test(platform)) return "Android";
  return platform;
}

const permissionIcons: Record<string, React.ReactNode> = {
  geolocation: <MapPin className="h-3.5 w-3.5" />,
  notifications: <Bell className="h-3.5 w-3.5" />,
  camera: <Camera className="h-3.5 w-3.5" />,
  microphone: <Mic className="h-3.5 w-3.5" />,
  "clipboard-read": <Clipboard className="h-3.5 w-3.5" />,
  "clipboard-write": <Clipboard className="h-3.5 w-3.5" />,
};

const permissionLabels: Record<string, string> = {
  geolocation: "Location",
  notifications: "Notifications",
  camera: "Camera",
  microphone: "Microphone",
  "clipboard-read": "Clipboard Read",
  "clipboard-write": "Clipboard Write",
};

function StateIndicator({ state }: { state: string }) {
  const colors: Record<string, string> = {
    granted: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
    denied: "bg-red-500/20 text-red-400 border-red-500/30",
    prompt: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  };
  return (
    <Badge
      variant="outline"
      className={`rounded-md px-1.5 py-0 text-[10px] font-medium ${colors[state] || colors.prompt}`}
    >
      {state}
    </Badge>
  );
}

export function SettingsPanel({
  settings,
  onSettingsChange,
}: SettingsPanelProps) {
  const browserInfo = useBrowserInfo();
  const { location, loading: locationLoading, requestLocation } = useLocation();
  const { permissions, requestPermission, refreshPermissions } = usePermissions();

  useEffect(() => {
    refreshPermissions();
  }, [refreshPermissions]);

  const updateSetting = <K extends keyof AppSettings>(
    key: K,
    value: AppSettings[K]
  ) => {
    onSettingsChange({ ...settings, [key]: value });
  };

  return (
    <div className="scrollbar-thin h-full overflow-y-auto">
      <div className="space-y-4 px-3 py-3">
        {/* Device Info */}
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            <Monitor className="h-3.5 w-3.5" />
            Device Info
          </h3>
          <div className="glass-panel rounded-xl p-3 space-y-2">
            {browserInfo ? (
              <>
                <InfoRow
                  icon={<Monitor className="h-3 w-3" />}
                  label="Device"
                  value={getDeviceType(browserInfo.userAgent)}
                />
                <InfoRow
                  icon={<Globe className="h-3 w-3" />}
                  label="Browser"
                  value={getBrowserName(browserInfo.userAgent)}
                />
                <InfoRow
                  icon={<Cpu className="h-3 w-3" />}
                  label="OS"
                  value={getOSName(browserInfo.platform)}
                />
                <InfoRow
                  icon={<HardDrive className="h-3 w-3" />}
                  label="Screen"
                  value={browserInfo.screenResolution}
                />
                <InfoRow
                  icon={<Cpu className="h-3 w-3" />}
                  label="CPU Cores"
                  value={String(browserInfo.hardwareConcurrency)}
                />
                {browserInfo.deviceMemory && (
                  <InfoRow
                    icon={<HardDrive className="h-3 w-3" />}
                    label="Memory"
                    value={`${browserInfo.deviceMemory} GB`}
                  />
                )}
                <InfoRow
                  icon={<Globe className="h-3 w-3" />}
                  label="Language"
                  value={browserInfo.language}
                />
                <InfoRow
                  icon={<Globe className="h-3 w-3" />}
                  label="Timezone"
                  value={browserInfo.timezone}
                />
                <div className="flex items-center gap-1.5 text-xs">
                  {browserInfo.onLine ? (
                    <Wifi className="h-3 w-3 text-emerald-400" />
                  ) : (
                    <WifiOff className="h-3 w-3 text-red-400" />
                  )}
                  <span className="text-zinc-500">Status</span>
                  <span
                    className={
                      browserInfo.onLine ? "text-emerald-400" : "text-red-400"
                    }
                  >
                    {browserInfo.onLine ? "Online" : "Offline"}
                  </span>
                </div>
              </>
            ) : (
              <p className="text-xs text-zinc-600">Loading device info...</p>
            )}
          </div>
        </section>

        <Separator className="bg-white/[0.06]" />

        {/* Location */}
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            <MapPin className="h-3.5 w-3.5" />
            Location
          </h3>
          <div className="glass-panel rounded-xl p-3 space-y-2">
            {location.status === "granted" && location.latitude !== null ? (
              <>
                <InfoRow
                  icon={<MapPin className="h-3 w-3" />}
                  label="Latitude"
                  value={location.latitude.toFixed(4)}
                />
                <InfoRow
                  icon={<MapPin className="h-3 w-3" />}
                  label="Longitude"
                  value={location.longitude!.toFixed(4)}
                />
                {location.accuracy !== null && (
                  <InfoRow
                    icon={<MapPin className="h-3 w-3" />}
                    label="Accuracy"
                    value={`${Math.round(location.accuracy)}m`}
                  />
                )}
              </>
            ) : location.status === "denied" ? (
              <p className="text-xs text-red-400">
                Location access denied. Enable in browser settings.
              </p>
            ) : (
              <p className="text-xs text-zinc-500">
                Location not yet requested.
              </p>
            )}
            <Button
              size="sm"
              onClick={requestLocation}
              disabled={locationLoading}
              className="mt-1 h-7 w-full gap-1.5 rounded-lg bg-[#a78bfa]/15 text-xs text-[#c4b5fd] hover:bg-[#a78bfa]/25"
            >
              <MapPin className="h-3 w-3" />
              {locationLoading
                ? "Requesting..."
                : location.status === "granted"
                  ? "Refresh Location"
                  : "Request Location"}
            </Button>
          </div>
        </section>

        <Separator className="bg-white/[0.06]" />

        {/* Browser Permissions */}
        <section>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
              <Shield className="h-3.5 w-3.5" />
              Permissions
            </h3>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => refreshPermissions()}
              className="h-6 w-6 rounded-md p-0 text-zinc-600 hover:bg-white/5 hover:text-zinc-400"
            >
              <RefreshCw className="h-3 w-3" />
            </Button>
          </div>
          <div className="glass-panel rounded-xl p-3 space-y-2">
            {permissions.map((perm) => (
              <div
                key={perm.name}
                className="flex items-center justify-between"
              >
                <div className="flex items-center gap-2 text-xs text-zinc-400">
                  {permissionIcons[perm.name]}
                  <span>{permissionLabels[perm.name] || perm.name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <StateIndicator state={perm.state} />
                  {perm.state === "prompt" && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => requestPermission(perm.name)}
                      className="h-5 rounded px-1.5 text-[10px] text-[#a78bfa] hover:bg-[#a78bfa]/10"
                    >
                      Request
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>

        <Separator className="bg-white/[0.06]" />

        {/* App Settings */}
        <section>
          <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            <Type className="h-3.5 w-3.5" />
            Preferences
          </h3>
          <div className="glass-panel rounded-xl p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs text-zinc-400">
                <CornerDownLeft className="h-3 w-3" />
                <span>Send with Enter</span>
              </div>
              <Switch
                checked={settings.sendWithEnter}
                onCheckedChange={(v) => updateSetting("sendWithEnter", v)}
                className="scale-75"
              />
            </div>
            <div className="space-y-1.5">
              <span className="flex items-center gap-2 text-xs text-zinc-400">
                <Type className="h-3 w-3" />
                Font Size
              </span>
              <div className="flex gap-1">
                {(["small", "medium", "large"] as const).map((size) => (
                  <Button
                    key={size}
                    size="sm"
                    variant="ghost"
                    onClick={() => updateSetting("fontSize", size)}
                    className={`h-6 flex-1 rounded-md text-[10px] capitalize ${
                      settings.fontSize === size
                        ? "bg-[#a78bfa]/15 text-[#c4b5fd]"
                        : "text-zinc-500 hover:bg-white/5 hover:text-zinc-400"
                    }`}
                  >
                    {size}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="text-zinc-600">{icon}</span>
      <span className="text-zinc-500">{label}</span>
      <span className="ml-auto text-zinc-300">{value}</span>
    </div>
  );
}
