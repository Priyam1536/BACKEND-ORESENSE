// src/controllers/lcaController.js

import getGeminiResponse from '../services/geminiService.js';
import Report from '../models/Report.js';

const GEMINI_ONLY_PREDICT = process.env.GEMINI_ONLY_PREDICT === 'true';
const SUGGESTION_CACHE_TTL_MS = Number(process.env.SUGGESTION_CACHE_TTL_MS || 10 * 60 * 1000); // 10 min
const SUGGESTION_THROTTLE_MS = Number(process.env.SUGGESTION_THROTTLE_MS || 5000); // 5 sec

// Allowed fields for AI suggestions (camelCase to match frontend)
const SUGGESTION_FIELDS = [
    'oreGrade',
    'productionVolume',
    'energyConsumptionMining',
    'energyTypeMining',
    'waterConsumptionMining',
    'emissionsMining',
    'emissionsTypeMining',
    'landUse',
    'transportToProcessing',
    'transportDistanceToProcessing',
    'energySource',
    'energyConsumptionProcessing',
    'processingRoute',
    'recycledInputRate',
    'recoveryRate',
    'transportDistances',
    'transportMode',
    'productLifetime',
    'reuseRate',
    'recyclingRate',
    'recyclingEfficiency',
    'disposalRoute',
    'transportDisposal',
    'globalWarmingPotential',
    'acidificationPotential',
    'eutrophicationPotential',
    'ozoneDepletionPotential',
    'waterScarcityFootprint',
    'cumulativeEnergyDemand'
];

const SUGGESTION_FIELD_HINTS = {
    oreGrade: 'Ore Grade (%)',
    productionVolume: 'Production Volume (tonnes)',
    energyConsumptionMining: 'Energy Consumption (MJ/tonne ore)',
    energyTypeMining: 'Energy Type (diesel, electricity, natural_gas, mixed)',
    waterConsumptionMining: 'Water Consumption (m3/tonne ore)',
    emissionsMining: 'Emissions (kg CO2-eq/tonne ore)',
    emissionsTypeMining: 'Emissions Type (dust, particulates, methane, mixed)',
    landUse: 'Land Use (m2/tonne ore)',
    transportToProcessing: 'Transport to Processing (truck, rail, ship, mixed)',
    transportDistanceToProcessing: 'Transport Distance (km)',
    energySource: 'Energy Source (grid, coal, natural_gas, renewables, mixed)',
    energyConsumptionProcessing: 'Energy Consumption (MJ/tonne)',
    processingRoute: 'Processing Route (primary, secondary, mixed)',
    recycledInputRate: 'Recycled Input Rate (%)',
    recoveryRate: 'Recovery Rate (%)',
    transportDistances: 'Transport Distances (km)',
    transportMode: 'Transport Mode (truck, rail, ship, air, mixed)',
    productLifetime: 'Expected Product Lifetime (years)',
    reuseRate: 'Reuse / Repurposing Rate (%)',
    recyclingRate: 'Recycling Rate (%)',
    recyclingEfficiency: 'Recycling Efficiency (%)',
    disposalRoute: 'Disposal Route (landfill, incineration, special_waste, mixed)',
    transportDisposal: 'Transport for Disposal (km)',
    globalWarmingPotential: 'Global Warming Potential (kg CO2-eq)',
    acidificationPotential: 'Acidification Potential (kg SO2-eq)',
    eutrophicationPotential: 'Eutrophication Potential (kg PO4-eq)',
    ozoneDepletionPotential: 'Ozone Depletion Potential (kg CFC-11-eq)',
    waterScarcityFootprint: 'Water Scarcity Footprint (m3-eq)',
    cumulativeEnergyDemand: 'Cumulative Energy Demand (MJ)'
};

const DEFAULT_SUGGESTIONS = {
    energyConsumptionMining: 5000,
    waterConsumptionMining: 2000,
    oreGrade: 0.5,
    recycledInputRate: 10,
    recoveryRate: 85,
    transportDistanceToProcessing: 120,
    transportDistances: 800,
    productLifetime: 20,
    recyclingRate: 40,
    recyclingEfficiency: 80
};

