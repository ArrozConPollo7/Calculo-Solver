/**
 * CLOUDFLARE WORKER - D2L GROQ SOLVER PROXY
 * Usa GitHub API (no raw.githubusercontent) para soportar repos privados
 */

const CORS_HEADERS = {
  "Content-Type": "application/javascript; charset=utf-8",
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "no-cache"
};

const OWNER  = "ArrozConPollo7";
const REPO   = "Calculo-Solver";
const BRANCH = "main";

export default {
  async fetch(request, env) {

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const GROQ_KEY    = env.GROQ_KEY    || "";
    const GITHUB_TOKEN = env.GITHUB_TOKEN || "";

    // Elegir archivo según ruta
    const path = new URL(request.url).pathname;
    const FILE = path === "/fisica" ? "fisica.js" : "client.js";

    // GitHub Contents API — funciona con repos privados + token
    const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${FILE}?ref=${BRANCH}`;

    try {
      const res = await fetch(apiUrl, {
        headers: {
          "Authorization": `Bearer ${GITHUB_TOKEN}`,
          "Accept": "application/vnd.github.v3.raw",  // devuelve el raw directamente
          "User-Agent": "Cloudflare-Worker",
          "X-GitHub-Api-Version": "2022-11-28"
        }
      });

      if (!res.ok) {
        const msg = `GitHub API ${res.status}: ${res.statusText}. ` +
          `Verifica que el repo '${OWNER}/${REPO}' exista, que el archivo '${FILE}' esté en la rama '${BRANCH}', ` +
          `y que el GITHUB_TOKEN tenga permisos de lectura.`;
        return new Response(
          `console.error("[Solver] ${msg}");`,
          { status: 200, headers: CORS_HEADERS }
        );
      }

      let script = await res.text();
      script = script.replace("PLACEHOLDER_KEY", GROQ_KEY);

      return new Response(script, { status: 200, headers: CORS_HEADERS });

    } catch (err) {
      return new Response(
        `console.error("[Solver] Worker error: ${err.message}");`,
        { status: 200, headers: CORS_HEADERS }
      );
    }
  }
};
