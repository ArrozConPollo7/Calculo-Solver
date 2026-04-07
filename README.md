# D2L Groq Solver - GitHub & Cloudflare Proxy

Este repositorio contiene un sistema de actualización automática para el solver de D2L. Con esta configuración, puedes subir tus cambios a GitHub y Cloudflare usará la última versión instantáneamente sin necesidad de volver a desplegar.

## 📁 Estructura del Proyecto

1.  **`client.js`** (GitHub): El script que se inyecta en el navegador (D2L). Contiene el motor de resolución y KaTeX.
2.  **`worker.js`** (GitHub): La lógica del Cloudflare Worker. Actúa como proxy para `client.js`, inyecta la `GROQ_KEY` y maneja los headers CORS.
3.  **`loader.js`** (Local/Solo para Cloudflare): El "Bootstrapper" que debes pegar en el panel de Cloudflare. Se encarga de llamar a `worker.js` desde GitHub en cada ejecución.

---

## 🚀 Pasos para la Configuración

### 1. Preparar GitHub
1. Crea un repositorio llamado `Calculo-Solver`.
2. Sube los archivos `client.js`, `worker.js` y `.gitignore`.
3. Si el repositorio es **privado**, asegúrate de tener un **Personal Access Token (classic)** con permisos `repo`.

### 2. Configurar Cloudflare (El "Bootstrapper")
1. Crea un nuevo Worker en Cloudflare.
2. Abre el editor de código del Worker y pega **todo el contenido de `loader.js`**.
3. **IMPORTANTE:** Edita la constante `OWNER` y `REPO` en `loader.js` para que coincidan con tu usuario de GitHub.
4. Ve a **Settings -> Variables** y añade estos **Secrets**:
    *   `GROQ_KEY`: Tu API Key real de Groq.
    *   `GITHUB_TOKEN`: Tu token de GitHub (solo si el repositorio es privado).

### 3. Uso
Para ejecutar el solver, usa este oneliner en la consola de D2L:

```javascript
fetch('https://calculo-solver.juandavidgr39.workers.dev')
  .then(r=>r.text()).then(eval)
```

---

## 🛠️ ¿Cómo funciona?

1. El navegador llama a tu URL de Cloudflare.
2. **Cloudflare (`loader.js`)** busca en GitHub el archivo `worker.js` más reciente.
3. **Cloudflare** ejecuta `worker.js` dinámicamente.
4. **worker.js** busca en GitHub el archivo `client.js`.
5. **worker.js** reemplaza `PLACEHOLDER_KEY` por tu `GROQ_KEY` secreta.
6. El navegador recibe el script listo para funcionar.

---

## ✅ Mejoras Recientes
*   **Fix Toggle X**: Mejorado con `window.__groq__` y limpieza de listeners previos.
*   **KaTeX robusto**: Intentos múltiples de renderizado para evitar errores de carga lenta.
*   **Filtro Inteligente**: Justificaciones limpias eliminando texto narrativo redundante.
*   **Cero Cache**: El sistema detecta cambios en GitHub de forma inmediata.