const SELECT_FIELD_OPTIONS = {
    energyTypeMining: ['diesel', 'electricity', 'natural_gas', 'mixed'],
    emissionsTypeMining: ['dust', 'particulates', 'methane', 'mixed'],
    transportToProcessing: ['truck', 'rail', 'ship', 'mixed'],
    energySource: ['grid', 'coal', 'natural_gas', 'renewables', 'mixed'],
    processingRoute: ['primary', 'secondary', 'mixed'],
    transportMode: ['truck', 'rail', 'ship', 'air', 'mixed'],
    disposalRoute: ['landfill', 'incineration', 'special_waste', 'mixed']
};

const SUGGESTION_FIELDS_SET = new Set(SUGGESTION_FIELDS);
const suggestionCache = new Map();
const lastRequestByIp = new Map();

function isMissingValue(value) {
    return value === undefined || value === null || value === '';
}

function normalizeSuggestionKey(key) {
    if (!key || typeof key !== 'string') return key;
    const trimmed = key.trim();
    return trimmed.replace(/[_-]([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
}

function normalizeSuggestionValue(field, value) {
    if (SELECT_FIELD_OPTIONS[field]) {
        if (typeof value !== 'string') return undefined;
        const normalized = value.trim().toLowerCase().replace(/\s+/g, '_').replace(/-+/g, '_');
        const options = SELECT_FIELD_OPTIONS[field];
        if (options.includes(normalized)) return normalized;
        return undefined;
    }

    if (value === undefined || value === null) return undefined;
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : undefined;
    }
    if (typeof value === 'string') {
        const trimmed = value.trim();
        if (!trimmed) return undefined;
        const direct = Number(trimmed);
        if (Number.isFinite(direct)) return direct;
        const match = trimmed.match(/-?\d+(\.\d+)?/);
        if (match) {
            const parsed = Number(match[0]);
            return Number.isFinite(parsed) ? parsed : undefined;
        }
    }
    return undefined;
}

function stableStringify(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) {
        return `[${value.map(stableStringify).join(',')}]`;
    }
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function buildSuggestionCacheKey(data, missingFields) {
    const payload = {
        missingFields: [...missingFields].sort(),
        data
    };
    return stableStringify(payload);
}

/**
 * Helper function to clean Gemini response by removing markdown code block syntax
 * @param {string} response - Raw response from Gemini
 * @returns {string} Cleaned response
 */
function cleanGeminiResponse(response) {
    // Remove markdown code block syntax if present
    return response.replace(/```(json|javascript)?\n?/g, '').trim();
}

/**
 * Generates fallback response when parsing fails
 * @param {string} type - Type of response to generate
 * @param {object} data - Input data for context
 * @returns {object} Fallback response object
 */
function generateFallbackResponse(type, data = {}) {
    if (type === 'recommendations') {
        const metalType = data.metalType || 'metal';
        
        return {
            lca_summary: `This is a fallback analysis for ${metalType} production. Due to technical limitations, a detailed AI analysis couldn't be generated. The assessment shows areas where sustainability improvements could be made.`,
            recommendations: [
                "Review energy sources and consider renewable alternatives",
                "Implement water recycling systems in processing operations",
                "Consider increasing recycled material inputs",
                "Optimize transportation and logistics for efficiency",
                "Implement best practices for waste management and reduction"
            ]
        };
    }
    
    return { 
        message: "Fallback response generated due to processing error",
        timestamp: new Date().toISOString()
    };
}

/**
 * Handles the request to get AI suggestions for missing LCA parameters.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
async function suggestParameters(req, res) {
    try {
        const partialData = req.body.formData;
        if (!partialData || typeof partialData !== 'object') {
            return res.status(400).json({ success: false, message: "Invalid formData provided." });
        }
        
        console.log("Controller: Received partial data for suggestions:", partialData);

        const targetFields = Array.isArray(req.body.targetFields)
            ? req.body.targetFields.map(normalizeSuggestionKey)
            : [];

        const providedData = Object.entries(partialData || {}).reduce((acc, [key, value]) => {
            const normalizedKey = normalizeSuggestionKey(key);
            acc[normalizedKey] = value;
            return acc;
        }, {});

        const missingFields = (targetFields.length ? targetFields : SUGGESTION_FIELDS)
            .filter((field) => SUGGESTION_FIELDS_SET.has(field))
            .filter((field) => isMissingValue(providedData[field]));

        if (missingFields.length === 0) {
            return res.json({ success: true, suggestions: {} });
        }

        const filledFieldCount = (targetFields.length ? targetFields : SUGGESTION_FIELDS)
            .filter((field) => SUGGESTION_FIELDS_SET.has(field))
            .filter((field) => !isMissingValue(providedData[field])).length;

        if (filledFieldCount === 0) {
            return res.json({
                success: true,
                suggestions: {},
                warning: "Add at least one value before requesting predictions."
            });
        }

        const cacheKey = buildSuggestionCacheKey(providedData, missingFields);
        const cached = suggestionCache.get(cacheKey);
        if (cached && (Date.now() - cached.timestamp) < SUGGESTION_CACHE_TTL_MS) {
            return res.json({ success: true, suggestions: cached.suggestions, cached: true });
        }

        const clientId = req.ip || req.headers['x-forwarded-for'] || 'unknown';
        const lastRequestTime = lastRequestByIp.get(clientId);
        if (lastRequestTime && (Date.now() - lastRequestTime) < SUGGESTION_THROTTLE_MS) {
            if (cached) {
                return res.json({ success: true, suggestions: cached.suggestions, cached: true });
            }
            return res.json({
                success: true,
                suggestions: {},
                warning: "Please wait a moment before requesting more predictions."
            });
        }
        lastRequestByIp.set(clientId, Date.now());

        const prompt = `
You are an expert Life Cycle Assessment (LCA) analyst for the mining and metallurgy industry.
Suggest realistic values ONLY for the missing parameters listed below. Use the same camelCase keys.

Partial data (known):
${JSON.stringify(providedData, null, 2)}

Missing parameters to suggest (use these exact keys only):
${JSON.stringify(missingFields, null, 2)}

Hints for missing fields:
${JSON.stringify(missingFields.reduce((acc, field) => {
    acc[field] = SUGGESTION_FIELD_HINTS[field] || field;
    return acc;
}, {}), null, 2)}

Return ONLY a valid JSON object with those keys and suggested numeric or categorical values. No extra text.
If you cannot infer a field, omit it from the JSON object.
Example response:
{"energyConsumptionMining": 5200, "energyTypeMining": "diesel"}
        `.trim();

        const geminiResponseText = await getGeminiResponse(prompt);
        console.log("Controller: Gemini raw suggestion response:", geminiResponseText);

        let suggestions;
        try {
            // Clean the response before parsing
            const cleanedResponse = cleanGeminiResponse(geminiResponseText);
            suggestions = JSON.parse(cleanedResponse);
            if (typeof suggestions !== 'object' || Array.isArray(suggestions)) {
                throw new Error("Gemini did not return a valid JSON object for suggestions.");
            }
        } catch (parseError) {
            console.error("Controller: Failed to parse Gemini's suggestions JSON:", parseError.message);
            console.error("Controller: Gemini's unparseable response was:", geminiResponseText);
            
            suggestions = {};
        }

        const normalizedSuggestions = Object.entries(suggestions || {}).reduce((acc, [key, value]) => {
            const normalizedKey = normalizeSuggestionKey(key);
            if (!SUGGESTION_FIELDS_SET.has(normalizedKey)) return acc;
            if (!missingFields.includes(normalizedKey)) return acc;
            const normalizedValue = normalizeSuggestionValue(normalizedKey, value);
            if (normalizedValue === undefined) return acc;
            acc[normalizedKey] = normalizedValue;
            return acc;
        }, {});

        if (Object.keys(normalizedSuggestions).length === 0) {
            missingFields.forEach((field) => {
                if (DEFAULT_SUGGESTIONS[field] !== undefined) {
                    normalizedSuggestions[field] = DEFAULT_SUGGESTIONS[field];
                }
            });
        }

        suggestionCache.set(cacheKey, {
            timestamp: Date.now(),
            suggestions: normalizedSuggestions
        });

        res.json({ success: true, suggestions: normalizedSuggestions });

    } catch (error) {
        console.error("Controller: Error in suggestParameters:", error.message);
        res.status(500).json({ 
            success: false, 
            message: "Could not generate parameter suggestions at this time.",
            error: error.message
        });
    }
}

/**
 * Handles the request to generate final AI recommendations for a completed LCA.
 * @param {object} req - Express request object.
 * @param {object} res - Express response object.
 */
async function generateRecommendations(req, res) {
    try {
        const fullData = req.body.formData;
        if (!fullData || typeof fullData !== 'object') {
            return res.status(400).json({ success: false, message: "Complete formData is required for recommendations." });
        }

        console.log("Controller: Received full data for recommendations:", fullData);

        if (GEMINI_ONLY_PREDICT) {
            const fallbackReport = generateFallbackResponse('recommendations', fullData);
            return res.json({
                success: true,
                report: fallbackReport,
                warning: "AI recommendations disabled (predict-only mode)."
            });
        }

        const prompt = `
            You are an expert Life Cycle Assessment (LCA) analyst specializing in the mining and metallurgy industry.
            Analyze the following complete dataset for a specific metallurgical process:
            ${JSON.stringify(fullData, null, 2)}

            Provide a concise summary of the process's current environmental impact and a list of specific, actionable recommendations to significantly improve its sustainability and reduce its environmental footprint. Focus on practical improvements related to energy efficiency, material sourcing (especially recycled content), waste reduction, and logistics.

            Return your response as a single, valid JSON object with the following keys:
            1. "lca_summary": A brief, one-paragraph summary of the process's environmental impact.
            2. "recommendations": An array of strings, where each string is a clear, actionable recommendation.
            
            Do not add any introductory text, concluding remarks, or any other text outside of this JSON structure.
            Example of desired output:
            {
              "lca_summary": "The current copper smelting process shows high energy consumption leading to significant CO2 emissions. Water usage is also a concern, though waste generation is moderate.",
              "recommendations": [
                "Integrate renewable energy sources for smelting, targeting a 30% reduction in electricity grid dependence.",
                "Increase the recycled copper scrap input from 20% to 45% to lower virgin material extraction impacts.",
                "Optimize haulage routes from mine to plant to reduce fuel consumption by 15% through route planning software."
              ]
            }
        `;

        const geminiResponseText = await getGeminiResponse(prompt);
        console.log("Controller: Gemini raw recommendation response:", geminiResponseText);
        
        let finalReport;
        try {
            // Clean the response before parsing
            const cleanedResponse = cleanGeminiResponse(geminiResponseText);
            finalReport = JSON.parse(cleanedResponse);
            if (typeof finalReport !== 'object' || !finalReport.lca_summary || !Array.isArray(finalReport.recommendations)) {
                throw new Error("Gemini did not return a valid JSON object with 'lca_summary' and 'recommendations' for the final report.");
            }
        } catch (parseError) {
            console.error("Controller: Failed to parse Gemini's recommendations JSON:", parseError.message);
            console.error("Controller: Gemini's unparseable response was:", geminiResponseText);
            
            // Use a fallback response when parsing fails
            finalReport = generateFallbackResponse('recommendations', fullData);
            console.log("Controller: Using fallback recommendations");
        }

        // Save the report to MongoDB
        try {
            const reportName = `LCA for ${fullData.metalType || 'Metal'}`;
            
            const savedReport = await Report.create({
                name: reportName,
                metalType: fullData.metalType || 'Unknown',
                formData: fullData,
                insights: finalReport,
                user: req.user ? req.user._id : null,  // Associate with user if authenticated
                status: 'completed'
            });
            
            console.log(`Report saved to database with ID: ${savedReport._id}`);
            
            // Return the report with the MongoDB ID included
            res.json({ 
                success: true, 
                report: finalReport,
                reportId: savedReport._id,
                reportName: reportName
            });
        } catch (dbError) {
            console.error("Failed to save report to database:", dbError);
            
            // Still return the AI results even if saving failed
            res.json({ 
                success: true, 
                report: finalReport,
                warning: "Report generated but not saved to database" 
            });
        }
    } catch (error) {
        console.error("Controller: Error in generateRecommendations:", error.message);
        
        // Even in case of complete failure, return something useful to the client
        const fallbackReport = generateFallbackResponse('recommendations', req.body.formData || {});
        
        res.json({ 
            success: true,
            report: fallbackReport,
            warning: "Generated using fallback data due to API connectivity issues"
        });
    }
}

/**
 * Retrieves all reports, with optional filtering by user
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
async function getReports(req, res) {
    try {
        let query = {};
        
        // If user is authenticated and userId is provided, filter by user
        if (req.query.userId) {
            query.user = req.query.userId;
        }
        
        // Allow filtering by metal type
        if (req.query.metalType) {
            query.metalType = req.query.metalType;
        }
        
        const reports = await Report.find(query)
            .sort({ createdAt: -1 })  // Sort by newest first
            .select('_id name metalType createdAt status formData.globalWarmingPotential');  // Select only necessary fields
            
        res.json({
            success: true,
            reports: reports
        });
    } catch (error) {
        console.error("Error fetching reports:", error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to retrieve reports",
            error: error.message 
        });
    }
}

/**
 * Retrieves a single report by ID
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
async function getReportById(req, res) {
    try {
        const report = await Report.findById(req.params.id);
        
        if (!report) {
            return res.status(404).json({ 
                success: false, 
                message: "Report not found" 
            });
        }
        
        res.json({
            success: true,
            report: report
        });
    } catch (error) {
        console.error("Error fetching report:", error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to retrieve report",
            error: error.message 
        });
    }
}

/**
 * Updates an existing report
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
async function updateReport(req, res) {
    try {
        const { name, status, formData } = req.body;
        
        const report = await Report.findById(req.params.id);
        if (!report) {
            return res.status(404).json({ 
                success: false, 
                message: "Report not found" 
            });
        }
        
        // Update fields if provided
        if (name) report.name = name;
        if (status) report.status = status;
        if (formData) report.formData = formData;
        
        report.updatedAt = Date.now();
        
        await report.save();
        
        res.json({
            success: true,
            report: report
        });
    } catch (error) {
        console.error("Error updating report:", error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to update report",
            error: error.message 
        });
    }
}

/**
 * Deletes a report
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
async function deleteReport(req, res) {
    try {
        const report = await Report.findByIdAndDelete(req.params.id);
        
        if (!report) {
            return res.status(404).json({ 
                success: false, 
                message: "Report not found" 
            });
        }
        
        res.json({
            success: true,
            message: "Report deleted successfully"
        });
    } catch (error) {
        console.error("Error deleting report:", error);
        res.status(500).json({ 
            success: false, 
            message: "Failed to delete report",
            error: error.message 
        });
    }
}

/**
 * Generates dynamic insights for a specific LCA process node
 * @param {object} req - Express request object
 * @param {object} res - Express response object
 */
async function getNodeInsights(req, res) {
  try {
    const { nodeId, nodeType, formData } = req.body;
    
    if (!nodeId || !nodeType || !formData) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters: nodeId, nodeType, and formData"
      });
    }
    
    console.log(`Generating insights for ${nodeType} node (ID: ${nodeId})`);
    
    // Extract relevant parameters based on node type
    const relevantParams = extractRelevantParameters(nodeType, formData);
    
    // Create a targeted prompt for this specific node with relevant parameters
    const prompt = `
      You are an expert in Life Cycle Assessment (LCA) for metallurgical processes.
      
      Based on the following data for a ${formData.metalType || 'metal'} production process:
      ${JSON.stringify(relevantParams, null, 2)}
      
      Focus specifically on the "${nodeType}" phase of the life cycle.
      
      Provide TWO things:
      1. A concise paragraph (max 2-3 sentences) about CIRCULAR ECONOMY OPPORTUNITIES specific to this phase
      2. A concise paragraph (max 2-3 sentences) about ENVIRONMENTAL IMPACTS specific to this phase
      
      Your response should be a valid JSON object with exactly these two keys:
      {
        "circularOpportunities": "your text here",
        "environmentalImpacts": "your text here"
      }
      
      Be specific, technical, and data-driven. Reference the actual values from the provided data when possible.
      For example, if the recycling rate is 30%, mention specifically how increasing it to 50-60% would bring benefits.
      If energy source is coal, specifically mention transitioning to renewables and the benefits.
      
      Limit your response to just the JSON object - no additional explanations, markdown, or comments.
    `;
    
    if (GEMINI_ONLY_PREDICT) {
      const fallbackInsights = generateFallbackNodeInsights(nodeType, formData);
      return res.json({
        success: true,
        insights: fallbackInsights,
        warning: "AI node insights disabled (predict-only mode)."
      });
    }

    // Get response from Gemini service
    const geminiResponse = await getGeminiResponse(prompt);
    console.log(`Raw Gemini response for ${nodeType}:`, geminiResponse);
    
    // Try to parse the response
    try {
      // Clean response text (removing potential markdown code blocks)
      const cleanedResponse = cleanGeminiResponse(geminiResponse);
      console.log(`Cleaned response for ${nodeType}:`, cleanedResponse);
      
      let insights;
      try {
        insights = JSON.parse(cleanedResponse);
      } catch (firstParseError) {
        // Try to extract JSON if there's text before or after it
        console.log("Initial parse failed, trying to extract JSON...");
        const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          insights = JSON.parse(jsonMatch[0]);
        } else {
          throw firstParseError;
        }
      }
      
      // Validate that we have the expected fields
      if (!insights.circularOpportunities || !insights.environmentalImpacts) {
        throw new Error("Incomplete response from AI service");
      }
      
      return res.json({
        success: true,
        insights
      });
    } catch (parseError) {
      console.error("Failed to parse Gemini response for node insights:", parseError);
      console.error("Problematic response:", geminiResponse);
      
      // Provide fallback insights based on node type
      const fallbackInsights = generateFallbackNodeInsights(nodeType, formData);
      
      return res.json({
        success: true,
        insights: fallbackInsights,
        warning: "Generated using fallback data"
      });
    }
  } catch (error) {
    console.error("Error generating node insights:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to generate node insights",
      error: error.message 
    });
  }
}

