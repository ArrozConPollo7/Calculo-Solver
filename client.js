(function () {

    if (window.__solverActivo) { console.warn("[Solver] Ya está corriendo, ignorando."); return; }
    window.__solverActivo = true;
    // 4. PUNTO VERDE MUY PEQUEÑO PARA CONFIRMAR INICIO (Opacidad 15%)
    const initDot = document.createElement("div");
    initDot.style = "position:fixed; top:2px; left:2px; width:4px; height:4px; border-radius:50%; background:#00ff00; opacity:0.15; z-index:99999; pointer-events:none;";
    document.body.appendChild(initDot);

    const nl = "\n";

    // ========================================================================
    // Las variables de entorno en Cloudflare (GROQ_KEY1, GROQ_KEY2... GROQ_KEY6)
    // serán inyectadas EXACTAMENTE en esta variable cuando el Worker mande el archivo.
    // Deja la siguiente línea tal cual, el Worker usará regex para reemplazar este array:
    const GROQ_KEYS = ["DEPLOY_REPLACE_ME"];
    // ========================================================================

    let currentKeyIndex = 0;
    const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

    window.__solverUIOpen = false;
    const toggleSolvers = (e) => {
        if (e.key.toLowerCase() === "x") {
            window.__solverUIOpen = !window.__solverUIOpen;
            const state = window.__solverUIOpen ? "block" : "none";
            const qd = getQuizDoc();
            if (qd) qd.querySelectorAll("[id^='sol-wrapper-']").forEach(w => w.style.display = state);
            document.querySelectorAll("[id^='sol-wrapper-']").forEach(w => w.style.display = state);
        }
    };
    document.addEventListener("keydown", toggleSolvers);
    try { getQuizDoc().addEventListener("keydown", toggleSolvers); } catch(e){}


    // ESTRATEGIA DE MODELOS REAALES GROQ
    const MODEL_ESTANDAR = "gemma2-9b-it";
    const MODEL_PRO = "llama-3.3-70b-versatile";
    const MODEL_VISION = "llama-3.2-11b-vision-preview";

    // TEMAS PRO PARA CÁLCULO
    const KEYWORDS_PRO_CALCULO = ["impropia", "infinit", "converg", "diverg", "serie"];

    // EL PROMPT MAESTRO DE CÁLCULO
    const SYSTEM_CALCULO = [
        "Eres un matemático experto resolviendo parciales de Cálculo II, estrictamente apegado al texto de Stewart 8a edición. Tu precisión matemática es infalible.",
        "ESTO ES CÁLCULO PURO, NO ESTADÍSTICA. No estás buscando funciones de densidad de probabilidad (PDF), estás buscando ÁREAS GEOMÉTRICAS literales.",
        "",
        "TEMAS DEL CURSO:",
        "- Áreas, integral definida, TFC, antiderivadas, cambio neto (§4.9, 5.1-5.4)",
        "- Técnicas: Sustitución, partes, fracciones parciales, sustitución trigonométrica (§5.5, 7.1-7.4)",
        "- Aplicaciones: Área entre curvas, volúmenes (discos/arandelas, cascarones), trabajo, valor promedio (§6.1-6.5)",
        "- Aplicaciones avanzadas: Longitud de arco, superficie de revolución (§8.1-8.2)",
        "- Física: Fuerza hidrostática, centros de masa (§8.3-8.5)",
        "- Integrales impropias (§7.8)",
        "- Sucesiones, series, convergencia, Taylor/Maclaurin (§11.1-11.11)",
        "",
        "REGLAS SUPREMAS:",
        "1. EL OBJETIVO DETERMINA EL PROCEDIMIENTO: MIRA LAS OPCIONES ANTES de operar a ciegas. ¿Las opciones son valores numéricos decimales? Resuelve hasta el final. ¿Las opciones son INTEGRALES SIN RESOLVER (fórmulas)? Entonces TU ÚNICO TRABAJO ES PLANTEAR, NO LA RESUELVAS.",
        "2. PLANTEAMIENTOS DE ÁREA (CÁLCULO PURO, NO ESTADÍSTICA): El área geométrica bajo la curva $f(x)$ es estrictamente $\\int_a^b f(x) dx$. NUNCA multipliques la función por derivadas internas ni agregues coeficientes 0.5 o constantes mágicas para fabricar un 'área=1' (no confundas cálculo con distribuciones exponenciales de probabilidad). Calca la función literalmente en la integral.",
        "3. NO INVENTES problemas. Si te dan una gráfica o enunciado en una imagen, esa es la verdad absoluta. Si el texto falla, confía en la imagen.",
        "4. JAMÁS DIGAS 'Ninguna opción coincide'. Si tu resultado preliminar no se ve igual a las opciones, APLICA ÁLGEBRA o cambia la variable para empatar lógicamente con una de las opciones.",
        "5. Superficie de Revolución:",
        "   - Giro eje Y: El radio es $x$ (o $g(y)$). Área $dA = 2\\pi x \\, ds$.",
        "   - Giro eje X: El radio es $y$ (o $f(x)$). Área $dA = 2\\pi y \\, ds$.",
        "   - ¡Cuidado con sustituciones $u$! Si $u=e^x$, los límites también cambian.",
        "6. Tópicos Avanzados (MUY IMPORTANTE):",
        "   - Integrales Impropias: ¡ALERTA DE SIGNOS! Analiza algebraicamente a dónde tiende el exponente. Ej: $e^{-(-\\infty)} = e^{\\infty} = \\infty$ (DIVERGE).",
        "   - Series y Convergencia: Declara EXACTAMENTE qué prueba estás usando y demuéstrala.",
        "   - Polinomios de Taylor: Asegúrate de revisar alrededor de qué centro $a$ está calculado.",
        "7. CUIDADO CON PREGUNTAS NEGATIVAS: Si el enunciado dice 'NO corresponde', 'FALSA', o 'INCORRECTA', tu objetivo se INVIERTE. Debes evaluar todas las opciones y encontrar la UNICA que tiene un ERROR matemático (ej. un signo menos faltante, un límite mal evaluado). Tres serán correctas, una será un error explícito. ¡Atrapa la que está MAL!",
        "8. ESTRICTAMENTE PROCEDIMIENTOS. No uses relleno de texto.",
        "",
        "ESTRUCTURA INQUEBRANTABLE:",
        "Tema: (Concepto teórico evaluado)",
        "Procedimiento: (Paso 1: Planteamiento de la base teórica (ej. $ds = \\sqrt{1+(f')^2}dx$). Paso 2: Derivación y cuadrados. Paso 3: Aplicación de cambios de variable para forzar el empate lógico con las opciones. Usa exclusivamente código LaTeX conectado por iguales.)",
        "Resultado: (Formulación final numérica o integral sin resolver)",
        "Verificación: (Demostración rigurosa de por qué una de las opciones es un espejo exacto del Resultado)",
        "---",
        "LETRA",
        "(La última línea obligatoriamente tiene SOLO UNA LETRA que indique la opción verdadera: A, B, C, D o E)"
    ].join(nl);

    function formulaAImagen(latex) {
        const clean = latex.replace(/\$\$/g, "").replace(/\$/g, "").replace(/\\\[/g, "").replace(/\\\]/g, "").replace(/\\\(/g, "").replace(/\\\)/g, "").trim();
        return `<img src="https://latex.codecogs.com/svg.latex?{\\color{White}${encodeURIComponent(clean)}}" style="vertical-align: middle; max-height: 22px;" />`;
    }

    async function preguntarAI(enunciado, opciones, imagen) {
        const enunciadoMinus = (enunciado || "").toLowerCase();
        let modeloAElegir = MODEL_ESTANDAR;

        // 1. Detección PRO
        if (KEYWORDS_PRO_CALCULO.some(k => enunciadoMinus.includes(k))) {
            modeloAElegir = MODEL_PRO;
        }
        if (imagen) modeloAElegir = MODEL_VISION;

        const optsStr = opciones.map(o => o.letra + ") " + o.texto).join(nl);

        const generarPayload = (modeloParam) => {
            const p = {
                model: modeloParam,
                messages: [
                    { role: "system", content: SYSTEM_CALCULO },
                    { role: "user", content: "Resuelve algebraicamente:\n\n" + enunciado + nl + nl + "OPCIONES:\n" + optsStr }
                ],
                temperature: 0.1
            };
            if (imagen) {
                p.messages[1].content = [
                    { type: "text", text: "Analiza la gráfica o fórmula de la imagen y resuelve:\n\n" + enunciado + nl + nl + "OPCIONES:\n" + optsStr },
                    { type: "image_url", image_url: { url: "data:" + imagen.mimeType + ";base64," + imagen.base64 } }
                ];
            }
            return p;
        };

        const realizarPeticion = async (modeloParam) => {
            for (let i = 0; i < GROQ_KEYS.length * 2; i++) {
                const currentKey = GROQ_KEYS[currentKeyIndex];
                try {
                    const r = await fetch(GROQ_URL, {
                        method: "POST", headers: { "Authorization": "Bearer " + currentKey, "Content-Type": "application/json" },
                        body: JSON.stringify(generarPayload(modeloParam))
                    });
                    if (r.status === 429) {
                        currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
                        await new Promise(res => setTimeout(res, 1500));
                        continue;
                    }
                    if (!r.ok) {
                        const txt = await r.text();
                        console.error("GROQ API ERROR:", r.status, txt, "Payload:", p);
                        throw new Error(`Error API: ${r.status} ` + txt.substring(0,50));
                    }
                    const data = await r.json();
                    const raw = data.choices[0].message.content;
                    const letra = raw.split(nl).pop().replace(/[^A-E]/g, "").trim() || "A";
                    return { procedimiento: raw.split("---")[0].trim(), letra, modelo: modeloParam };
                } catch (err) {
                    if (i === GROQ_KEYS.length * 2 - 1) throw err;
                    currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
                    await new Promise(res => setTimeout(res, 1000));
                }
            }
        };

        try {
            return await realizarPeticion(modeloAElegir);
        } catch (error) {
            // 2. FALLBACK A QWEN SI EL PRO/VISUAL FALLA CRÍTICAMENTE
            if (modeloAElegir !== MODEL_ESTANDAR) {
                return await realizarPeticion(MODEL_ESTANDAR);
            }
            throw error;
        }
    }

    function crearUI(container, id) {
        const wrapper = document.createElement("div");
        wrapper.id = "sol-wrapper-" + id;
        wrapper.style = "margin:8px 0; padding:10px; background:#121212; border-radius:6px; border-left:3px solid #00d4ff; color:#eee; font-family:sans-serif; display:" + (window.__solverUIOpen ? "block" : "none") + ";";
        wrapper.innerHTML = `
            <div style="display:flex;justify-content:space-between;font-size:10px;">
                <span id="modo-${id}" style="color:#00d4ff;font-weight:bold;">SOLVER: CARGANDO...</span>
                <span id="letra-${id}" style="background:#00d4ff;color:#000;padding:1px 5px;border-radius:3px;font-weight:bold;">...</span>
            </div>
            <div id="proc-${id}" style="max-height:80px;overflow-y:auto;color:#bbb;font-size:11px;margin-top:5px;">Generando respuesta...</div>
        `;
        container.appendChild(wrapper);
    }

    // 3. TRES PUNTOS DE FALLO CASI INVISIBLES
    function marcarError(container) {
        const errorDot = document.createElement("div");
        errorDot.style = "position:absolute; bottom:2px; right:2px; color:#ff0000; font-size:6px; opacity:0.1; line-height:1; pointer-events:none;";
        errorDot.innerText = "...";
        container.style.position = "relative";
        container.appendChild(errorDot);
    }

    async function resolverPregunta(q, id) {
        try {
            const body = q.querySelector(".d2l-quiz-question-content") || q;
            const imgEl = body.querySelector("img");
            let imgData = null;
            if (imgEl) {
                const r = await fetch(imgEl.src, { credentials: "include" });
                const b = await r.blob();
                imgData = await new Promise(res => {
                    const rd = new FileReader();
                    rd.onloadend = () => res({ base64: rd.result.split(",")[1], mimeType: b.type });
                    rd.readAsDataURL(b);
                });
            }

            const enunciado = (body.innerText || "").split("\n")[0];
            const opts = Array.from(q.querySelectorAll("tr.d2l-rowshadeonhover, .d2l-quiz-answer-option")).map((opt, i) => ({
                letra: String.fromCharCode(65 + i),
                texto: opt.innerText.trim()
            })).filter(o => o.texto.length > 0);

            crearUI(q, id);

            preguntarAI(enunciado, opts, imgData).then(({ procedimiento, letra, modelo }) => {
                const qd = q.ownerDocument;
                qd.getElementById(`modo-${id}`).innerText = "MODO: " + modelo.toUpperCase();
                qd.getElementById(`proc-${id}`).innerHTML = procedimiento.replace(/\n/g, "<br>").replace(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g, (m) => formulaAImagen(m));
                qd.getElementById(`letra-${id}`).innerText = letra;

                const radios = q.querySelectorAll('input[type="radio"]');
                const targetIdx = letra.charCodeAt(0) - 65;
                if (radios[targetIdx]) radios[targetIdx].click();
            }).catch(e => {
                marcarError(q);
                const errEl = q.ownerDocument.getElementById(`proc-${id}`);
                if (errEl) errEl.innerText = "Error: " + e.message;
            });
        } catch (e) { marcarError(q); }
    }

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.dataset.solved) {
                entry.target.dataset.solved = "true";
                resolverPregunta(entry.target, Math.random().toString(36).substr(2, 5));
            }
        });
    });

    function getQuizDoc() {
        try {
            const ctl2 = document.getElementById("ctl_2");
            if (ctl2) {
                const frmPage = ctl2.contentDocument.getElementById("FRM_page");
                if (frmPage) return frmPage.contentDocument;
                return ctl2.contentDocument;
            }
        } catch (e) { }
        return document;
    }

    const quizDoc = getQuizDoc();
    const preguntas = quizDoc.querySelectorAll("fieldset.dfs_m");
    console.log("[Solver] Preguntas encontradas:", preguntas.length);
    preguntas.forEach(q => observer.observe(q));
})();
