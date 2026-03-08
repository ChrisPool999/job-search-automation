import { GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT } from "./const.js";

// The client gets the API key from the environment variable `GEMINI_API_KEY`.
const ai = new GoogleGenAI({});

export async function shouldIApply(jobInfo) {
  const contents = SYSTEM_PROMPT + " job description: " + jobInfo

  const response = await ai.models.generateContent({
    model: "gemini-3.1-flash-lite-preview",
    contents: contents,
    config: {
        responseMimeType: "application/json",
    }
  });
  return JSON.parse(response.text)
}