/**
 * Extract parameters relevant to a specific node type
 * @param {string} nodeType - The type of node
 * @param {object} formData - All form data
 * @returns {object} - Filtered relevant parameters
 */
function extractRelevantParameters(nodeType, formData) {
  // Always include metal type in all cases
  const commonParams = {
    metalType: formData.metalType || 'Unknown metal'
  };
  
  switch(nodeType) {
    case 'Raw Material':
      return {
        ...commonParams,
        miningLocation: formData.miningLocation,
        oreGrade: formData.oreGrade,
        landUse: formData.landUse,
        energyConsumptionMining: formData.energyConsumptionMining,
        waterConsumptionMining: formData.waterConsumptionMining
      };
    
    case 'Processing':
      return {
        ...commonParams,
        energySource: formData.energySource,
        energyConsumptionProcessing: formData.energyConsumptionProcessing,
        recoveryRate: formData.recoveryRate,
        waterConsumptionProcessing: formData.waterConsumptionProcessing,
        processingRoute: formData.processingRoute
      };
    
    case 'Manufacturing':
      return {
        ...commonParams,
        processingRoute: formData.processingRoute,
        recycledInputRate: formData.recycledInputRate,
        manufacturingWaste: formData.manufacturingWaste,
        energyConsumptionManufacturing: formData.energyConsumptionManufacturing
      };
    
    case 'Distribution':
      return {
        ...commonParams,
        transportMode: formData.transportMode,
        transportDistances: formData.transportDistances,
        packaging: formData.packaging,
        loadFactor: formData.loadFactor
      };
    
    case 'Use Phase':
      return {
        ...commonParams,
        productLifetime: formData.productLifetime,
        energyConsumptionUse: formData.energyConsumptionUse,
        maintenanceFrequency: formData.maintenanceFrequency
      };
    
    case 'End of Life':
      return {
        ...commonParams,
        recyclingRate: formData.recyclingRate,
        reuseRate: formData.reuseRate,
        disposalRoute: formData.disposalRoute,
        wasteGeneration: formData.wasteGeneration
      };
    
    case 'Impact Analysis':
      return {
        ...commonParams,
        globalWarmingPotential: formData.globalWarmingPotential,
        waterScarcityFootprint: formData.waterScarcityFootprint,
        cumulativeEnergyDemand: formData.cumulativeEnergyDemand,
        acidificationPotential: formData.acidificationPotential,
        eutrophicationPotential: formData.eutrophicationPotential
      };
    
    default:
      // Return all parameters if node type is not recognized
      return formData;
  }
}

