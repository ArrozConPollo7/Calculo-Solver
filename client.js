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
    try { getQuizDoc().addEventListener("keydown", toggleSolvers); } catch (e) { }


    const MODEL_ESTANDAR = "qwen/qwen3-32b";
    const MODEL_PRO = "qwen/qwen3-32b";
    const MODEL_VISION = "meta-llama/llama-4-scout-17b-16e-instruct";

    // TEMAS PRO: solo preguntas conceptuales/trampa (Qwen es mejor que PRO en cálculo numérico)
    const KEYWORDS_PRO_CALCULO = [
        "no corresponde", "falsa", "incorrecta",
        "afirmación", "cuál de las siguientes es correcta",
        "converg", "diverg", "serie"
    ];

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
            const INTENTOS = 3; // manda 3 veces, gana la más votada
            const votos = {};
            const resultados = {};

            for (let intento = 0; intento < INTENTOS; intento++) {
                for (let i = 0; i < GROQ_KEYS.length * 2; i++) {
                    const currentKey = GROQ_KEYS[currentKeyIndex];
                    try {
                        const r = await fetch(GROQ_URL, {
                            method: "POST",
                            headers: { "Authorization": "Bearer " + currentKey, "Content-Type": "application/json" },
                            body: JSON.stringify(generarPayload(modeloParam))
                        });
                        if (r.status === 429) {
                            currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
                            await new Promise(res => setTimeout(res, 1500));
                            continue;
                        }
                        if (!r.ok) throw new Error("API Error " + r.status);
                        const data = await r.json();
                        const raw = data.choices[0].message.content;
                        const lineas = raw.split(nl).map(l => l.trim()).filter(l => l.length > 0);
                        const ultimaLinea = lineas[lineas.length - 1];
                        const letra = ultimaLinea.replace(/[^A-E]/g, "").trim() || "A";

                        votos[letra] = (votos[letra] || 0) + 1;
                        if (!resultados[letra]) resultados[letra] = raw; // guardar primer procedimiento de esa letra

                        console.log(`[Solver] Intento ${intento + 1}/${INTENTOS}: votó ${letra} (marcador: ${JSON.stringify(votos)})`);
                        break; // este intento fue exitoso, pasar al siguiente
                    } catch (err) {
                        if (i === GROQ_KEYS.length * 2 - 1) throw err;
                        currentKeyIndex = (currentKeyIndex + 1) % GROQ_KEYS.length;
                        await new Promise(res => setTimeout(res, 1000));
                    }
                }

                // delay entre intentos para no saturar TPM
                if (intento < INTENTOS - 1) {
                    await new Promise(res => setTimeout(res, 3000));
                }
            }

            // ganador por mayoría
            const letraGanadora = Object.entries(votos).sort((a, b) => b[1] - a[1])[0][0];
            const rawGanador = resultados[letraGanadora];
            console.log(`[Solver] Resultado final por votación: ${letraGanadora} (votos: ${JSON.stringify(votos)})`);

            // Extraer solo ecuaciones para la UI discreta
            const procLines = rawGanador.split("---")[0].trim().split(nl);
            let formulaLines = procLines.filter(l => l.includes("$$") || l.includes("$") || l.includes("="));
            if (formulaLines.length === 0) formulaLines = procLines; // Backup

            return {
                procedimiento: formulaLines.join("\n"),
                letra: letraGanadora,
                modelo: modeloParam
            };
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
        wrapper.style = "margin:5px 0; padding:5px; background:transparent; border:none; color:#a0a0a0; font-family:monospace; font-size:10px; opacity:0.7; display:" + (window.__solverUIOpen ? "block" : "none") + ";";
        wrapper.innerHTML = `
            <div style="display:flex;justify-content:space-between;font-size:9px;margin-bottom:2px;">
                <span id="modo-${id}" style="opacity:0.5;">...</span>
                <span id="letra-${id}" style="font-weight:bold; font-size:14px; color:#ffffff; opacity:1;">?</span>
            </div>
            <div id="proc-${id}" style="max-height:100px;overflow-y:auto;line-height:1.2;">...</div>
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
            function leerBloque(el) {
                if (!el) return "";
                const sr = el.shadowRoot;
                const texto = sr ? sr.textContent : el.innerText;
                return texto
                    .replace(/mjx-[a-z-]+\s*\{[^}]*\}/g, "")      // clases mjx-xxx { ... }
                    .replace(/_::[^\{]+\{[^}]*\}/g, "")             // _::-webkit-... { ... }
                    .replace(/:root[^\{]+\{[^}]*\}/g, "")           // :root ... { ... }
                    .replace(/\{[^}]*display[^}]*\}/g, "")          // cualquier { display: ... }
                    .replace(/position:\s*absolute[^;]*;/g, "")     // position: absolute
                    .replace(/clip:\s*rect[^;]*;/g, "")             // clip: rect(...)
                    .replace(/padding:\s*[\dpx\s]+;/g, "")          // padding: ...
                    .replace(/\s{2,}/g, " ")
                    .trim()
                    .slice(0, 500);
            }

            const todosLosBlockes = q.ownerDocument.querySelectorAll("d2l-html-block");
            const blocksAntes = Array.from(todosLosBlockes).filter(b => {
                return q.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_PRECEDING;
            });
            const enunciado = leerBloque(blocksAntes[blocksAntes.length - 1]) || "Sin enunciado";

            const opts = Array.from(q.querySelectorAll("tr.d2l-rowshadeonhover")).map((tr, i) => ({
                letra: String.fromCharCode(65 + i),
                texto: leerBloque(tr.querySelector("d2l-html-block"))
            })).filter(o => o.texto.length > 0);

            let imgData = null;
            // Bug 2: imagen puede estar en shadowRoot del bloque enunciado
            let imgEl = q.querySelector("img");
            if (!imgEl && blocksAntes.length > 0) {
                const lastBlock = blocksAntes[blocksAntes.length - 1];
                imgEl = lastBlock.shadowRoot?.querySelector("img")
                     || lastBlock.querySelector("img");
            }
            if (imgEl) {
                const r = await fetch(imgEl.src, { credentials: "include" });
                const b = await r.blob();
                imgData = await new Promise(res => {
                    const rd = new FileReader();
                    rd.onloadend = () => res({ base64: rd.result.split(",")[1], mimeType: b.type });
                    rd.readAsDataURL(b);
                });
            }

            console.log(`[P${id}] Enunciado:`, enunciado.slice(0, 80));
            console.log(`[P${id}] Opciones:`, opts.map(o => o.letra + ": " + o.texto.slice(0, 40)));

            crearUI(q, id);

            const { procedimiento, letra, modelo } = await preguntarAI(enunciado, opts, imgData);
            const qd = q.ownerDocument;
            qd.getElementById(`modo-${id}`).innerText = "MODO: " + modelo.toUpperCase();
            qd.getElementById(`proc-${id}`).innerHTML = procedimiento.replace(/\n/g, "<br>").replace(/(\$\$[\s\S]*?\$\$|\$[\s\S]*?\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g, (m) => formulaAImagen(m));
            qd.getElementById(`letra-${id}`).innerText = letra;

            const radios = q.querySelectorAll('input[type="radio"]');
            const targetIdx = letra.charCodeAt(0) - 65;
            if (radios[targetIdx]) radios[targetIdx].click();
        } catch (e) { marcarError(q); console.error("[Solver] Error:", e.message); }
    }


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

    async function procesarEnSerie() {
        const preguntas = Array.from(quizDoc.querySelectorAll("fieldset.dfs_m"));
        console.log("[Solver] Preguntas encontradas:", preguntas.length);
        for (let i = 0; i < preguntas.length; i++) {
            const q = preguntas[i];
            if (q.dataset.solved) continue;
            q.dataset.solved = "true";
            const id = Math.random().toString(36).substr(2, 5);
            console.log(`[Solver] Procesando pregunta ${i + 1}/${preguntas.length}...`);
            await resolverPregunta(q, id);
            if (i < preguntas.length - 1) {
                await new Promise(r => setTimeout(r, 5000));
            }
        }
        console.log("[Solver] ✓ Listo.");
    }

    procesarEnSerie();
})();
