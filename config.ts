export const CONFIG = {
  // Get this from Google Cloud Console (YouTube Data API v3)
  YOUTUBE_API_KEY: (import.meta as any).env?.VITE_YOUTUBE_API_KEY || '',
  
  // Get this from Google AI Studio
  GEMINI_API_KEY: (import.meta as any).env?.VITE_GEMINI_API_KEY || '',
  
  // Optional: Cors Proxy for web streams if needed
  CORS_PROXY: 'https://cors-anywhere.herokuapp.com/'
};