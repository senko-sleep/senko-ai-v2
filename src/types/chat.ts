export interface WebSource {
  url: string;
  title: string;
  favicon?: string;
  snippet?: string;
}

export interface MapEmbed {
  lat: number;
  lng: number;
  label?: string;
  zoom?: number;
}

export interface MessageImage {
  url: string;
  alt?: string;
}

export interface VideoEmbed {
  url: string;
  title?: string;
  platform: "youtube" | "other";
  embedId?: string;
}

export interface WebEmbed {
  url: string;
  title?: string;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "thinking";
  content: string;
  timestamp: Date;
  isEditing?: boolean;
  sources?: WebSource[];
  mapEmbed?: MapEmbed;
  images?: MessageImage[];
  videos?: VideoEmbed[];
  webEmbeds?: WebEmbed[];
  tokenCount?: number;
  isThinking?: boolean;
  error?: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

export interface BrowserInfo {
  userAgent: string;
  platform: string;
  language: string;
  cookiesEnabled: boolean;
  onLine: boolean;
  screenResolution: string;
  colorDepth: number;
  timezone: string;
  deviceMemory?: number;
  hardwareConcurrency: number;
}

export interface LocationInfo {
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  status: "granted" | "denied" | "prompt" | "unavailable";
  city?: string;
  region?: string;
  country?: string;
}

export interface PermissionStatus {
  name: string;
  state: "granted" | "denied" | "prompt";
}

export interface AppSettings {
  notifications: boolean;
  location: boolean;
  camera: boolean;
  microphone: boolean;
  clipboard: boolean;
  fontSize: "small" | "medium" | "large";
  sendWithEnter: boolean;
}
