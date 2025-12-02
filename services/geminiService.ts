import { GoogleGenAI } from "@google/genai";

let aiClient: GoogleGenAI | null = null;

const getClient = (): GoogleGenAI => {
  if (!aiClient) {
    // The API key must be obtained exclusively from the environment variable process.env.API_KEY.
    // We assume this variable is pre-configured, valid, and accessible.
    aiClient = new GoogleGenAI({ apiKey: process.env.API_KEY });
  }
  return aiClient;
};

export const getTrackInsight = async (artist: string, title: string): Promise<string> => {
  try {
    const ai = getClient();
    const prompt = `Provide a short, engaging 2-sentence "Vibe Check" description for the song "${title}" by "${artist}". Focus on the musical style, mood, and cultural impact. Do not use markdown formatting.`;
    
    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    return response.text || "No insight available.";
  } catch (error) {
    console.error("Error fetching Gemini insight:", error);
    return "Could not retrieve AI insight at this time.";
  }
};