/**
 * Generates fallback insights when the AI service fails
 * @param {string} nodeType - Type of node
 * @param {object} formData - Form data
 * @returns {object} Fallback insights
 */
function generateFallbackNodeInsights(nodeType, formData) {
  const metalType = formData.metalType || 'metal';
  
  // Create more specific fallbacks based on actual data
  let circularOpportunities = '';
  let environmentalImpacts = '';
  
  switch(nodeType) {
    case 'Raw Material':
      // Customize based on available data
      if (formData.oreGrade) {
        circularOpportunities = `With a ${formData.oreGrade}% ore grade, optimization of mining techniques and increased use of recycled ${metalType} could significantly reduce primary resource requirements and waste rock generation.`;
      } else {
        circularOpportunities = `For ${metalType} extraction, consider increasing use of secondary materials and implementing precision mining techniques to reduce waste generation and land disturbance.`;
      }
      
      if (formData.landUse) {
        environmentalImpacts = `${metalType} extraction with current practices results in approximately ${formData.landUse} m²/tonne of land disturbance, habitat fragmentation, and potential acid mine drainage if sulfide minerals are present.`;
      } else {
        environmentalImpacts = `${metalType} extraction typically results in habitat disruption, energy consumption, and potential acid mine drainage. The reported ore grade affects the amount of waste rock generated.`;
      }
      break;
    
    case 'Processing':
      if (formData.energySource) {
        if (formData.energySource.toLowerCase().includes('coal') || formData.energySource.toLowerCase().includes('fossil')) {
          circularOpportunities = `Transitioning from ${formData.energySource} to renewable energy sources would significantly reduce carbon emissions. Implement heat recovery systems and explore by-product valorization from processing waste streams.`;
        } else {
          circularOpportunities = `Continue optimizing the use of ${formData.energySource} while implementing heat recovery systems and exploring by-product valorization from processing waste streams.`;
        }
      } else {
        circularOpportunities = `Implement heat recovery systems in ${metalType} processing to improve energy efficiency and explore by-product recovery options from processing waste streams.`;
      }
      
      if (formData.recoveryRate) {
        environmentalImpacts = `With a ${formData.recoveryRate}% recovery rate, there's still significant material loss during processing. This contributes to resource depletion and waste generation, alongside energy-related emissions from processing operations.`;
      } else {
        environmentalImpacts = `Processing of ${metalType} leads to significant energy consumption, greenhouse gas emissions, and potential release of process chemicals into water systems.`;
      }
      break;
      
    case 'Manufacturing':
      if (formData.recycledInputRate) {
        circularOpportunities = `Increasing the recycled input rate beyond the current ${formData.recycledInputRate}% could substantially reduce virgin material requirements. Design for disassembly and minimizing manufacturing scrap are additional key strategies.`;
      } else {
        circularOpportunities = `Design ${metalType} components for disassembly and recycling, and increase the percentage of recycled content in manufacturing new products.`;
      }
      
      environmentalImpacts = `Manufacturing with ${metalType} involves energy use for forming and joining processes, and may generate scrap that requires management.`;
      break;
      
    // ...similar detailed fallbacks for other node types...
    
    default:
      circularOpportunities = `Implement circular economy strategies appropriate for this stage of the ${metalType} life cycle.`;
      environmentalImpacts = `Environmental impacts at this stage should be assessed and mitigated according to industry best practices.`;
  }
  
  return {
    circularOpportunities,
    environmentalImpacts
  };
}

export default {
    suggestParameters,
    generateRecommendations,
    getNodeInsights, // Add the new function to exports
    getReports,
    getReportById,
    updateReport,
    deleteReport
};
