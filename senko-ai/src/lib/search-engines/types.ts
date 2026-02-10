// Shared types for all search engine implementations

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface EngineResponse {
  results: SearchResult[];
  status: number;
  error?: string;
}
