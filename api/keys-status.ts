import dotenv from "dotenv";

dotenv.config();

// Helper to gather all configured Gemini API keys
function getAllApiKeys(): string[] {
  const keys: string[] = [];

  // Sort env keys so GEMINI_API_KEY is first, then GEMINI_API_KEY_1, GEMINI_API_KEY_2, etc.
  const envKeys = Object.keys(process.env).sort((a, b) => {
    if (a === "GEMINI_API_KEY") return -1;
    if (b === "GEMINI_API_KEY") return 1;
    return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
  });

  for (const envKey of envKeys) {
    const upperKey = envKey.toUpperCase();
    if (upperKey.includes("GEMINI") && upperKey.includes("KEY")) {
      const val = process.env[envKey];
      if (val) {
        // If it's a comma-separated list of keys
        if (val.includes(",")) {
          const parts = val.split(",").map(k => k.trim()).filter(Boolean);
          keys.push(...parts);
        } else {
          keys.push(val.trim());
        }
      }
    }
  }

  // Remove duplicates, preserving order
  return keys.filter((item, index) => keys.indexOf(item) === index && item.length > 0);
}

// Helper to get active environment variable names for debugging
function getDetectedEnvVariableNames(): string[] {
  return Object.keys(process.env)
    .filter(key => {
      const upper = key.toUpperCase();
      return upper.includes("GEMINI") && upper.includes("KEY");
    })
    .sort((a, b) => {
      if (a === "GEMINI_API_KEY") return -1;
      if (b === "GEMINI_API_KEY") return 1;
      return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
    });
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
