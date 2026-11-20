import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';
import nodeFetch from 'node-fetch';
dotenv.config(); // Load environment variables from .env file

// Set fetch for environments where it might not be globally available
if (!globalThis.fetch) {
    console.log("Setting up fetch polyfill for older Node.js versions");
    globalThis.fetch = nodeFetch;
}

// Environment configuration
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const USE_MOCK = process.env.USE_MOCK_RESPONSES === 'false';
const MAX_RETRIES = parseInt(process.env.MAX_RETRIES || '2');

if (!GEMINI_API_KEY && !USE_MOCK) {
    console.error("FATAL ERROR: GEMINI_API_KEY is not set in your .env file.");
    console.error("Set GEMINI_API_KEY or enable USE_MOCK_RESPONSES=true for development.");
    process.exit(1); // Exit if API key is missing and not using mock
}

// Initialize Gemini client
let genAI;
let model;

if (!USE_MOCK) {
    try {
        genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
        model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        console.log("Gemini API client initialized successfully");
    } catch (error) {
        console.error("Error initializing Gemini API client:", error);
    }
}

/**
 * Generates a mock response for development and testing
 * @param {string} prompt The original prompt
 * @returns {string} A mock response
 */
function generateMockResponse(prompt) {
    console.log("Using mock response generator instead of actual Gemini API");
    
    // Check if this is a recommendation request
    if (prompt.includes("recommendations")) {
        return JSON.stringify({
            lca_summary: "This is a mock summary for development. The process appears to have moderate environmental impacts based on the provided data, with opportunities for improvement in energy efficiency and resource utilization.",
            recommendations: [
                "Consider increasing recycled material input to reduce primary resource extraction impacts",
                "Implement renewable energy sources to decrease carbon footprint in processing operations",
                "Optimize transportation logistics to minimize fuel consumption and emissions",
                "Improve water recycling systems to reduce freshwater consumption in processing",
                "Invest in more efficient processing technology to increase recovery rates and reduce waste"
            ]
        }, null, 2);
    } 
    // If it's a parameter suggestion request
    else if (prompt.includes("suggestions")) {
        return JSON.stringify({
            "energyConsumptionMining": 4500,
            "waterConsumptionMining": 3200,
            "oreGrade": 0.8,
            "recycledInputRate": 15,
            "globalWarmingPotential": 2800
        }, null, 2);
    }
    
    // Generic fallback
    return JSON.stringify({
        message: "This is a mock response for development",
        timestamp: new Date().toISOString()
    });
}

/**
 * Sends a prompt to the Gemini AI model with retry logic and returns the text response.
 * @param {string} prompt The prompt string to send to Gemini.
 * @returns {Promise<string>} The raw text response from Gemini.
 */
async function getGeminiResponse(prompt) {
    // If mock mode is enabled, return a mock response
    if (USE_MOCK) {
        return generateMockResponse(prompt);
    }
    
    let lastError = null;
    
    // Implement retry logic
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
            console.log(`Gemini API attempt ${attempt + 1} of ${MAX_RETRIES}`);
            
            // Add timeout to the Gemini request
            const timeoutMs = 15000; // 15 second timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
            
            const result = await model.generateContent({
                contents: [{ role: "user", parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.2,
                    topK: 40,
                    topP: 0.95,
                    maxOutputTokens: 4096,
                }
            });
            
            clearTimeout(timeoutId);
            const response = await result.response;
            console.log("Gemini API call successful");
            return response.text();
        } catch (error) {
            lastError = error;
            console.error(`Gemini API attempt ${attempt + 1} failed:`, error);
            
            // If we have retries left, wait before trying again
            if (attempt < MAX_RETRIES - 1) {
                const delayMs = Math.pow(2, attempt) * 1000; // Exponential backoff
                console.log(`Waiting ${delayMs}ms before retry...`);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }
    
    console.error("All Gemini API attempts failed, using fallback response");
    
    // After all retries fail, use fallback response
    if (prompt.includes("recommendations")) {
        return JSON.stringify({
            lca_summary: "Unable to analyze with AI at this time. Based on the data provided, this appears to be a metallurgical process with potential environmental impacts.",
            recommendations: [
                "Consider reviewing energy consumption patterns",
                "Evaluate water usage efficiency in processing operations",
                "Look into recycled material input opportunities",
                "Assess transportation efficiency in your supply chain",
                "Please try again later for a more detailed analysis"
            ]
        });
    } else {
        return JSON.stringify({
            message: "Fallback response due to API connectivity issues",
            error: lastError?.message || "Unknown error"
        });
    }
}

export default getGeminiResponse;