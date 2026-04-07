/**
 * CLOUDFLARE WORKER - D2L GROQ SOLVER PROXY
 * 
 * Este worker actúa como un puente (proxy) para servir el script cliente 
 * alojado en GitHub, inyectando la API Key de Groq de forma dinámica.
 */

export default {
  async fetch(request, env) {
    // Configuración desde Variables de Entorno (Secrets) de Cloudflare
    const GITHUB_TOKEN = env.GITHUB_TOKEN; // Secret: Token de GitHub
    const GROQ_KEY = env.GROQ_KEY;         // Secret: Tu API Key de Groq
    
    // URL del archivo client.js en tu repositorio (Ajustar OWNER y REPO)
    // El usuario es juandavidgr39
    const OWNER = "ArrozConPollo7";
    const REPO  = "Calculo-Solver"; // Ajustar si el nombre del repo es diferente
    const PATH  = "client.js";
    const BRANCH = "main";

    const GITHUB_URL = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${PATH}`;

    try {
      // 1. Obtener el script del cliente desde GitHub
      const response = await fetch(GITHUB_URL, {
        headers: {
          "Authorization": GITHUB_TOKEN ? `token ${GITHUB_TOKEN}` : "",
          "User-Agent": "Cloudflare-Worker-Proxy",
          "Accept": "application/vnd.github.v3.raw"
        }
      });

      if (!response.ok) {
        return new Response(`Error al obtener script de GitHub: ${response.status} ${response.statusText}`, { status: 500 });
      }

      let script = await response.text();

      // 2. Inyectar la API Key de Groq
      // Reemplaza el placeholder definido en client.js
      script = script.replace("PLACEHOLDER_KEY", GROQ_KEY || "");

      // 3. Devolver los headers correctos para que el browser lo admita como script
      return new Response(script, {
        headers: {
          "Content-Type": "application/javascript; charset=utf-8",
          "Access-Control-Allow-Origin": "*",
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "no-cache" // Evitar cache para ver cambios rápidos de GitHub
        }
      });

    } catch (error) {
      return new Response(`Worker Error: ${error.message}`, { status: 500 });
    }
  }
};
