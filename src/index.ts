import fs from "fs";
import https from "https";
import path from "path";

import { App, ExpressAdapter, IPlugin } from "@microsoft/teams.apps";
import { ConsoleLogger } from "@microsoft/teams.common/logging";
import { DevtoolsPlugin } from "@microsoft/teams.dev";

const sslOptions = {
  key: process.env.SSL_KEY_FILE ? fs.readFileSync(process.env.SSL_KEY_FILE) : undefined,
  cert: process.env.SSL_CRT_FILE ? fs.readFileSync(process.env.SSL_CRT_FILE) : undefined,
};

// Workaround for SDK bug in v2.0.6+: ExpressAdapter uses `instanceof http.Server`
// which fails for https.Server (extends tls.Server, not http.Server).
// Fix: create the adapter, then replace its internal http.Server with our https.Server.
const adapter = new ExpressAdapter();
if (sslOptions.cert && sslOptions.key) {
  const httpsServer = https.createServer(sslOptions, (adapter as any).express);
  (adapter as any).server = httpsServer;
}

// Only use DevtoolsPlugin locally — it crashes on Azure App Service
// because it calls parseInt() on the named pipe PORT value.
const plugins: IPlugin[] = [];
if (process.env.SSL_KEY_FILE) {
  plugins.push(new DevtoolsPlugin());
}
const app = new App({
  logger: new ConsoleLogger("tab", { level: "debug" }),
  plugins: plugins,
  httpServerAdapter: adapter,
  skipAuth: true,
});

app.tab("home", path.join(__dirname, "./client"));

type ChatMessage = { role: "user" | "assistant"; content: string };

const readJsonBody = (req: any): Promise<any> =>
  new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk;
      if (data.length > 1_000_000) {
        reject(new Error("Payload too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });

// Chat endpoint: forwards the conversation to Azure OpenAI. The API key stays on the server.
(adapter as any).express.post("/api/chat", async (req: any, res: any) => {
  const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
  const apiKey = process.env.AZURE_OPENAI_API_KEY;
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT;

  if (!endpoint || !apiKey || !deployment) {
    res.status(500).json({ error: "Azure OpenAI is not configured on the server." });
    return;
  }

  let messages: ChatMessage[];
  try {
    const body = await readJsonBody(req);
    messages = (Array.isArray(body.messages) ? body.messages : [])
      .filter(
        (m: any) =>
          m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string"
      )
      .slice(-20);
  } catch {
    res.status(400).json({ error: "Invalid request body." });
    return;
  }
  if (messages.length === 0) {
    res.status(400).json({ error: "No messages provided." });
    return;
  }

  try {
    // v1 API: works for both <res>.openai.azure.com and <res>.services.ai.azure.com endpoints.
    const url = `${new URL(endpoint).origin}/openai/v1/chat/completions`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "api-key": apiKey },
      body: JSON.stringify({
        model: deployment,
        messages: [
          {
            role: "system",
            content:
              process.env.AZURE_OPENAI_SYSTEM_PROMPT ||
              "You are a helpful assistant for a customer ticketing tool.",
          },
          ...messages,
        ],
      }),
    });
    const data: any = await upstream.json().catch(() => ({}));
    if (!upstream.ok) {
      console.error("Azure OpenAI error:", upstream.status, data?.error?.message);
      res.status(502).json({ error: "The AI service returned an error." });
      return;
    }
    res.json({ reply: data?.choices?.[0]?.message?.content ?? "" });
  } catch (err) {
    console.error("Azure OpenAI request failed:", err);
    res.status(502).json({ error: "Failed to reach the AI service." });
  }
});

(async () => {
  await app.start(process.env.PORT || 3978);
})();
