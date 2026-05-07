import { GoogleGenAI } from "@google/genai";
import { SYSTEM_PROMPT } from "./const.js";

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