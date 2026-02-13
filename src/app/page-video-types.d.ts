// Global type declarations for video discovery system
declare global {
  interface Window {
    __senkoVideoLists?: Map<string, { 
      videos: Array<{ 
        url: string; 
        type?: string; 
        quality?: string; 
        poster?: string; 
        source?: string 
      }>; 
      sourceUrl: string; 
      title: string;
      timestamp: number;
    }>;
  }
}

export {};
