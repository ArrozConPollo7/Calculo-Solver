/**
 * CLOUDFLARE BOOTSTRAPPER (Pegar esto en el editor de Cloudflare Workers)
 * 
 * Este pequeño script actuará como un "cargador" dinámico. No necesitas actualizar 
 * el código en Cloudflare cada vez que cambies el código en GitHub. Este script
 * buscará siempre el código más reciente de tu repositorio y lo ejecutará.
 */

export default {
  async fetch(request, env) {
    // Configuración desde Variables de Entorno (Secrets) de Cloudflare
    const GITHUB_TOKEN = env.GITHUB_TOKEN; // Secret en CF
    
    // Repositorio donde guardarás el código real
    const OWNER = "ArrozConPollo7";
    const REPO  = "Calculo-Solver";
    const BRANCH = "main";
    const PATH  = "worker.js"; // Este será el archivo con la lógica real en GitHub

    const GITHUB_URL = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${PATH}`;

    try {
      // 1. Obtener el código de la lógica real desde GitHub
      const response = await fetch(GITHUB_URL, {
        headers: {
          "Authorization": GITHUB_TOKEN ? `token ${GITHUB_TOKEN}` : "",
          "User-Agent": "Cloudflare-Worker-Bootstrapper",
          "Cache-Control": "no-cache", // Evitar caché antigua
          "Pragma": "no-cache"
        }
      });

      if (!response.ok) {
        return new Response(`Error al cargar la lógica desde GitHub: ${response.status} ${response.statusText}`, { status: 500 });
      }

      const workerCode = await response.text();

      // 2. Ejecutar la lógica dinámicamente como un Módulo ES
      // 'data:text/javascript;base64,' + btoa() es un truco estándar para workers dinámicos
      const dynamicModule = await import('data:text/javascript;base64,' + btoa(unescape(encodeURIComponent(workerCode))));
      
      // 3. Ejecutar el fetch del módulo cargado
      return dynamicModule.default.fetch(request, env);

    } catch (error) {
      return new Response(`Error en el Loader: ${error.message}\n${error.stack}`, { status: 500 });
    }
  }
};
