import dotenv from "dotenv";

dotenv.config();

// Helper to gather all configured Gemini API keys
function getAllApiKeys(): string[] {
  const keysFromEnv = (process.env.GEMINI_API_KEY || "")
    .split(",")
    .map(k => k.trim())
    .filter(Boolean);

  const individualKeys: string[] = [];
  for (let i = 1; i <= 10; i++) {
    const key = process.env[`GEMINI_API_KEY_${i}`];
    if (key) {
      individualKeys.push(key.trim());
    }
  }

  // Combine and remove duplicates, preserving original order
  const combined = [...keysFromEnv, ...individualKeys];
  return combined.filter((item, index) => combined.indexOf(item) === index && item.length > 0);
}

// Helper to get active environment variable names for debugging
function getDetectedEnvVariableNames(): string[] {
  const detected: string[] = [];
  if (process.env.GEMINI_API_KEY) {
    detected.push("GEMINI_API_KEY");
  }
  for (let i = 1; i <= 10; i++) {
    if (process.env[`GEMINI_API_KEY_${i}`]) {
      detected.push(`GEMINI_API_KEY_${i}`);
    }
  }
  return detected;
}

export default async function handler(req: any, res: any) {
  // Handle CORS and preflight requests
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  try {
    const { customKeys } = req.body || {};
    const systemKeys = getAllApiKeys();

    interface KeyInfo {
      key: string;
      alias: string;
      signature: string;
      type: "System" | "Custom";
    }

    const allKeys: KeyInfo[] = [];

    // Populate system keys
    systemKeys.forEach((key, index) => {
      const signature = key.length > 12 ? `${key.substring(0, 8)}...${key.substring(key.length - 6)}` : "Key Pendek";
      allKeys.push({
        key,
        alias: `Sistem #${index + 1}`,
        signature,
        type: "System"
      });
    });

    // Populate custom keys
    const parsedCustomKeys = Array.isArray(customKeys)
      ? customKeys.map(k => typeof k === "string" ? k.trim() : "").filter(Boolean)
      : [];

    parsedCustomKeys.forEach((key, index) => {
      if (key && !systemKeys.includes(key)) {
        const signature = key.length > 12 ? `${key.substring(0, 8)}...${key.substring(key.length - 6)}` : "Key Pendek";
        allKeys.push({
          key,
          alias: `Cadangan #${index + 1}`,
          signature,
          type: "Custom"
        });
      }
    });

    const keyStatuses = allKeys.map(k => {
      return {
        keyAlias: k.alias,
        keySignature: k.signature,
        type: k.type,
        status: "Active",
        cooldown: "0s",
        lastRequest: "-",
        fails: 0
      };
    });

    return res.json({
      success: true,
      keyStatuses,
      detectedEnvKeys: getDetectedEnvVariableNames()
    });
  } catch (error: any) {
    return res.status(500).json({
      success: false,
      error: error.message || "Internal server error"
    });
  }
}
