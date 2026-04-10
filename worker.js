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

    // Recolectar múltiples llaves
    const keys = [];
    for (let i = 1; i <= 20; i++) {
      if (env[`GROQ_KEY${i}`]) keys.push(env[`GROQ_KEY${i}`]);
    }
    // Si usaste la variable normal sin número
    if (keys.length === 0 && env.GROQ_KEY) keys.push(env.GROQ_KEY);

    const GITHUB_TOKEN = env.GITHUB_TOKEN || "";

    // Elegir archivo según ruta
    const path = new URL(request.url).pathname;
    const FILE = path === "/fisica" ? "client_fisica.js" : "client.js";

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
      // Reemplazo del array "DEPLOY_REPLACE_ME" por las llaves reales de Cloudflare
      if (keys.length > 0) {
         script = script.replace('["DEPLOY_REPLACE_ME"]', JSON.stringify(keys));
      }

      return new Response(script, { status: 200, headers: CORS_HEADERS });

    } catch (err) {
      return new Response(
        `console.error("[Solver] Worker error: ${err.message}");`,
        { status: 200, headers: CORS_HEADERS }
      );
    }
  }
};
