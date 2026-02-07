
import { GoogleGenAI, GenerateContentResponse } from "@google/genai";

const API_KEY = process.env.API_KEY || "";

export const performOCR = async (base64Image: string): Promise<string> => {
  if (!API_KEY) {
    throw new Error("API Key is missing. Please ensure process.env.API_KEY is configured.");
  }

  const ai = new GoogleGenAI({ apiKey: API_KEY });
  const modelName = 'gemini-3-flash-preview';

  try {
    const imagePart = {
      inlineData: {
        mimeType: 'image/jpeg',
        data: base64Image.split(',')[1] || base64Image,
      },
    };

    const textPart = {
      text: `ACT AS AN ADVANCED MULTIMODAL OCR ENGINE.
      EXTRACT ALL CONTENT BLOCKS WITH 100% ACCURACY:
      1. TEXT: Extract all text verbatim, preserving paragraph structure.
      2. TABLES: Detect tables and recreate them as Markdown tables. Do not omit any cells.
      3. VISUAL ELEMENTS: Identify every diagram, illustration, or photo. Provide a highly detailed, technical description of each visual element inside [VISUAL BLOCK: description...]. Include text found within diagrams.
      4. LAYOUT: Maintain logical reading order.
      5. OUTPUT: Return ONLY the structured Markdown. No introduction or conclusion.`
    };

    const response: GenerateContentResponse = await ai.models.generateContent({
      model: modelName,
      contents: { parts: [imagePart, textPart] },
      config: {
        temperature: 0,
      }
    });

    if (!response.text) {
      throw new Error("Empty response from AI model.");
    }

    return response.text;
  } catch (error: any) {
    console.error("Gemini OCR API Error:", error);
    const message = error?.message || "Unknown API error";
    if (message.includes("403") || message.includes("API_KEY_INVALID")) {
      throw new Error("Invalid API Key. Authentication failed.");
    } else if (message.includes("429")) {
      throw new Error("Rate limit exceeded. Please wait a moment.");
    } else if (message.includes("fetch")) {
      throw new Error("Network error: Could not connect to Google Gemini API.");
    }
    throw new Error(`OCR Processing Failed: ${message}`);
  }
};

export const chatWithDocument = async (history: { role: string; parts: { text: string }[] }[], userPrompt: string, documentContext: string) => {
  const ai = new GoogleGenAI({ apiKey: API_KEY });
  
  const systemInstruction = `You are an AI document analysis expert. 
  CONTEXT:
  ${documentContext}
  
  Use the provided text, tables, and visual block descriptions to answer the user's questions precisely. If info isn't there, say so.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3-flash-preview',
    contents: [
      ...history,
      { role: 'user', parts: [{ text: userPrompt }] }
    ],
    config: {
      systemInstruction,
    },
  });

  return response.text || "I'm sorry, I couldn't generate a response.";
};
